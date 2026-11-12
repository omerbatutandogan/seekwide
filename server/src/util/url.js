// URL helpers shared by the crawler, the extractor and the checks.
// Everything here is pure and deterministic.

const TRACKING_PARAMS = new Set([
  'gclid', 'gbraid', 'wbraid', 'dclid', 'fbclid', 'msclkid', 'yclid',
  'mc_cid', 'mc_eid', 'igshid', '_hsenc', '_hsmi',
]);
const TRACKING_PREFIXES = ['utm_'];

// File extensions that are never HTML pages. Links to these are recorded but not crawled.
const NON_HTML_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp', 'tif', 'tiff',
  'css', 'js', 'mjs', 'map', 'json', 'xml', 'rss', 'atom', 'txt', 'csv',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods',
  'zip', 'gz', 'tar', 'rar', '7z', 'dmg', 'exe', 'apk', 'pkg',
  'mp3', 'mp4', 'm4a', 'm4v', 'mov', 'avi', 'webm', 'ogg', 'wav', 'flac',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'wasm',
]);

/**
 * @param {string} name Decoded query parameter name.
 * @returns {boolean}
 */
function isTrackingParam(name) {
  const lower = name.toLowerCase();
  if (TRACKING_PARAMS.has(lower)) return true;
  return TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * Remove tracking parameters from a raw query string (without the leading "?").
 * The remaining pairs keep their original order and encoding.
 * @param {string} query
 * @returns {string}
 */
function stripTrackingParams(query) {
  const kept = [];
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const rawName = pair.split('=', 1)[0];
    let name = rawName;
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, ' '));
    } catch {
      // Malformed escape: compare the raw name instead.
    }
    if (!isTrackingParam(name)) kept.push(pair);
  }
  return kept.join('&');
}

/**
 * The longest URL the plugin works with, in characters. Longer ones are treated
 * like URLs that are not http(s): never requested, never matched against
 * robots.txt rules, never stored. The sitemaps protocol sets the same limit.
 */
export const MAX_URL_LENGTH = 2048;
/** A raw value this long cannot shrink to a usable URL; it is refused before parsing. */
const MAX_RAW_URL_LENGTH = 8 * MAX_URL_LENGTH;

/**
 * Resolve and normalize a URL for crawling and de-duplication.
 *
 * - resolves `raw` against `base` when a base is given
 * - accepts only http and https
 * - lower-cases the scheme and host and drops default ports (done by `URL`)
 * - removes the fragment and any credentials
 * - removes known tracking parameters; other parameters keep order and encoding
 * - upper-cases the hex digits of percent escapes, so `%c3%a7` and `%C3%A7` are one URL
 *
 * Trailing slashes and letter case in the path are left alone: those are real
 * differences that the audit needs to see.
 *
 * @param {string} raw
 * @param {string} [base]
 * @returns {string|null} The normalized URL, or null when `raw` is not an http(s)
 *   URL or the result is longer than `MAX_URL_LENGTH`.
 */
export function normalizeUrl(raw, base) {
  if (typeof raw !== 'string' || raw.length > MAX_RAW_URL_LENGTH) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  let url;
  try {
    url = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  url.hash = '';
  url.username = '';
  url.password = '';
  if (url.search.length > 1) {
    const stripped = stripTrackingParams(url.search.slice(1));
    url.search = stripped === '' ? '' : `?${stripped}`;
  } else {
    url.search = '';
  }
  if (url.href.length > MAX_URL_LENGTH) return null;
  return url.href.replace(/%[0-9a-fA-F]{2}/g, (escape) => escape.toUpperCase());
}

/**
 * Split a `URL.host` value into its name and its port ('' when there is none).
 * @param {string} host  For example "example.com", "localhost:3000" or "[::1]:8080".
 * @returns {{name: string, port: string}}
 */
function splitHost(host) {
  const match = /^(.*?)(?::(\d+))?$/.exec(host.toLowerCase());
  return { name: match?.[1] ?? '', port: match?.[2] ?? '' };
}

/**
 * Key used to decide whether two URLs belong to the same site: the host in
 * lower case without a leading "www.", plus the port when the URL names one.
 *
 * `URL.host` leaves out the default port of its scheme, so http and https on
 * their default ports share a key, while another port is another site.
 * @param {string} host  A `URL.host` value (a bare host name works too).
 * @returns {string}
 */
export function hostKey(host) {
  const { name, port } = splitHost(host);
  const bare = name.startsWith('www.') ? name.slice(4) : name;
  return port === '' ? bare : `${bare}:${port}`;
}

/**
 * True when `url` belongs to the audited site: the same host (ignoring a
 * leading "www.") on the same port. The scheme does not matter, so the http
 * and https versions of a site are one site. A different port is a different
 * service and counts as external.
 * @param {string} url Absolute URL.
 * @param {string} siteHost `URL.host` of the audited site (with its port when not the default).
 * @param {boolean} [includeSubdomains] Treat subdomains of the site, on the same port, as internal.
 * @returns {boolean}
 */
export function isInternalUrl(url, siteHost, includeSubdomains = false) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  const key = hostKey(host);
  const siteKey = hostKey(siteHost);
  if (key === siteKey) return true;
  if (!includeSubdomains) return false;
  const candidate = splitHost(key);
  const site = splitHost(siteKey);
  return candidate.port === site.port && candidate.name.endsWith(`.${site.name}`);
}

/**
 * Rough "page template" of a URL: its first path segment plus the number of
 * segments, for example "/blog#2" for /blog/my-post. The crawler samples across
 * signatures so a small page budget still covers every section of a site.
 * @param {string} url Absolute URL.
 * @returns {string}
 */
export function templateSignature(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return '/#0';
  }
  const segments = pathname.split('/').filter((segment) => segment !== '');
  return `/${segments[0] ?? ''}#${segments.length}`;
}

/**
 * False for URLs whose path ends in a known non-HTML file extension.
 * @param {string} url Absolute URL.
 * @returns {boolean}
 */
export function looksLikeHtmlUrl(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = lastSegment.lastIndexOf('.');
  if (dot === -1) return true;
  return !NON_HTML_EXTENSIONS.has(lastSegment.slice(dot + 1).toLowerCase());
}

/**
 * @param {string} url Absolute URL.
 * @returns {string|null} Origin such as "https://example.com", or null for an invalid URL.
 */
export function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
