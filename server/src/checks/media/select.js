// Which image files the audit checks (CHECKS-SPEC "Which image files are
// checked"), and which pages show each one. Pure.

/** @import { CheckContext, CrawlResult, ImageRecord, PageRecord } from '../../types.js' */

import { LIMITS } from '../../config.js';
import { originOf } from '../../util/url.js';
import { compareText, hasMedia, isRendered } from './helpers.js';

/**
 * The http(s) URLs of a page's rendered images, once each, in document order.
 * @param {PageRecord} page
 * @param {string|null} origin  When set, only URLs on this origin.
 * @param {string|null} [skipHost]  When set, no URL on this host.
 * @returns {string[]}
 */
function imageUrls(page, origin, skipHost = null) {
  const urls = new Set();
  for (const image of page.images) {
    const url = image.url;
    if (url === null || !isRendered(image) || !/^https?:/.test(url)) continue;
    if (origin !== null && originOf(url) !== origin) continue;
    if (skipHost !== null && new URL(url).host === skipHost) continue;
    urls.add(url);
  }
  return [...urls];
}

/**
 * The html pages with the media fields, in crawl order.
 * @param {CrawlResult} crawl
 */
function pagesOf(crawl) {
  return crawl.pages.filter((page) => page.status === 200 && page.is_html && hasMedia(page));
}

/**
 * The image URLs to check, without randomness: the html pages in crawl order
 * are gone through in rounds, each round taking each page's next URL that was
 * not chosen yet, so the first image of every page comes before the second of
 * any. A crawl of a site on this machine gets only images on its own origin,
 * and with `skipHost` no image on that host is chosen.
 * @param {CrawlResult} crawl
 * @param {number} [max]
 * @param {string|null} [skipHost]
 * @returns {{urls: string[], images: number}}  `images`: distinct image URLs the pages show.
 */
export function selectImageFiles(crawl, max = LIMITS.maxImageChecks, skipHost = null) {
  const pages = pagesOf(crawl);
  const origin = crawl.options.local === true ? crawl.site_origin : null;
  const all = new Set(pages.flatMap((page) => imageUrls(page, null)));
  const lists = pages.map((page) => imageUrls(page, origin, skipHost));
  const positions = lists.map(() => 0);
  /** @type {Set<string>} */
  const chosen = new Set();
  for (let progress = true; progress && chosen.size < max;) {
    progress = false;
    for (let i = 0; i < lists.length && chosen.size < max; i += 1) {
      const list = lists[i];
      while (positions[i] < list.length && chosen.has(list[positions[i]])) positions[i] += 1;
      if (positions[i] >= list.length) continue;
      chosen.add(list[positions[i]]);
      positions[i] += 1;
      progress = true;
    }
  }
  return { urls: [...chosen], images: all.size };
}

/**
 * Where an image file is shown.
 * @typedef {Object} FileUse
 * @property {string} url          The first html page, by sorted URL, that shows it.
 * @property {ImageRecord} image   Its first rendered `<img>` on that page.
 * @property {string[]} others     The other pages, sorted.
 * @property {boolean} responsive  An `<img>` that shows it has a `srcset` or sits in a `<picture>` with a `<source>`.
 * @property {boolean} modern      An `<img>` that shows it sits in a `<picture>` that offers AVIF or WebP.
 * @property {boolean} content     An `<img>` that shows it is in a page's content, not in its frame (navigation, header, footer, sidebar).
 */

/**
 * For each image URL shown in a rendered image on an html page, where it is shown.
 * @param {CheckContext} ctx
 * @returns {Map<string, FileUse>}
 */
export function fileUses(ctx) {
  /** @type {Map<string, {pages: Map<string, ImageRecord>, responsive: boolean, modern: boolean, content: boolean}>} */
  const uses = new Map();
  for (const page of ctx.htmlPages) {
    if (!hasMedia(page)) continue;
    for (const image of page.images) {
      if (image.url === null || !isRendered(image)) continue;
      let use = uses.get(image.url);
      if (!use) {
        use = { pages: new Map(), responsive: false, modern: false, content: false };
        uses.set(image.url, use);
      }
      if (!use.pages.has(page.url)) use.pages.set(page.url, image);
      use.responsive = use.responsive || image.has_srcset;
      use.modern = use.modern || image.modern_source === true;
      use.content = use.content || image.chrome !== true;
    }
  }
  /** @type {Map<string, FileUse>} */
  const result = new Map();
  for (const [url, use] of uses) {
    const [first, ...others] = [...use.pages.keys()].sort(compareText);
    result.set(url, {
      url: first, image: /** @type {ImageRecord} */ (use.pages.get(first)), others: others.slice(0, LIMITS.maxRelatedUrls),
      responsive: use.responsive, modern: use.modern, content: use.content,
    });
  }
  return result;
}
