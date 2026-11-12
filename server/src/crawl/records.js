// The page records of one crawl and its two budgets: the page limit and the
// characters the records may hold (ARCHITECTURE.md 4.5, steps 9 and 10).

import { originOf } from '../util/url.js';

/** @import { PageRecord } from '../types.js' */

/** Most link targets `disallowedLinks` lists. */
export const MAX_DISALLOWED_LINKS = 2000;
/** Most link targets `disallowedLinks` asks robots.txt about; a large file of wildcard rules makes each question cost. */
export const MAX_DISALLOWED_ASKED = 5000;
/** @import { Robots } from '../net/robots-cache.js' */
/** @import { createFrontier } from './frontier.js' */

/**
 * The records of one crawl.
 *
 * Guarantees: a URL is recorded once, in the order `add` is given records;
 * once `maxPages` records are kept, or the next record would take the JSON of
 * all records past `maxStoredChars`, nothing more is kept; `truncated()`
 * becomes true when a record was left out whose URL could still be fetched
 * (not recorded and not known to be disallowed) or the character budget was
 * reached, and stays true. The links of a kept 200 HTML page reached through
 * links go to the frontier one level deeper, when `crawlable` accepts them.
 *
 * @param {{maxPages: number, maxStoredChars: number, frontier: ReturnType<typeof createFrontier>,
 *          crawlable: (url: string) => boolean, knownRobots: (origin: string) => Robots|undefined}} options
 */
export function createRecords({ maxPages, maxStoredChars, frontier, crawlable, knownRobots }) {
  /** @type {PageRecord[]} */
  const pages = [];
  /** @type {Map<string, PageRecord>} */
  const recorded = new Map();
  let storedChars = 0;
  /** True once the page records reached `maxStoredChars`. */
  let full = false;
  let truncated = false;

  /** True when a URL could still be fetched: not recorded and not known to be disallowed. @param {string} url */
  const fetchable = (url) => {
    if (recorded.has(url)) return false;
    const known = knownRobots(/** @type {string} */ (originOf(url)));
    return known === undefined || known.isAllowed(url);
  };

  /** @param {PageRecord[]} records */
  const add = (records) => {
    for (const record of records) {
      if (recorded.has(record.url)) continue;
      if (pages.length >= maxPages || full) {
        truncated = truncated || fetchable(record.url);
        return;
      }
      const size = JSON.stringify(record).length;
      if (storedChars + size > maxStoredChars) {
        full = true;
        truncated = true;
        return;
      }
      storedChars += size;
      pages.push(record);
      recorded.set(record.url, record);
      frontier.markSeen(record.url);
      if (record.depth === null || record.status !== 200 || !record.is_html) continue;
      for (const link of record.links) {
        if (link.url !== null && crawlable(link.url) && !recorded.has(link.url)) frontier.add(link.url, record.depth + 1);
      }
    }
  };

  return {
    /** The kept records, in order. The crawl result holds this array. */
    pages,
    add,
    fetchable,
    /** @param {string} url */
    has: (url) => recorded.has(url),
    /** @param {string} url */
    get: (url) => recorded.get(url),
    /** True when the character budget was reached. */
    full: () => full,
    /** True when the page limit was reached. */
    atLimit: () => pages.length >= maxPages,
    truncated: () => truncated,
    /** Mark the crawl as truncated when `cutShort` is true; it stays truncated. @param {boolean} cutShort */
    cutShort: (cutShort) => {
      truncated = truncated || cutShort;
    },
    /**
     * Targets of internal links marked nofollow on the kept records that the
     * robots.txt of their origin does not allow the crawler to request,
     * sorted, at most `MAX_DISALLOWED_LINKS`. Each target is asked once,
     * however many links name it, and at most `MAX_DISALLOWED_ASKED` are. A
     * target on an origin whose robots.txt was never read, or that was not
     * asked, is not known to be disallowed and is left out.
     * @returns {string[]}
     */
    disallowedLinks: () => {
      /** @type {Set<string>} */
      const asked = new Set();
      /** @type {string[]} */
      const found = [];
      for (const page of pages) {
        for (const link of page.links) {
          if (!link.internal || link.url === null || !link.rel.includes('nofollow') || asked.has(link.url)) continue;
          if (asked.size >= MAX_DISALLOWED_ASKED) return found.sort();
          asked.add(link.url);
          const known = knownRobots(/** @type {string} */ (originOf(link.url)));
          if (known !== undefined && !known.isAllowed(link.url)) found.push(link.url);
          if (found.length >= MAX_DISALLOWED_LINKS) return found.sort();
        }
      }
      return found.sort();
    },
  };
}
