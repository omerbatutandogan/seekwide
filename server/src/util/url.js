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

const UNRESERVED = /^[A-Za-z0-9._~-]$/;

/** A `%` that does not start an escape. */
const LONE_PERCENT = /%(?![0-9a-fA-F]{2})/;

/**
 * Percent escapes of unreserved characters (letters, digits, `-`, `.`, `_`,
 * `~`) decoded, and the hex digits of every other escape upper-cased. RFC 3986
 * (6.2.2.1 and 6.2.2.2) makes both forms of such a URL equivalent, and RFC
 * 9309 (2.2.2) compares robots.txt paths this way. In a text with a `%` that
 * starts no escape nothing is decoded, because a decoded digit after it would
 * make a new escape (`%%37E` would become `%7E`); so applying this twice gives
 * what applying it once does.
 * @param {string} text
 * @returns {string}
 */
export function normalizeEscapes(text) {
  if (LONE_PERCENT.test(text)) return text.replace(/%[0-9a-fA-F]{2}/g, (escape) => escape.toUpperCase());
  return text.replace(/%[0-9a-fA-F]{2}/g, (escape) => {
    const char = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return UNRESERVED.test(char) ? char : escape.toUpperCase();
  });
}

/** Characters that may be written as typed or percent-encoded in a path, and that browsers leave as they are written. */
const LEFT_AS_TYPED = /%(?:21|27|28|29|2A)/gi;

/**
 * True when two normalized URLs name the same page as far as a canonical link
 * is concerned: equal once the escapes of `!`, `'`, `(`, `)` and `*` are
 * decoded. Browsers send these characters as they are written, so a page
 * linked as `/Today's_article` and a canonical to `/Today%27s_article` are one
 * page; RFC 3986 does not require the two to be equal, so `normalizeUrl` keeps
 * them apart.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function sameCanonicalTarget(a, b) {
  if (a === b) return true;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const plain = (/** @type {string} */ url) => url.replace(LEFT_AS_TYPED, (escape) => String.fromCharCode(Number.parseInt(escape.slice(1), 16)));
  return plain(a) === plain(b);
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
 * - upper-cases the hex digits of percent escapes, so `%c3%a7` and `%C3%A7` are one URL,
 *   and decodes the escapes of unreserved characters, so `%7Euser` and `~user` are one URL
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
  return normalizeEscapes(url.href);
}

// Whether a host is the audited site is decided in one place, site-identity.js;
// `hostKey` and `isInternalUrl` are re-exported for the modules that read them here.
export { hostKey, isInternalUrl } from './site-identity.js';

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
