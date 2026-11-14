// Whether a project profile speaks for the audited site. robots.txt and the
// app association files are per host, so a profile applies only to its own
// host: neither a subdomain nor a sister domain nor another port.

/** @import { CrawlResult } from '../types.js' */

/**
 * A host as the crawl tells sites apart: lower case, without one trailing dot
 * or a leading "www.", with the port when the URL names one (another port is
 * another site; http and https on their default ports are one).
 * @param {string} url
 * @returns {string|null}  Null when `url` is not an http(s) URL.
 */
export function siteKey(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const name = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return parsed.port === '' ? name : `${name}:${parsed.port}`;
}

/**
 * Whether a profile whose `site_url` is given speaks for this crawl: 'site'
 * when that URL is on the crawled site's own host (or, for a local crawl told
 * where the project is deployed, on that deployed host), by `siteKey`;
 * 'no_site_url' when it has none that is an http(s) URL; 'other' otherwise.
 * The aso module's apps and the ai module's policy both follow this rule.
 * @param {unknown} siteUrl  `profile.site_url`.
 * @param {CrawlResult} crawl
 * @returns {'site'|'no_site_url'|'other'}
 */
export function profileSite(siteUrl, crawl) {
  const key = typeof siteUrl === 'string' && siteUrl !== '' ? siteKey(siteUrl) : null;
  if (key === null) return 'no_site_url';
  const own = [crawl.site_origin, crawl.options.deployed_origin].filter((value) => typeof value === 'string').map((value) => siteKey(/** @type {string} */ (value)));
  return own.includes(key) ? 'site' : 'other';
}
