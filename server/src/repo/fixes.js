// /seekwide:fix, the server's part: for each finding of a repo-mode run, say
// whether a metadata fix applies, which file it belongs in and what the page
// sends today. The server writes nothing; the model edits the file after the
// user approved the diff.
//
// Scope (PLAN 4.4): a missing or duplicate title and meta description, a
// missing canonical, missing Open Graph tags, a missing sitemap (with the
// robots.txt line that names it). Anything else is counted, not planned.

/** @import { CrawlResult, Finding, PageRecord, Run } from '../types.js' */
/** @import { ProjectSources } from './sources.js' */

import { SEVERITIES } from '../config.js';
import { clip } from '../util/strings.js';
import { htmlHow, nextHow, sitemapHow } from './fix-texts.js';
import { isHtmlFile } from './html-routes.js';

/**
 * The checks a fix exists for. `unit` says which pages the check looks at,
 * which the re-audit needs to know before it calls a finding closed.
 * @type {Readonly<Record<string, {type: 'title'|'meta_description'|'canonical'|'open_graph'|'sitemap', action: 'add'|'make_unique'|'remove_extra'|'create', unit: 'indexable'|'html'|'site'}>>}
 */
export const FIXABLE_CHECKS = Object.freeze({
  'seo.title.missing': { type: 'title', action: 'add', unit: 'indexable' },
  'seo.title.duplicate': { type: 'title', action: 'make_unique', unit: 'indexable' },
  'seo.title.multiple': { type: 'title', action: 'remove_extra', unit: 'html' },
  'seo.meta_description.missing': { type: 'meta_description', action: 'add', unit: 'indexable' },
  'seo.meta_description.duplicate': { type: 'meta_description', action: 'make_unique', unit: 'indexable' },
  'seo.meta_description.multiple': { type: 'meta_description', action: 'remove_extra', unit: 'html' },
  'seo.canonical.missing': { type: 'canonical', action: 'add', unit: 'indexable' },
  'seo.social.og_incomplete': { type: 'open_graph', action: 'add', unit: 'indexable' },
  'seo.sitemap.missing': { type: 'sitemap', action: 'create', unit: 'site' },
});

/** Metadata findings that are deliberately not repaired, with the reason given to the user. */
const REFUSED_CHECKS = Object.freeze({
  'seo.canonical.streamed_in_body':
    'Next.js sent this page\'s metadata in the body because it was not ready in time. Moving tags by hand does not change that. The choice is the project owner\'s: metadata that does not wait for slow data, or the htmlLimitedBots setting in next.config.',
});

const PAGE_FILE = /^page\.(?:js|jsx|ts|tsx)$/;
const LAYOUT_FILES = ['layout.tsx', 'layout.jsx', 'layout.ts', 'layout.js'];
const OG_TAGS = new Set(['og:title', 'og:image']);
const MAX_SITEMAP_PATHS = 200;
const MAX_SHARED = 10;
const CURRENT_CLIP = 300;
const PLAIN_PATH = /^[\w@()[\].~+,=-]+(?:\/[\w@()[\].~+,=-]+)*$/;

/**
 * A file name taken from a stored run, when it is a plain relative path and
 * short; otherwise null. A run is a JSON file that can come with a repository
 * someone else wrote, so a "file name" in it may be a sentence meant for the
 * model. Such a value is never passed on.
 * @param {unknown} file
 * @returns {string|null}
 */
export function plainPath(file) {
  if (typeof file !== 'string' || file.length > CURRENT_CLIP || !PLAIN_PATH.test(file)) return null;
  return file.split('/').some((part) => part === '..' || part === '.') ? null : file;
}

/**
 * @typedef {Object} FixEntry
 * @property {string} finding_id
 * @property {string} check_id
 * @property {string} title
 * @property {string} severity
 * @property {string|null} url
 * @property {string} type            What is fixed: 'title', 'meta_description', 'canonical', 'open_graph' or 'sitemap'.
 * @property {string} action          'add', 'make_unique', 'remove_extra', 'repair' or 'create'.
 * @property {'next-app'|'html'} kind  How the file is edited: a Next.js metadata export, or an HTML `<head>`.
 * @property {string|null} file       The file to edit, relative to the project folder; null for a fix that only creates files.
 * @property {number|null} line
 * @property {string|null} route
 * @property {string} how             What to change, in the plugin's own words.
 * @property {boolean} needs_site_url  The fix writes the deployed address of the site, which the local server does not know.
 * @property {object|null} [current]  What the page sent in the audited crawl; null when that crawl is no longer stored.
 * @property {string[]} [layouts]     Next.js: the layout files above the page, nearest first.
 * @property {boolean} [dynamic]      Next.js: the file answers more than one address.
 * @property {{url: string, file: string|null}[]} [shares_with]  A duplicate: the other pages with the same value.
 * @property {string[]} [missing]     Open Graph: the tags that are missing.
 * @property {{path: string, url: string|null}} [canonical]  The canonical to write: the page's path, and the full URL when the deployed address is known.
 * @property {{file: string, purpose: string}[]} [create]  Files to create.
 * @property {{file: string, purpose: string}[]} [edit]    Other files to change.
 * @property {string[]} [sitemap_paths]   Paths of the pages the sitemap should list.
 * @property {string[]} [dynamic_routes]  Next.js routes whose addresses are not known from file names.
 */

