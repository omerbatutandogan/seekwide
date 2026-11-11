// Repo mode: say which source file each finding comes from.
//
// The mapping only says where a fix belongs. It never predicts what a page
// contains: everything a finding reports was measured on the served page.

/** @import { CrawlResult, Finding, FindingSource, PageRecord, RepoSummary } from '../types.js' */
/** @import { Detection } from './detect.js' */
/** @import { HtmlAnchors } from './html-lines.js' */

import { decodeBody } from '../extract/decode.js';
import { extractPage } from '../extract/page.js';
import { detectProject } from './detect.js';
import { anchorLine, htmlAnchors, sameDocument, sourceLine } from './html-lines.js';
import { isHtmlFile, matchHtmlFile } from './html-routes.js';
import { buildNextRoutes, matchNextRoute } from './next-routes.js';
import { listFiles, readFileInside, resolveSourceDir } from './scan.js';

const NEXT_CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts', 'next.config.mts'];
const ROUTING_SETTINGS = ['basePath', 'rewrites', 'pageExtensions'];
const MAX_CONFIG_BYTES = 256 * 1024;

/**
 * @param {string} root
 * @returns {Promise<string[]>}
 */
async function unreadNextSettings(root) {
  for (const name of NEXT_CONFIGS) {
    const bytes = await readFileInside(root, name, MAX_CONFIG_BYTES);
    if (bytes === null) continue;
    const text = bytes.toString('utf8');
    return ROUTING_SETTINGS.filter((setting) => new RegExp(`\\b${setting}\\b`).test(text));
  }
  return [];
}

/**
 * @typedef {Object} SourceMatch
 * @property {string} file            Relative to the source folder.
 * @property {string} route
 * @property {'page'|'handler'|'metadata'|'public'|'file'} kind
 * @property {string|null} rootLayout
 * @property {boolean} exact   False when only a dynamic or catch-all route matched.
 */

/**
 * A project folder, read once: what it is and which file answers a URL path.
 * @typedef {Object} ProjectSources
 * @property {Detection} detection
 * @property {string} sourceDir       Absolute real path.
 * @property {string} relative        The source folder seen from the project folder ('' when they are the same).
 * @property {boolean} truncated      The file listing was cut at its limit.
 * @property {{route: string, file: string, kind: string}[]} routes  Pages and files that have a URL, sorted by route.
 * @property {string[]} files         Every listed file, relative to the source folder: the app and `public` folders of a
 *   Next.js project, the whole folder of a plain HTML one. Empty for a project that is not supported.
 * @property {(pathname: string) => SourceMatch|null} resolve
 * @property {string[]} unreadSettings  Settings found in next.config that change which file answers a URL and that the
 *   mapping does not know (`basePath`, `rewrites`, `pageExtensions`). The file is searched as text, never run.
 */

/** Findings about the server or about measurements at Google: no file of the project is where they come from. */
const NO_SOURCE = /^seo\.(?:https\.(?:site_not_https|not_enforced)|cwv\.)/;

/** Findings about the document itself, which the outermost layout of a Next.js route renders. */
const DOCUMENT_CHECKS = new Set(['seo.html.lang_missing', 'seo.mobile.viewport_missing']);

/**
 * Read a project folder: detect what it is and list the files that can answer a URL.
 *
 * Guarantees: `sourceDir` is the project folder or lies inside it once links
 * are resolved (otherwise `RepoError`); no symbolic link is followed while
 * listing; nothing in the project is executed or imported. For a project that
 * is not supported, `resolve` answers null for every path.
 *
 * @param {string} projectDir   Absolute path of the project folder, the boundary.
 * @param {string} [sourceDir]  Absolute path of the web project inside it; defaults to the project folder.
 * @returns {Promise<ProjectSources>}
 */
