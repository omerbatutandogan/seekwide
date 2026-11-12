// A project's local server answers at http://localhost:3000, but its pages name
// the address the site is deployed at: in canonical links, in links written
// with the full address, in the Sitemap line of robots.txt and in the sitemap
// itself. Read literally, every such page points away from the site being
// audited. When the user names the deployed address, URLs on it are read as the
// same path on the local server.
//
// Nothing is ever requested from the deployed address.

/** @import { PageRecord } from '../types.js' */

import { indexabilityOf } from '../extract/indexability.js';
import { normalizeUrl, originOf } from '../util/url.js';

/**
 * The origin of the deployed site named by `value`. A host name written fully
 * qualified, with a trailing dot (`https://example.com.`), names the same site
 * as one without, and the pages of the site name it without, so the dot is
 * dropped.
 * @param {unknown} value  For example "https://www.example.com".
 * @returns {string}  Lower-case scheme and host, no trailing dot, the port only when it is not the default.
 * @throws {TypeError} when the value is not an http or https URL, or its host name has an empty label.
 */
export function deployedOriginOf(value) {
  const url = typeof value === 'string' ? normalizeUrl(value) : null;
  const origin = url === null ? null : originOf(url);
  if (origin === null) {
    throw new TypeError(`"${String(value).slice(0, 200)}" is not an http or https URL. Pass the address the site is deployed at, such as https://www.example.com.`);
  }
  const parsed = new URL(origin);
  if (!parsed.hostname.endsWith('.')) return origin;
  parsed.hostname = parsed.hostname.slice(0, -1);
  if (parsed.hostname === '' || parsed.hostname.endsWith('.') || parsed.hostname.includes('..')) {
    throw new TypeError(`"${String(value).slice(0, 200)}" has a host name with an empty label. Pass the address the site is deployed at, such as https://www.example.com.`);
  }
  return parsed.origin;
}

/**
 * `url` as an address on the local server when it is on the deployed origin
 * (same path and query), and unchanged otherwise. Only an exact origin counts:
 * another scheme, host name or port is another site.
 * @param {string} url
 * @param {string} deployedOrigin
 * @param {string} localOrigin
 * @returns {string}
 */
export function toLocalUrl(url, deployedOrigin, localOrigin) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.origin !== deployedOrigin) return url;
  return normalizeUrl(`${localOrigin}${parsed.pathname}${parsed.search}`) ?? url;
}

/**
 * A page record whose canonicals and links on the deployed origin name the
 * local server: the canonicals with the record's indexability worked out
 * again, the links as internal links that the crawl follows like any other.
 * `href` keeps what the page sent, so evidence and selectors still quote the
 * page. A record with neither is returned as it is.
 * @param {PageRecord} record
 * @param {string} deployedOrigin
 * @param {string} localOrigin  The origin of the local crawl, which is the audited site.
 * @returns {PageRecord}
 */
export function localizeRecord(record, deployedOrigin, localOrigin) {
  let canonicalChanged = false;
  const canonicals = record.canonicals.map((canonical) => {
    if (canonical.url === null) return canonical;
    const url = toLocalUrl(canonical.url, deployedOrigin, localOrigin);
    if (url === canonical.url) return canonical;
    canonicalChanged = true;
    return { ...canonical, url };
  });
  let linkChanged = false;
  const links = record.links.map((link) => {
    if (link.url === null) return link;
    const url = toLocalUrl(link.url, deployedOrigin, localOrigin);
    if (url === link.url) return link;
    linkChanged = true;
    return { ...link, url, internal: true };
  });
  if (!canonicalChanged && !linkChanged) return record;
  if (!canonicalChanged) return { ...record, links };
  const { indexability: _old, ...rest } = record;
  const next = { ...rest, canonicals, links };
  return { ...next, indexability: indexabilityOf(next) };
}

/**
 * URLs with those on the deployed origin read as local addresses, in order and
 * without repeats.
 * @param {string[]} urls
 * @param {string} deployedOrigin
 * @param {string} localOrigin
 * @returns {string[]}
 */
export function localizeUrls(urls, deployedOrigin, localOrigin) {
  return [...new Set(urls.map((url) => toLocalUrl(url, deployedOrigin, localOrigin)))];
}