/**
 * @typedef {Object} FixPlan
 * @property {FixEntry[]} fixes
 * @property {{finding_id: string, check_id: string, title: string, url: string|null, file: string|null, reason: string}[]} notFixable
 *   `reason` is one of a fixed set of sentences; the file it is about is in `file`, never in the sentence.
 * @property {Record<string, number>} outOfScope  Findings of checks no fix exists for, counted by check id.
 */

/**
 * What a page sent for the tags a metadata fix is about. Text from the page, clipped.
 * @param {PageRecord} page
 */
function currentOf(page) {
  /** @type {Record<string, string>} */
  const og = {};
  for (const name of ['title', 'description', 'image', 'url', 'type']) {
    if (typeof page.og[name] === 'string') og[name] = clip(page.og[name], CURRENT_CLIP);
  }
  return {
    titles: page.titles.slice(0, 3).map((title) => clip(title, CURRENT_CLIP)),
    meta_descriptions: page.meta_descriptions.slice(0, 3).map((text) => clip(text, CURRENT_CLIP)),
    canonicals: page.canonicals.slice(0, 5).map(({ href, source, in_head }) => ({ href: clip(href, CURRENT_CLIP), source, in_head })),
    og,
  };
}

/**
 * The path and query of a URL, as a canonical or a sitemap names it.
 * @param {string} url
 * @returns {string|null}
 */
function pathOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * Layout files above a file of the app folder, nearest first.
 * @param {string} file     Relative to the source folder.
 * @param {string} appDir
 * @param {Set<string>} files
 * @returns {string[]}
 */
function layoutsAbove(file, appDir, files) {
  /** @type {string[]} */
  const found = [];
  const parts = file.split('/').slice(0, -1);
  while (parts.join('/').length >= appDir.length && parts.length > 0) {
    const dir = parts.join('/');
    const layout = LAYOUT_FILES.map((name) => `${dir}/${name}`).find((candidate) => files.has(candidate));
    if (layout) found.push(layout);
    if (dir === appDir) break;
    parts.pop();
  }
  return found;
}

/**
 * Plan the metadata fixes for the findings of a repo-mode run.
 *
 * Guarantees: only findings of `run` are planned, and each exactly once: as a
 * fix, as not fixable with the reason, or counted as out of scope. A fix names
 * a file only when the finding names it and the project still has it. Nothing
 * is read from the project besides the file listing in `sources`, and nothing
 * is written. `how` and `reason` are the plugin's own words: `reason` is a
 * fixed sentence, and no string of the stored run is part of either. `title`
 * comes from `titles` (the check definitions), never from the run; a file
 * name from the run is passed on only when it is a plain relative path. Text
 * taken from a page appears only under `current` and in URLs and routes.
 *
 * @param {{run: Run, sources: ProjectSources, crawl: CrawlResult|null, siteUrl: string|null, titles?: Record<string, string>}} input
 *   `crawl`: the crawl the run was made from, when it is still stored. `siteUrl`: the origin the site is deployed at.
 *   `titles`: the title of each check, by id; a check without one is named by its id.
 * @returns {FixPlan}
 */
