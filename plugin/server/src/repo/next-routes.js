// Next.js App Router: which file answers a URL path. Built from file names
// only, following the documented file conventions (nextjs.org/docs/app,
// "Project structure" and "Metadata files", read 2026-11-11). The project's
// code and configuration are never read, so `basePath`, `pageExtensions`,
// rewrites and redirects from next.config are not known here; a URL they
// change maps to nothing instead of to a wrong file.

/**
 * @typedef {{type: 'static', value: string} | {type: 'dynamic'|'catchall'|'optional', name: string}} Segment
 */

/**
 * @typedef {Object} NextRoute
 * @property {'page'|'handler'|'metadata'} kind
 * @property {string} file        Path relative to the source folder, forward slashes.
 * @property {string} route       The route as Next.js names it, for example "/blog/[slug]". Route groups are left out.
 * @property {Segment[]} segments
 * @property {RegExp|null} leaf   For metadata files: what the last URL segment must look like.
 * @property {string|null} rootLayout  The outermost layout above the file, which renders `<html>`; null when there is none.
 */

/**
 * @typedef {Object} NextMatch
 * @property {string} file
 * @property {string} route
 * @property {'page'|'handler'|'metadata'|'public'} kind
 * @property {string|null} rootLayout
 * @property {boolean} exact   Every segment of the route is fixed (or the file is in `public/`), so no other
 *   address could have matched it. False for a match through a dynamic or catch-all segment.
 */

const CODE = '(?:js|jsx|ts|tsx)';
// `md` and `mdx` pages exist only where next.config lists them in `pageExtensions`; a project that
// has such a file has done so, and leaving it out would hand its URL to a dynamic route.
const PAGE = new RegExp(`^page\\.(?:js|jsx|ts|tsx|md|mdx)$`);
const HANDLER = new RegExp(`^route\\.${CODE}$`);
const LAYOUT = new RegExp(`^layout\\.${CODE}$`);

/** Image files that become routes: [base name, static extensions]. */
const IMAGE_FILES = /** @type {const} */ ([
  ['icon', 'ico|jpg|jpeg|png|svg'],
  ['apple-icon', 'jpg|jpeg|png'],
  ['opengraph-image', 'jpg|jpeg|png|gif'],
  ['twitter-image', 'jpg|jpeg|png|gif'],
]);

// Next.js adds a short hash to a metadata image's URL when the file sits in a route group.
const GROUP_SUFFIX = '(?:-[0-9a-z]{6})?';

/** @param {string} text */
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The URL segments a folder path stands for, or null when nothing under it is
 * a route of its own: private folders (`_name`), parallel-route slots
 * (`@name`) and intercepting routes (`(.)name`, `(..)name`, `(...)name`).
 * @param {string[]} folders
 * @returns {Segment[]|null}
 */
function folderSegments(folders) {
  /** @type {Segment[]} */
  const segments = [];
  for (const folder of folders) {
    if (folder.startsWith('_') || folder.startsWith('@') || /^\(\.{1,3}\)/.test(folder)) return null;
    if (/^\(.+\)$/.test(folder)) continue; // route group: organizes files, adds nothing to the URL
    const optional = /^\[\[\.\.\.(.+)\]\]$/.exec(folder);
    const catchall = /^\[\.\.\.(.+)\]$/.exec(folder);
    const dynamic = /^\[(.+)\]$/.exec(folder);
    if (optional) segments.push({ type: 'optional', name: optional[1] });
    else if (catchall) segments.push({ type: 'catchall', name: catchall[1] });
    else if (dynamic) segments.push({ type: 'dynamic', name: dynamic[1] });
    // "%5F" at the start of a folder name is how a URL segment that begins with an underscore is written.
    else segments.push({ type: 'static', value: /^%5f/i.test(folder) ? `_${folder.slice(3)}` : folder });
  }
  // A catch-all segment takes everything after it, so it can only come last.
  const early = segments.slice(0, -1).some((segment) => segment.type === 'catchall' || segment.type === 'optional');
  return early ? null : segments;
}

