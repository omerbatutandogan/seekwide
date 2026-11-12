// Questions the media checks share. Pure.

/** @import { CheckContext, CheckResult, ImageRecord, PageRecord, VideoRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';

/** The date every rule of this module was read against its documentation. */
export const VERIFIED = '2026-11-12';

/** Fields that are the same for every media check. */
export const MEDIA = Object.freeze({
  module: /** @type {const} */ ('media'),
  engine: /** @type {const} */ ('code'),
  last_verified: VERIFIED,
});

/** Official documentation the rules are based on (CHECKS-SPEC, reference list). */
export const DOCS = Object.freeze({
  F65: 'https://www.w3.org/WAI/WCAG22/Techniques/failures/F65',
  F30: 'https://www.w3.org/WAI/WCAG22/Techniques/failures/F30',
  OPTIMIZE_CLS: 'https://web.dev/articles/optimize-cls',
  OPTIMIZE_LCP: 'https://web.dev/articles/optimize-lcp',
  HTTP_STATUS: 'https://developers.google.com/crawling/docs/troubleshooting/http-status-codes',
  LH_MODERN_FORMATS: 'https://developer.chrome.com/docs/lighthouse/performance/uses-webp-images',
  LH_TOTAL_BYTES: 'https://developer.chrome.com/docs/lighthouse/performance/total-byte-weight',
  PREVENT_IMAGES: 'https://developers.google.com/search/docs/crawling-indexing/prevent-images-on-your-page',
  H95: 'https://www.w3.org/WAI/WCAG22/Techniques/html/H95',
  VIDEO_STRUCTURED_DATA: 'https://developers.google.com/search/docs/appearance/structured-data/video',
});

/** Examples listed in evidence. */
export const MAX_EXAMPLES = 5;

/**
 * @typedef {PageRecord & {videos: VideoRecord[]}} MediaPage
 */

/**
 * True when the record carries the media fields this version writes. Records
 * made before the module existed do not, and are not units of its checks.
 * @param {PageRecord} page
 * @returns {page is MediaPage}
 */
export function hasMedia(page) {
  return Array.isArray(page.videos);
}

/**
 * The html pages (status 200, HTML) with the media fields, in crawl order.
 * @param {CheckContext} ctx
 * @returns {MediaPage[]}
 */
export function mediaPages(ctx) {
  return ctx.htmlPages.filter(hasMedia);
}

/**
 * The number an HTML dimension attribute starts with, or null.
 * @param {string|null} value
 * @returns {number|null}
 */
export function dimension(value) {
  const match = value === null ? null : /^\s*(\d+(?:\.\d+)?)/.exec(value);
  return match ? Number(match[1]) : null;
}

/**
 * A tracking pixel or a spacer: extraction found a width or height of 1 pixel or less (`pixel`).
 * @param {ImageRecord} image
 */
function isPixel(image) {
  return image.pixel === true;
}

/**
 * A *rendered image*: not hidden by its own markup and not a tracking pixel.
 * @param {ImageRecord} image
 */
export function isRendered(image) {
  return image.hidden !== true && !isPixel(image);
}

/**
 * An *exposed image*: rendered, not `aria-hidden`, and without the role `presentation` or `none`.
 * @param {ImageRecord} image
 */
export function isExposed(image) {
  return isRendered(image) && image.aria_hidden !== true && image.role !== 'presentation' && image.role !== 'none';
}

/**
 * A *spoken video*: shown, not `aria-hidden`, not muted, and not autoplaying without controls.
 * @param {VideoRecord} video
 */
export function isSpoken(video) {
  return !video.hidden && !video.aria_hidden && !video.muted && !(video.autoplay && !video.controls);
}

/**
 * How an image is named in evidence: its `src`, clipped, or a stand-in when it has none.
 * @param {ImageRecord} image
 */
export function imageName(image) {
  return image.src.trim() === '' ? '(no src)' : clip(image.src.trim());
}

/**
 * `tag[attribute="value"]` with `\` and `"` escaped, as the links module writes selectors.
 * @param {string} tag
 * @param {string} attribute
 * @param {string} value
 */
export function attributeSelector(tag, attribute, value) {
  return `${tag}[${attribute}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

/**
 * One result per page with units: `fail` when one or more units fail, with
 * the first failing unit's line and the evidence `describe` builds, `pass`
 * otherwise. Pages without units give nothing.
 * @template T
 * @param {MediaPage[]} pages
 * @param {(page: MediaPage) => T[]} unitsOf
 * @param {(unit: T, page: MediaPage) => boolean} fails
 * @param {(failing: T[], units: T[], page: MediaPage) => {line: number|null, evidence: CheckResult['evidence']}} describe
 * @param {string} selector
 * @returns {CheckResult[]}
 */
export function pageResults(pages, unitsOf, fails, describe, selector) {
  /** @type {CheckResult[]} */
  const results = [];
  for (const page of pages) {
    const units = unitsOf(page);
    if (units.length === 0) continue;
    const failing = units.filter((unit) => fails(unit, page));
    if (failing.length === 0) {
      results.push({ status: 'pass', url: page.url, selector });
      continue;
    }
    const { line, evidence } = describe(failing, units, page);
    results.push({ status: 'fail', url: page.url, selector, line, evidence });
  }
  return results;
}

/**
 * @param {number} count
 * @param {string} one
 * @param {string} many
 */
export function counted(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * @param {string} a
 * @param {string} b
 */
export function compareText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
