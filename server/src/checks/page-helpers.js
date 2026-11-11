/** @import { PageRecord } from '../types.js' */

// Small questions about a page that several checks ask. Shared so the SEO and
// links modules answer them the same way.

/**
 * True when the page tells search engines not to index it, through a robots
 * meta tag or an X-Robots-Tag header.
 * @param {PageRecord} page
 * @returns {boolean}
 */
export function isNoindex(page) {
  const { reasons } = page.indexability;
  return reasons.includes('noindex_meta') || reasons.includes('noindex_header');
}

/**
 * Distinct URLs named by the page's effective canonicals, in document order.
 * A canonical is effective when it is in `<head>` or in an HTTP header and has
 * a valid URL; search engines ignore the others.
 * @param {PageRecord} page
 * @returns {string[]}
 */
export function effectiveCanonicalUrls(page) {
  /** @type {string[]} */
  const urls = [];
  for (const canonical of page.canonicals) {
    if (canonical.in_head && canonical.url !== null && !urls.includes(canonical.url)) {
      urls.push(canonical.url);
    }
  }
  return urls;
}

/**
 * First entry that has visible text, trimmed; null when there is none.
 * @param {string[]} values
 * @returns {string|null}
 */
export function firstNonEmpty(values) {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed !== '') return trimmed;
  }
  return null;
}

const UNVERIFIABLE_REASONS = new Set(['bot_challenge', 'rate_limited', 'robots_disallowed']);

/**
 * True when the audit could not read this URL for a reason that says nothing
 * about the site: its firewall challenged the crawler, it rate-limited the
 * crawler, or robots.txt disallows the URL. Such a record is never a unit of a
 * check, because a status the crawler was refused with is not the status a
 * visitor or a search engine gets.
 * @param {PageRecord} page
 * @returns {boolean}
 */
export function isUnverifiable(page) {
  return page.fetch_error !== null && UNVERIFIABLE_REASONS.has(page.fetch_error);
}

/**
 * True for a record whose own answer was a redirect.
 * @param {PageRecord} page
 * @returns {boolean}
 */
export function isRedirectRecord(page) {
  return page.status >= 300 && page.status < 400;
}