export function planFixes({ run, sources, crawl, siteUrl, titles = {} }) {
  const files = new Set(sources.files);
  const prefix = sources.relative === '' ? '' : `${sources.relative}/`;
  const inProject = (/** @type {string} */ file) => `${prefix}${file}`;
  /** A finding's file as the listing names it, or null when the project does not have it. @param {string} file */
  const listed = (file) => {
    if (!file.startsWith(prefix)) return null;
    const local = file.slice(prefix.length);
    return files.has(local) ? local : null;
  };
  /** @type {Map<string, PageRecord>} */
  const pages = new Map();
  for (const page of crawl?.pages ?? []) if (!pages.has(page.url)) pages.set(page.url, page);
  /** @type {Map<string, Finding>} */
  const byCheckAndUrl = new Map();
  for (const finding of run.findings) if (finding.url !== null) byCheckAndUrl.set(`${finding.check_id}\n${finding.url}`, finding);
  const appDir = sources.detection.app_dir;
  const isNext = sources.detection.framework === 'next-app' && appDir !== null;

  /** @type {FixPlan} */
  const plan = { fixes: [], notFixable: [], outOfScope: {} };
  const titleOf = (/** @type {Finding} */ finding) => (Object.hasOwn(titles, finding.check_id) ? titles[finding.check_id] : finding.check_id);
  /**
   * @param {Finding} finding
   * @param {string} reason  A fixed sentence.
   * @param {string|null} [file]  A file of the listing; defaults to the finding's own, when it is a plain path.
   */
  const refuse = (finding, reason, file = plainPath(finding.source?.file)) => {
    plan.notFixable.push({ finding_id: finding.id, check_id: finding.check_id, title: titleOf(finding), url: finding.url, file, reason });
  };
  /** @param {Finding} finding */
  const base = (finding) => ({
    finding_id: finding.id, check_id: finding.check_id, title: titleOf(finding),
    severity: SEVERITIES.includes(finding.severity) ? finding.severity : 'info', url: finding.url,
  });

  /** @param {Finding} finding */
  const planSitemap = (finding) => {
    const lines = /** @type {{robots_sitemap_lines?: unknown}} */ (finding.evidence?.observed ?? {}).robots_sitemap_lines;
    if (typeof lines === 'number' && lines > 0) {
      return refuse(finding, 'robots.txt already names a sitemap, and that sitemap could not be read. Correct the address in robots.txt or make it answer; creating a second sitemap would not help.');
    }
    const ext = sources.files.some((file) => /\.tsx?$/.test(file)) ? 'ts' : 'js';
    const sitemapFile = isNext ? `${appDir}/sitemap.${ext}` : 'sitemap.xml';
    const existingSitemap = isNext
      ? [`${appDir}/sitemap.js`, `${appDir}/sitemap.ts`, `${appDir}/sitemap.xml`, 'public/sitemap.xml'].find((file) => files.has(file))
      : files.has('sitemap.xml') ? 'sitemap.xml' : undefined;
    if (existingSitemap) {
      return refuse(finding, 'The project already has a sitemap file (named under example_files), but the server sent no sitemap at /sitemap.xml. Find out why that file is not served before adding another.', inProject(existingSitemap));
    }
    const robotsFile = isNext
      ? [`${appDir}/robots.js`, `${appDir}/robots.ts`, `${appDir}/robots.txt`, 'public/robots.txt'].find((file) => files.has(file))
      : files.has('robots.txt') ? 'robots.txt' : undefined;
    const newRobots = isNext ? `${appDir}/robots.${ext}` : 'robots.txt';
    const indexable = (crawl?.pages ?? []).filter((page) => page.indexability.indexable).map((page) => pathOf(page.url)).filter((path) => path !== null);
    const fromFiles = sources.routes.filter((route) => (isNext ? route.kind === 'page' && !route.route.includes('[') : true)).map((route) => (isNext ? route.route : route.route.replace(/(^|\/)index\.html?$/, '$1')));
    const paths = [...new Set(crawl ? indexable : fromFiles)].sort();
    const dynamicRoutes = isNext ? sources.routes.filter((route) => route.kind === 'page' && route.route.includes('[')).map((route) => route.route) : [];
    plan.fixes.push({
      ...base(finding),
      type: 'sitemap',
      action: 'create',
      kind: isNext ? 'next-app' : 'html',
      file: null,
      line: null,
      route: null,
      how: sitemapHow({ next: isNext, sitemapFile: inProject(sitemapFile), robotsFile: robotsFile ? inProject(robotsFile) : null, newRobots: inProject(newRobots), siteUrl }),
      needs_site_url: true,
      create: [
        { file: inProject(sitemapFile), purpose: 'The XML sitemap, served at /sitemap.xml.' },
        ...(robotsFile ? [] : [{ file: inProject(newRobots), purpose: 'robots.txt that allows crawling and names the sitemap.' }]),
      ],
      ...(robotsFile ? { edit: [{ file: inProject(robotsFile), purpose: 'Add the line that names the sitemap.' }] } : {}),
      sitemap_paths: paths.slice(0, MAX_SITEMAP_PATHS),
      ...(dynamicRoutes.length > 0 ? { dynamic_routes: dynamicRoutes.slice(0, MAX_SHARED) } : {}),
    });
  };

  /** @param {Finding} finding @param {typeof FIXABLE_CHECKS[string]} fix */
  const planPage = (finding, fix) => {
    const { source } = finding;
    if (!source || finding.url === null) {
      return refuse(finding, 'The audit could not say which source file this page comes from (the notes of the run say what limits the mapping), so there is no file to change safely.');
    }
    const file = listed(source.file);
    if (file === null) return refuse(finding, 'The source file this finding names is no longer in the project. Audit again, then plan the fixes from the new run.');
    const html = isHtmlFile(file);
    const name = file.slice(file.lastIndexOf('/') + 1);
    if (!html && !PAGE_FILE.test(name)) {
      return refuse(finding, /^page\.mdx?$/.test(name)
        ? 'The page is a Markdown page. How its metadata is set depends on the project\'s MDX setup, which the plugin does not read.'
        : 'The file that answers this address is not a page file, so it has no metadata export to change.');
    }
    if (!html && fix.action === 'remove_extra') {
      return refuse(finding, 'The page sends this tag more than once. In a Next.js project one comes from the metadata export and the other from a tag written by hand in a layout, a page or a component, and the plugin cannot tell in which file. Search the project for the hand-written tag and remove it.');
    }
    const page = pages.get(finding.url) ?? null;
    let action = /** @type {string} */ (fix.action);
    if (fix.type === 'canonical' && typeof finding.evidence?.observed === 'string' && finding.evidence.observed.startsWith('Canonical links exist')) {
      if (!html) {
        return refuse(finding, 'The page already sends a canonical link that search engines do not read (outside the head, or not a valid URL), and the plugin cannot tell which file writes it. Find that link in the project and correct it; adding a second canonical would make things worse.');
      }
      action = 'repair';
    }
    const missing = fix.type === 'open_graph'
      ? (Array.isArray(/** @type {{missing?: unknown}} */ (finding.evidence?.observed ?? {}).missing)
        ? /** @type {unknown[]} */ (/** @type {{missing: unknown[]}} */ (finding.evidence.observed).missing).filter((tag) => typeof tag === 'string' && OG_TAGS.has(tag)).map(String)
        : [])
      : null;
    if (missing !== null && missing.length === 0) return refuse(finding, 'The finding does not say which Open Graph tags are missing. Audit again with the current version of the plugin.');
    const path = pathOf(finding.url);
    const canonical = fix.type === 'canonical' && path !== null ? { path, url: siteUrl === null ? null : `${siteUrl}${path}` } : null;
    const dynamic = !html && (source.route ?? '').includes('[');
    const sharesWith = fix.action === 'make_unique'
      ? finding.related_urls.slice(0, MAX_SHARED).map((url) => ({ url, file: plainPath(byCheckAndUrl.get(`${finding.check_id}\n${url}`)?.source?.file) }))
      : null;
    const needsSiteUrl = fix.type === 'canonical' || (missing !== null && missing.includes('og:image'));
    const texts = { type: fix.type, action, line: source.line, missing: missing ?? [], canonical, dynamic, sameFile: sharesWith !== null && sharesWith.some((other) => other.file === source.file), siteUrl };
    plan.fixes.push({
      ...base(finding),
      type: fix.type,
      action,
      kind: html ? 'html' : 'next-app',
      file: source.file,
      line: source.line,
      route: typeof source.route === 'string' ? clip(source.route, CURRENT_CLIP) : null,
      how: html ? htmlHow(texts) : nextHow(texts),
      needs_site_url: needsSiteUrl,
      current: page === null ? null : currentOf(page),
      ...(!html && appDir !== null ? { layouts: layoutsAbove(file, appDir, files).map(inProject), dynamic } : {}),
      ...(sharesWith !== null ? { shares_with: sharesWith } : {}),
      ...(missing !== null ? { missing } : {}),
      ...(canonical !== null ? { canonical } : {}),
    });
  };

  for (const finding of run.findings) {
    const fix = Object.hasOwn(FIXABLE_CHECKS, finding.check_id) ? FIXABLE_CHECKS[finding.check_id] : null;
    if (fix === null) {
      if (Object.hasOwn(REFUSED_CHECKS, finding.check_id)) refuse(finding, REFUSED_CHECKS[/** @type {keyof typeof REFUSED_CHECKS} */ (finding.check_id)]);
      else plan.outOfScope[finding.check_id] = (plan.outOfScope[finding.check_id] ?? 0) + 1;
    } else if (fix.type === 'sitemap') planSitemap(finding);
    else planPage(finding, fix);
  }
  return plan;
}