/** @param {Segment[]} segments */
function routeName(segments) {
  const parts = segments.map((segment) =>
    segment.type === 'static' ? segment.value
      : segment.type === 'dynamic' ? `[${segment.name}]`
        : segment.type === 'catchall' ? `[...${segment.name}]`
          : `[[...${segment.name}]]`);
  return `/${parts.join('/')}`;
}

/**
 * The routes a metadata file creates, as [extra fixed segments, pattern of the last URL segment, how that segment is shown].
 * @param {string} base  File name.
 * @param {boolean} atRoot  The file sits at the top of the app folder (route groups aside).
 * @returns {[string[], RegExp, string][]}
 */
function metadataRoutes(base, atRoot) {
  const code = new RegExp(`\\.${CODE}$`).test(base);
  const name = base.replace(/\.[^.]+$/, '');
  if (atRoot && (base === 'robots.txt' || (name === 'robots' && code))) return [[[], /^robots\.txt$/, 'robots.txt']];
  if (atRoot && base === 'favicon.ico') return [[[], /^favicon\.ico$/, 'favicon.ico']];
  if (atRoot && base === 'manifest.json') return [[[], /^manifest\.json$/, 'manifest.json']];
  if (atRoot && (base === 'manifest.webmanifest' || (name === 'manifest' && code))) return [[[], /^manifest\.webmanifest$/, 'manifest.webmanifest']];
  if (base === 'sitemap.xml') return [[[], /^sitemap\.xml$/, 'sitemap.xml']];
  // A sitemap written in code can also produce several files (generateSitemaps): /sitemap/<id>.xml.
  if (name === 'sitemap' && code) return [[[], /^sitemap\.xml$/, 'sitemap.xml'], [['sitemap'], /^[^/]+\.xml$/, '[id].xml']];
  for (const [image, extensions] of IMAGE_FILES) {
    const match = new RegExp(`^(${escapeRegExp(image)}\\d?)\\.(?:(${extensions})|${CODE})$`).exec(base);
    if (!match) continue;
    const [, stem, extension] = match;
    // A static image keeps its extension in the URL; one generated by code has none, and can produce several (generateImageMetadata).
    if (extension) return [[[], new RegExp(`^${escapeRegExp(stem)}${GROUP_SUFFIX}\\.${extension}$`), `${stem}.${extension}`]];
    return [[[], new RegExp(`^${escapeRegExp(stem)}${GROUP_SUFFIX}$`), stem], [[stem], /^[^/]+$/, '[id]']];
  }
  return [];
}

/**
 * Build the route table of an App Router project from its file list.
 * @param {string[]} files   Paths relative to the source folder, forward slashes.
 * @param {string} appDir    'app' or 'src/app'.
 * @returns {NextRoute[]}    Sorted by file, then route.
 */
export function buildNextRoutes(files, appDir) {
  const prefix = `${appDir}/`;
  const inApp = files.filter((file) => file.startsWith(prefix)).map((file) => ({ file, parts: file.slice(prefix.length).split('/') }));

  /** Layout file by the folder it sits in ('' is the app folder itself). @type {Map<string, string>} */
  const layouts = new Map();
  for (const { file, parts } of inApp) {
    const folder = parts.slice(0, -1).join('/');
    if (LAYOUT.test(/** @type {string} */ (parts.at(-1))) && !layouts.has(folder)) layouts.set(folder, file);
  }
  /** @param {string[]} folders */
  const rootLayoutOf = (folders) => {
    for (let depth = 0; depth <= folders.length; depth += 1) {
      const layout = layouts.get(folders.slice(0, depth).join('/'));
      if (layout) return layout;
    }
    return null;
  };

  /** @type {NextRoute[]} */
  const routes = [];
  for (const { file, parts } of inApp) {
    const base = /** @type {string} */ (parts.at(-1));
    const folders = parts.slice(0, -1);
    const segments = folderSegments(folders);
    if (segments === null) continue;
    const rootLayout = rootLayoutOf(folders);
    if (PAGE.test(base) || HANDLER.test(base)) {
      routes.push({ kind: PAGE.test(base) ? 'page' : 'handler', file, route: routeName(segments), segments, leaf: null, rootLayout });
      continue;
    }
    // A metadata file's own URL cannot follow a catch-all segment.
    if (segments.some((segment) => segment.type === 'catchall' || segment.type === 'optional')) continue;
    for (const [extra, leaf, shown] of metadataRoutes(base, segments.length === 0)) {
      const all = [...segments, ...extra.map((value) => /** @type {Segment} */ ({ type: 'static', value }))];
      routes.push({ kind: 'metadata', file, route: `${routeName(all) === '/' ? '' : routeName(all)}/${shown}`, segments: all, leaf, rootLayout });
    }
  }
  return routes.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
}