export async function loadProjectSources(projectDir, sourceDir) {
  const dirs = await resolveSourceDir(projectDir, sourceDir);
  const detection = await detectProject(dirs.sourceDir);
  const base = { detection, sourceDir: dirs.sourceDir, relative: dirs.relative };

  if (detection.framework === 'next-app' && detection.app_dir !== null) {
    const app = await listFiles(dirs.sourceDir, detection.app_dir);
    const pub = await listFiles(dirs.sourceDir, 'public');
    const routes = buildNextRoutes(app.files, detection.app_dir);
    const publicFiles = new Set(pub.files.map((file) => file.slice('public/'.length)));
    return {
      ...base,
      truncated: app.truncated || pub.truncated,
      files: [...app.files, ...pub.files],
      unreadSettings: await unreadNextSettings(dirs.sourceDir),
      // Shown: every route a file certainly has, and the HTML files in public/. The extra addresses a
      // metadata file gets only when its code produces several files ("[id]") are matched but not listed.
      routes: [
        ...routes.filter((route) => !(route.kind === 'metadata' && /\[id\]/.test(route.route))).map(({ route, file, kind }) => ({ route, file, kind })),
        ...pub.files.filter(isHtmlFile).map((file) => ({ route: file.slice('public'.length), file, kind: 'public' })),
      ]
        .sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : a.file < b.file ? -1 : 1)),
      resolve: (pathname) => matchNextRoute(routes, publicFiles, pathname),
    };
  }
  if (detection.framework === 'html') {
    const listing = await listFiles(dirs.sourceDir);
    const files = new Set(listing.files);
    return {
      ...base,
      truncated: listing.truncated,
      files: listing.files,
      unreadSettings: [],
      routes: listing.files.filter(isHtmlFile).map((file) => ({ route: `/${file}`, file, kind: 'file' })),
      resolve: (pathname) => {
        const file = matchHtmlFile(files, pathname);
        return file === null ? null : { file, route: pathname, kind: 'file', rootLayout: null, exact: true };
      },
    };
  }
  return { ...base, truncated: false, files: [], unreadSettings: [], routes: [], resolve: () => null };
}

/**
 * The path of a URL when it belongs to the audited site, otherwise null.
 * @param {string} url
 * @param {string} siteOrigin
 * @returns {string|null}
 */
function sitePath(url, siteOrigin) {
  try {
    const parsed = new URL(url);
    return parsed.origin === siteOrigin ? parsed.pathname : null;
  } catch {
    return null;
  }
}

/**
 * Add `source` to every finding whose source file can be determined, and
 * leave the others exactly as they are. Finding ids are not touched.
 *
 * - Next.js: the file of the route that answers the finding's URL (a page, a
 *   route handler, a metadata file such as `robots.ts`, or a file in
 *   `public/`), only when what the server sent fits: a URL that redirected or
 *   answered 404 names no file, and a route with a dynamic segment is named
 *   only for a URL that answered 200. Findings about the document itself (`lang`, viewport) name the
 *   route's outermost layout. No line is given: the plugin does not read the
 *   project's code.
 * - Plain HTML, and an HTML file in a Next.js `public/` folder: the file,
 *   only when the crawled page has the content of that file (`sameDocument`),
 *   with the line of the element in the file.
 *
 * @param {Finding[]} findings
 * @param {CrawlResult} crawl
 * @param {ProjectSources} sources
 * @returns {Promise<{findings: Finding[], summary: RepoSummary, notes: string[]}>}
 */
