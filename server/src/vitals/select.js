// Which pages get their Core Web Vitals measured. A test takes many seconds
// and Google limits how many can be run, so the few pages that say the most
// are picked: the start page, then one page from each of the largest groups
// of similar pages. Pure: the same crawl always gives the same list.

import { LIMITS } from '../config.js';
import { clip } from '../util/strings.js';
import { templateSignature } from '../util/url.js';

/** @import { CrawlResult, PageRecord } from '../types.js' */

/**
 * The record at the end of a URL's redirect chain, when it was crawled.
 * @param {Map<string, PageRecord>} byUrl
 * @param {string} url
 * @returns {PageRecord|undefined}
 */
function finalRecord(byUrl, url) {
  let record = byUrl.get(url);
  for (let hop = 0; hop <= LIMITS.maxRedirects; hop += 1) {
    if (!record || record.final_url === record.url) break;
    record = byUrl.get(record.final_url);
  }
  return record;
}

/**
 * @param {string} url
 * @returns {string[]} Path segments, without empty ones.
 */
function segments(url) {
  try {
    return new URL(url).pathname.split('/').filter((segment) => segment !== '');
  } catch {
    return [];
  }
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
const compareText = (a, b) => (a === b ? 0 : a < b ? -1 : 1);

/**
 * @param {PageRecord} a
 * @param {PageRecord} b
 * @returns {number} Closest to the start page first; pages found only in the sitemap (no depth) last.
 */
function compareDepth(a, b) {
  if (a.depth === b.depth) return 0;
  if (a.depth === null) return 1;
  if (b.depth === null) return -1;
  return a.depth - b.depth;
}

/**
 * Why a page stands for its group, in a few words.
 * @param {string} url
 * @param {number} size  Pages in the group.
 * @returns {string}
 */
function describeGroup(url, size) {
  const parts = segments(url);
  if (parts.length < 2) return 'Top-level page';
  const section = `/${clip(parts[0], 60)}/`;
  return size === 1 ? `The only page under ${section}` : `One of ${size} pages under ${section}`;
}

/**
 * Pick the pages to measure, most telling first.
 *
 * Only indexable HTML pages are candidates: those are the pages search engines
 * show, and the only ones the Chrome UX Report has data for. The start page
 * comes first. The rest are grouped by `templateSignature`, and one page is
 * taken per group: largest group first, then the group closest to the start
 * page, then by signature. Inside a group the page closest to the start page
 * wins, then the first by URL. When the limit is larger than the number of
 * groups, the groups are gone through again for their next page.
 *
 * @param {CrawlResult} crawl
 * @param {number} [limit]  How many pages to return at most.
 * @returns {{url: string, why: string}[]}
 */
export function selectVitalsPages(crawl, limit = LIMITS.vitalsPagesDefault) {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('selectVitalsPages limit must be a positive integer');

  /** @type {Map<string, PageRecord>} */
  const byUrl = new Map();
  for (const page of crawl.pages) {
    if (!byUrl.has(page.url)) byUrl.set(page.url, page);
  }
  // A query string can carry a token or a personal value, so a page whose address has one is never sent to Google.
  const candidates = [...byUrl.values()].filter((page) => page.status === 200 && page.is_html && page.indexability.indexable && !hasQuery(page.url));

  /** @type {{url: string, why: string}[]} */
  const selected = [];
  const start = finalRecord(byUrl, crawl.start_url);
  if (start && candidates.includes(start)) selected.push({ url: start.url, why: 'Start page' });

  /** @type {Map<string, PageRecord[]>} */
  const groups = new Map();
  for (const page of candidates) {
    if (page === start) continue;
    const signature = templateSignature(page.url);
    const group = groups.get(signature);
    if (group) group.push(page);
    else groups.set(signature, [page]);
  }
  const ordered = [...groups.entries()]
    .map(([signature, pages]) => ({ signature, pages: pages.sort((a, b) => compareDepth(a, b) || compareText(a.url, b.url)) }))
    .sort((a, b) => b.pages.length - a.pages.length || compareDepth(a.pages[0], b.pages[0]) || compareText(a.signature, b.signature));

  const largest = ordered.length === 0 ? 0 : ordered[0].pages.length;
  for (let round = 0; round < largest && selected.length < limit; round += 1) {
    for (const { pages } of ordered) {
      if (selected.length >= limit) break;
      if (round < pages.length) selected.push({ url: pages[round].url, why: describeGroup(pages[round].url, pages.length) });
    }
  }
  return selected.slice(0, limit);
}

/**
 * @param {string} url
 * @returns {boolean}
 */
function hasQuery(url) {
  try {
    return new URL(url).search !== '';
  } catch {
    return true;
  }
}