/**
 * The decoded segments of a URL path, or null when one cannot be decoded.
 * @param {string} pathname
 * @returns {string[]|null}
 */
export function pathSegments(pathname) {
  const segments = [];
  for (const raw of pathname.split('/')) {
    if (raw === '') continue;
    try {
      segments.push(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return segments;
}

/**
 * How specifically a route matches the URL segments: one number per route
 * segment (0 static, 1 dynamic, 2 catch-all, 3 optional catch-all), or null
 * when it does not match.
 * @param {NextRoute} route
 * @param {string[]} url
 * @returns {number[]|null}
 */
function score(route, url) {
  let rest = url;
  if (route.leaf !== null) {
    const last = url.at(-1);
    if (last === undefined || !route.leaf.test(last)) return null;
    rest = url.slice(0, -1);
  }
  /** @type {number[]} */
  const scores = [];
  for (const [index, segment] of route.segments.entries()) {
    if (segment.type === 'optional') return [...scores, 3];
    if (segment.type === 'catchall') return index < rest.length ? [...scores, 2] : null;
    if (index >= rest.length) return null;
    if (segment.type === 'static') {
      if (segment.value !== rest[index]) return null;
      scores.push(0);
    } else {
      scores.push(1);
    }
  }
  if (rest.length !== route.segments.length) return null;
  // The "[id]" leaf of a generated sitemap or image takes any name, so it counts as dynamic.
  return route.leaf === null ? scores : [...scores, route.route.endsWith(']') || route.route.endsWith('].xml') ? 1 : 0];
}

/**
 * @param {number[]} a
 * @param {number[]} b
 */
function compareScores(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? -1) - (b[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

/**
 * The file that answers a URL path in an App Router project, or null.
 *
 * Order, as in Next.js: a route made only of fixed segments, then a file in
 * `public/`, then the most specific route with dynamic segments (a dynamic
 * segment before a catch-all, a catch-all before an optional catch-all).
 * Matching is exact and case-sensitive on decoded segments; a trailing slash
 * and the query string play no part.
 *
 * A match that is not `exact` says only that a dynamic route could answer the
 * path. Whether it did depends on what the server sent, which the caller knows.
 *
 * @param {NextRoute[]} routes       From `buildNextRoutes`.
 * @param {Set<string>} publicFiles  Files under `public/`, relative to it.
 * @param {string} pathname          The path of a URL, still percent-encoded.
 * @returns {NextMatch|null}
 */
export function matchNextRoute(routes, publicFiles, pathname) {
  const url = pathSegments(pathname);
  if (url === null) return null;
  /** @type {{route: NextRoute, scores: number[]}|null} */
  let best = null;
  for (const route of routes) {
    const scores = score(route, url);
    if (scores === null) continue;
    if (best === null || compareScores(scores, best.scores) < 0) best = { route, scores };
  }
  const exact = best !== null && best.scores.every((value) => value === 0);
  const found = best === null ? null : { file: best.route.file, route: best.route.route, kind: best.route.kind, rootLayout: best.route.rootLayout, exact };
  if (exact) return found;
  const key = url.join('/');
  if (url.length > 0 && url.every((segment) => !segment.includes('/')) && publicFiles.has(key)) {
    return { file: `public/${key}`, route: `/${key}`, kind: 'public', rootLayout: null, exact: true };
  }
  return found;
}