export async function attachSources(findings, crawl, sources) {
  const { detection } = sources;
  /** @type {Map<string, PageRecord>} */
  const pageByUrl = new Map();
  for (const page of crawl.pages) {
    if (!pageByUrl.has(page.url)) pageByUrl.set(page.url, page);
  }
  /** Status the server gave each URL: pages, sitemap files and robots.txt. @type {Map<string, number>} */
  const statusByUrl = new Map();
  // A crawl file from disk is not trusted to be complete.
  if (crawl.robots) statusByUrl.set(crawl.robots.url, crawl.robots.http_status);
  for (const file of crawl.sitemap?.files ?? []) statusByUrl.set(file.url, file.status);
  for (const [url, page] of pageByUrl) statusByUrl.set(url, page.status);
  const inProject = (/** @type {string} */ file) => (sources.relative === '' ? file : `${sources.relative}/${file}`);

  /** What a source file holds, or null when it could not be read. @type {Map<string, {record: PageRecord, anchors: HtmlAnchors}|null>} */
  const htmlFiles = new Map();
  /**
   * @param {string} file
   * @param {PageRecord} served
   */
  const readHtml = async (file, served) => {
    if (htmlFiles.has(file)) return htmlFiles.get(file) ?? null;
    const body = await readFileInside(sources.sourceDir, file);
    const loaded = body === null ? null : {
      record: extractPage({
        url: served.url,
        result: {
          url: served.url, finalUrl: served.url, status: 200, headers: { 'content-type': 'text/html' }, headerLines: { 'content-type': ['text/html'] },
          redirectChain: [], body, truncated: false, bytes: body.length, elapsedMs: 0, error: null,
        },
        depth: served.depth,
        discoveredVia: served.discovered_via,
        siteHost: crawl.site_host,
        includeSubdomains: crawl.options.include_subdomains,
      }),
      anchors: htmlAnchors(decodeBody(body, 'text/html').text),
    };
    htmlFiles.set(file, loaded);
    return loaded;
  };

  /** @type {Set<string>} */
  const differing = new Set();
  /**
   * @param {Finding} finding
   * @returns {Promise<FindingSource|null>}
   */
  const sourceOf = async (finding) => {
    if (finding.url === null || NO_SOURCE.test(finding.check_id)) return null;
    const pathname = sitePath(finding.url, crawl.site_origin);
    const match = pathname === null ? null : sources.resolve(pathname);
    if (match === null) return null;

    if (isHtmlFile(match.file)) {
      const served = pageByUrl.get(finding.url);
      if (!served || served.status !== 200 || !served.is_html) return null;
      const loaded = await readHtml(match.file, served);
      if (loaded === null || !sameDocument(served, loaded.record)) {
        differing.add(match.file);
        return null;
      }
      const line = finding.line === null ? anchorLine(finding.check_id, loaded.anchors) : sourceLine(finding.line, served, loaded.record);
      return { file: inProject(match.file), line, route: match.route };
    }

    // The route table says which file could answer the URL; the status says whether it did. A redirect or a
    // 404 comes from somewhere else (next.config, a missing page), and a dynamic route matches any name, so
    // it is trusted only for a URL the server answered with 200.
    const status = statusByUrl.get(finding.url);
    // A dynamic match is no evidence at all when something the mapping cannot see may have answered instead:
    // a file in a dot folder of public/ (never listed), or a URL that basePath or a rewrite changed.
    const unseen = pathname !== null && (/(?:^|\/)\./.test(pathname) || sources.unreadSettings.some((setting) => setting !== 'pageExtensions'));
    const answered = match.exact ? status === 200 || status === undefined || status >= 500 : status === 200 && !unseen;
    if (!answered) return null;
    const file = DOCUMENT_CHECKS.has(finding.check_id) && match.kind === 'page' ? match.rootLayout : match.file;
    return file === null ? null : { file: inProject(file), line: null, route: match.route };
  };

  /** @type {Finding[]} */
  const out = [];
  let withSource = 0;
  for (const finding of findings) {
    const source = detection.supported ? await sourceOf(finding) : null;
    if (source !== null) withSource += 1;
    out.push(source === null ? finding : { ...finding, source });
  }

  const htmlPages = crawl.pages.filter((page) => page.status === 200 && page.is_html);
  const matched = htmlPages.filter((page) => {
    const pathname = sitePath(page.url, crawl.site_origin);
    return pathname !== null && sources.resolve(pathname) !== null;
  }).length;

  const notes = [];
  if (!detection.supported) {
    notes.push(`Findings were not mapped to source files. ${detection.message}`);
  } else {
    if (htmlPages.length > 0 && matched === 0) {
      notes.push(`No crawled page matches a file of this project, so no finding names a source file. Check that the server at ${crawl.site_origin} serves the project in this folder.`);
    }
    if (differing.size > 0) {
      const files = differing.size === 1 ? '1 file differs' : `${differing.size} files differ`;
      notes.push(`${files} from what the server sent for the same address, so findings on ${differing.size === 1 ? 'that page name' : 'those pages name'} no source file. The file may have changed since the crawl, or the server changes the page before sending it.`);
    }
    if (sources.truncated) notes.push('The project has more files than the plugin lists, so some findings may be missing their source file.');
    if (sources.unreadSettings.length > 0) {
      notes.push(`next.config mentions ${sources.unreadSettings.join(', ')}. The plugin does not read that file's settings, so a URL they change gets no source file${sources.unreadSettings.some((setting) => setting !== 'pageExtensions') ? ', and routes with a dynamic segment are not named at all' : ''}. A route of fixed segments that such a setting moves can still be named wrongly.`);
    }
    if (detection.framework === 'next-app') {
      notes.push('For a Next.js project the source file is the page file of the route (the outermost layout for the lang attribute and the viewport). An element shared by several pages usually lives in a layout or in a component the page imports.');
    }
  }

  return {
    findings: out,
    summary: {
      framework: detection.framework,
      label: detection.label,
      source_dir: sources.relative === '' ? '.' : sources.relative,
      ...(crawl.options?.deployed_origin ? { deployed_origin: crawl.options.deployed_origin, deployed_localized: crawl.options.deployed_localized ?? 0 } : {}),
      findings_with_source: withSource,
      pages_matched: matched,
      pages_total: htmlPages.length,
    },
    notes,
  };
}
