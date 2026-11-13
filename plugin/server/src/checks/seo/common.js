/** @import { CheckResult, PageRecord } from '../../types.js' */

// Shared pieces of the SEO check definitions: the documentation each rule is
// based on, the fields every definition has in common, and the grouping used by
// the duplicate checks.

/** Date the documentation below was last read and confirmed to support the rules. */
const LAST_VERIFIED = '2026-11-11';

/** Fields that are the same for every SEO check. */
export const SEO = Object.freeze({
  module: /** @type {const} */ ('seo'),
  engine: /** @type {const} */ ('code'),
  last_verified: LAST_VERIFIED,
});

/** Official documentation the rules are based on. */
export const DOCS = Object.freeze({
  ROBOTS_INTRO: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro',
  ROBOTS_SPEC: 'https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec',
  NOINDEX: 'https://developers.google.com/search/docs/crawling-indexing/block-indexing',
  CANONICAL: 'https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls',
  CANONICAL_TROUBLESHOOTING: 'https://developers.google.com/search/docs/crawling-indexing/canonicalization-troubleshooting',
  SITEMAP_OVERVIEW: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview',
  SITEMAP_BUILD: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap',
  TITLE: 'https://developers.google.com/search/docs/appearance/title-link',
  HTML_TITLE: 'https://html.spec.whatwg.org/multipage/semantics.html#the-title-element',
  SNIPPET: 'https://developers.google.com/search/docs/appearance/snippet',
  HTML_META_DESCRIPTION: 'https://html.spec.whatwg.org/multipage/semantics.html#meta-description',
  HTTP_STATUS: 'https://developers.google.com/crawling/docs/troubleshooting/http-status-codes',
  NETWORK_ERRORS: 'https://developers.google.com/crawling/docs/troubleshooting/dns-network-errors',
  REDIRECT_CHAINS: 'https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes',
  MOBILE: 'https://web.dev/articles/responsive-web-design-basics',
  HTTPS: 'https://web.dev/articles/why-https-matters',
  HTTPS_REDIRECT: 'https://web.dev/articles/enable-https',
  MIXED_CONTENT: 'https://web.dev/articles/what-is-mixed-content',
  LANG: 'https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html',
  HEADINGS: 'https://www.w3.org/WAI/tutorials/page-structure/headings/',
  STRUCTURED_DATA: 'https://developers.google.com/search/docs/appearance/structured-data/sd-policies',
  HELPFUL_CONTENT: 'https://developers.google.com/search/docs/fundamentals/creating-helpful-content',
  OPEN_GRAPH: 'https://ogp.me/',
  LCP: 'https://web.dev/articles/lcp',
  INP: 'https://web.dev/articles/inp',
  CLS: 'https://web.dev/articles/cls',
  LIGHTHOUSE_LCP: 'https://developer.chrome.com/docs/lighthouse/performance/lighthouse-largest-contentful-paint',
  LIGHTHOUSE_TBT: 'https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time',
});

/**
 * One result per unit: `fail` when another unit has the same key, `pass`
 * otherwise. Failing results list the other URLs of the group, sorted, in
 * `related_urls` and carry the extra fields `describe` returns.
 * @param {PageRecord[]} units
 * @param {(page: PageRecord) => string} keyOf
 * @param {(page: PageRecord, others: string[]) => Omit<CheckResult, 'status'|'url'|'related_urls'>} describe
 * @returns {CheckResult[]}
 */
export function duplicateResults(units, keyOf, describe) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const page of units) {
    const key = keyOf(page);
    const group = groups.get(key);
    if (group) group.push(page.url);
    else groups.set(key, [page.url]);
  }
  return units.map((page) => {
    const others = (groups.get(keyOf(page)) ?? []).filter((url) => url !== page.url).sort();
    if (others.length === 0) return { status: 'pass', url: page.url };
    return { status: 'fail', url: page.url, related_urls: others, ...describe(page, others) };
  });
}

/**
 * "1 other page uses" / "3 other pages use": the count with the verb in agreement.
 * @param {number} count
 * @param {string} singular  The verb after one page, for example "uses".
 * @param {string} pluralVerb  The verb after several, for example "use".
 * @returns {string}
 */
export function otherPages(count, singular, pluralVerb) {
  return count === 1 ? `1 other page ${singular}` : `${count} other pages ${pluralVerb}`;
}
