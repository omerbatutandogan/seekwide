// A project's local server answers at http://localhost:3000, but its pages name
// the address the site is deployed at: in canonical links, in the Sitemap line
// of robots.txt and in the sitemap itself. Read literally, every such page
// points away from the site being audited. When the user names the deployed
// address, URLs on it are read as the same path on the local server.
//
// Nothing is ever requested from the deployed address.

/** @import { PageRecord } from '../types.js' */

import { indexabilityOf } from '../extract/indexability.js';
import { normalizeUrl, originOf } from '../util/url.js';

/**
 * The origin of the deployed site named by `value`.
 * @param {unknown} value  For example "https://www.example.com".
 * @returns {string}
 * @throws {TypeError} when the value is not an http or https URL.
 */
export function deployedOriginOf(value) {
  const url = typeof value === 'string' ? normalizeUrl(value) : null;
  const origin = url === null ? null : originOf(url);
  if (origin === null) {
    throw new TypeError(`"${String(value).slice(0, 200)}" is not an http or https URL. Pass the address the site is deployed at, such as https://www.example.com.`);
  }
  return origin;
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
 * True when `url` is on the host of the deployed site, whatever its scheme or
 * port, with or without "www." and a trailing dot. Used to keep every address
 * of that site out of requests, where `toLocalUrl` needs the exact origin.
 * @param {string} url
 * @param {string} deployedOrigin
 * @returns {boolean}
 */
export function onDeployedHost(url, deployedOrigin) {
  /** @param {string} value */
  const bare = (value) => new URL(value).hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  try {
    return bare(url) === bare(deployedOrigin);
  } catch {
    return false;
  }
}

/**
 * A page record whose canonicals on the deployed origin name the local server,
 * with its indexability worked out again. `href` keeps what the page sent, so
 * evidence still quotes the page. A record without such a canonical is
 * returned as it is.
 * @param {PageRecord} record
 * @param {string} deployedOrigin
 * @param {string} localOrigin
 * @returns {PageRecord}
 */
export function localizeRecord(record, deployedOrigin, localOrigin) {
  let changed = false;
  const canonicals = record.canonicals.map((canonical) => {
    if (canonical.url === null) return canonical;
    const url = toLocalUrl(canonical.url, deployedOrigin, localOrigin);
    if (url === canonical.url) return canonical;
    changed = true;
    return { ...canonical, url };
  });
  if (!changed) return record;
  const { indexability: _old, ...rest } = record;
  const next = { ...rest, canonicals };
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
