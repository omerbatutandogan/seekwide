// Which sharing images the audit checks, and which pages give each one
// (CHECKS-SPEC "Which sharing images are checked"). Pure.

/** @import { CheckContext, CrawlResult, PageRecord } from '../../types.js' */

import { LIMITS } from '../../config.js';
import { offLimitsHost, offLimitsReason } from '../../util/off-limits.js';
import { crawlIdentity } from '../../util/site-identity.js';
import { originOf } from '../../util/url.js';
import { compareText, declaredSize, sharingImage } from './helpers.js';

/**
 * @param {CrawlResult} crawl
 * @returns {PageRecord[]} The html pages, in crawl order.
 */
const htmlPagesOf = (crawl) => crawl.pages.filter((page) => page.status === 200 && page.is_html);

/**
 * The sharing image URLs to check, without randomness: each html page's
 * `og:image` (else `twitter:image`), resolved against the page, in crawl
 * order, each once, the first `max`. An image on Google Play or a social
 * platform's host is never chosen and is counted in `notRequested`; with
 * `skipSite`, no image on a host under the site's name (`sharesName`) is
 * chosen. For a site on this machine only images on its own origin are
 * chosen, so every chosen image is one the check may request.
 * @param {CrawlResult} crawl
 * @param {number} [max]
 * @param {boolean} [skipSite]
 * @returns {{urls: string[], images: number, notRequested: string[]}}  `images`: distinct http(s) sharing image URLs;
 *   `notRequested`: the distinct ones on hosts the plugin never contacts.
 */
export function selectSocialImages(crawl, max = LIMITS.maxSocialImageChecks, skipSite = false) {
  const skip = skipSite ? crawlIdentity(crawl).sharesName : null;
  // A crawl of a site on this machine checks only the images on that site's own address, as the media module does.
  const onlyOrigin = crawl.options.local === true ? crawl.site_origin : null;
  /** @type {Set<string>} */
  const all = new Set();
  /** @type {Set<string>} */
  const notRequested = new Set();
  /** @type {string[]} */
  const urls = [];
  for (const page of htmlPagesOf(crawl)) {
    const url = sharingImage(page)?.url ?? null;
    if (url === null || !/^https?:/.test(url) || all.has(url)) continue;
    all.add(url);
    if (offLimitsReason(url) !== null) {
      notRequested.add(url);
      continue;
    }
    if (skip !== null && skip(new URL(url).host)) continue;
    if (onlyOrigin !== null && originOf(url) !== onlyOrigin) continue;
    if (urls.length < max) urls.push(url);
  }
  return { urls, images: all.size, notRequested: [...notRequested] };
}

/**
 * The platform domains of off-limits URLs, as reports name them (`facebook.com`
 * for https://a_b.facebook.com/x), each once, sorted.
 * @param {string[]} urls
 * @returns {string[]}
 */
export const notRequestedHosts = (urls) => [...new Set(urls.map(offLimitsHost).filter(Boolean))].sort(compareText);

/**
 * Where a sharing image is given.
 * @typedef {Object} SharingUse
 * @property {string} url             The first html page, by sorted URL, that gives it.
 * @property {'og:image'|'twitter:image'} property  The property that page gives it with.
 * @property {string} value           The value as that page wrote it.
 * @property {{width: number, height: number}|null} declared  `og:image:width` and `og:image:height` of that page.
 * @property {string[]} others        The other pages, sorted.
 */

/**
 * For each sharing image URL of an html page, where it is given.
 * @param {CheckContext} ctx
 * @returns {Map<string, SharingUse>}
 */
export function sharingUses(ctx) {
  /** @type {Map<string, PageRecord[]>} */
  const byImage = new Map();
  for (const page of ctx.htmlPages) {
    const url = sharingImage(page)?.url ?? null;
    if (url === null) continue;
    byImage.set(url, [...(byImage.get(url) ?? []), page]);
  }
  /** @type {Map<string, SharingUse>} */
  const result = new Map();
  for (const [url, pages] of byImage) {
    const [first, ...others] = [...pages].sort((a, b) => compareText(a.url, b.url));
    const image = /** @type {NonNullable<ReturnType<typeof sharingImage>>} */ (sharingImage(first));
    result.set(url, {
      url: first.url, property: image.property, value: image.value,
      declared: image.property === 'og:image' ? declaredSize(first) : null,
      others: others.map((page) => page.url).slice(0, LIMITS.maxRelatedUrls),
    });
  }
  return result;
}
