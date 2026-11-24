/** @import { CheckDef, CheckResult, PageRecord } from '../../types.js' */

import { DOCS, SEO } from './common.js';

/** Fewest pages with nearly the same text under one URL pattern that are reported. */
export const TEMPLATE_MIN_PAGES = 5;
/** Share of word triples two pages must have in common to count as nearly the same. */
export const TEMPLATE_SIMILARITY = 0.8;
/** Pages below this word count are not compared, as for seo.content.duplicate_body. */
const MIN_WORDS = 50;
/** Fewest word triples of a page's own text, after the site's shared text is removed, to compare it. */
const MIN_SHINGLES = 20;
/** At most this many pages of one pattern are compared with each other, in crawl order. */
const MAX_PAGES_PER_PATTERN = 300;
/** Pages outside a pattern needed to tell the site's shared text (menus, footer) from the pattern's. */
const MIN_OUTSIDE_PAGES = 3;

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * The URL pattern of a page: its host and path with the last segment replaced by `*`
 * (`/hizmet/istanbul` → `/hizmet/*`). A page with fewer than two path segments has none.
 * @param {string} url
 * @returns {string|null}
 */
export function urlPattern(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
  if (segments.length < 2) return null;
  return `${parsed.host}/${[...segments.slice(0, -1), '*'].join('/')}`;
}

/**
 * The distinct triples of consecutive words of a text, lower-cased.
 * @param {string} text
 * @returns {Set<string>}
 */
export function shingles(text) {
  const words = text.toLowerCase().match(WORD) ?? [];
  /** @type {Set<string>} */
  const out = new Set();
  for (let i = 0; i + 2 < words.length; i++) out.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return out;
}

/**
 * Jaccard similarity of two sets.
 * @param {Set<string>} a @param {Set<string>} b
 */
export function jaccard(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let shared = 0;
  for (const item of small) if (large.has(item)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/**
 * Triples that half or more of the given pages share: the site's menus, footer and other text on every page.
 * @param {Set<string>[]} sets
 * @returns {Set<string>}
 */
function commonShingles(sets) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const set of sets) for (const item of set) counts.set(item, (counts.get(item) ?? 0) + 1);
  return new Set([...counts].filter(([, count]) => count * 2 >= sets.length).map(([item]) => item));
}

/** @type {CheckDef} */
const templateNearDuplicate = {
  ...SEO,
  id: 'seo.content.template_near_duplicate',
  title: 'Pages under one URL pattern have nearly the same text',
  description:
    `Groups the indexable pages with ${MIN_WORDS} or more words by URL pattern (the path with its last segment as a wildcard, such as /service/*) and compares the first 2000 characters of their visible text, without the text that half or more of the site's other pages share. ${TEMPLATE_MIN_PAGES} or more pages of one pattern whose texts share ${TEMPLATE_SIMILARITY * 100} % or more of their word triples, but are not identical, are reported. Google's examples of doorway pages include pages targeted at specific regions or cities that funnel users to one page, and substantially similar pages. Similar text alone does not show that, so this is information.`,
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 3,
  confidence: 'likely',
  scope: 'site',
  requires: [],
  doc_ref: DOCS.SPAM_POLICIES,
  last_verified: '2026-11-24',
  recommendation:
    'Check whether each of these pages gives visitors something the others do not, such as information only true for its place or item. If not, merge them into one page, or give each its own content.',
  run(ctx) {
    /** @type {Map<string, PageRecord[]>} */
    const groups = new Map();
    /** @type {Map<string, Set<string>>} */
    const sets = new Map();
    const units = ctx.indexablePages.filter((page) => page.word_count >= MIN_WORDS && page.text_excerpt !== '');
    for (const page of units) {
      sets.set(page.url, shingles(page.text_excerpt));
      const pattern = urlPattern(page.url);
      if (pattern === null) continue;
      const list = groups.get(pattern) ?? [];
      list.push(page);
      groups.set(pattern, list);
    }
    /** @type {CheckResult[]} */
    const results = [];
    for (const pattern of [...groups.keys()].sort()) {
      const pages = /** @type {PageRecord[]} */ (groups.get(pattern));
      if (pages.length < TEMPLATE_MIN_PAGES) continue;
      const members = new Set(pages.map((page) => page.url));
      const outside = units.filter((page) => !members.has(page.url)).map((page) => /** @type {Set<string>} */ (sets.get(page.url)));
      const shared = outside.length >= MIN_OUTSIDE_PAGES ? commonShingles(outside) : new Set();
      // One page for each distinct text: identical copies are seo.content.duplicate_body's.
      /** @type {Map<string, {url: string, own: Set<string>}>} */
      const texts = new Map();
      for (const page of pages.slice(0, MAX_PAGES_PER_PATTERN)) {
        if (texts.has(page.text_hash)) continue;
        const own = new Set([...(/** @type {Set<string>} */ (sets.get(page.url)))].filter((item) => !shared.has(item)));
        if (own.size >= MIN_SHINGLES) texts.set(page.text_hash, { url: page.url, own });
      }
      const cluster = largestCluster([...texts.values()]);
      const path = pattern.slice(pattern.indexOf('/'));
      if (cluster.urls.length < TEMPLATE_MIN_PAGES) {
        results.push({ status: 'pass', url: pages[0].url, selector: path });
        continue;
      }
      const urls = [...cluster.urls].sort();
      results.push({
        status: 'fail',
        url: urls[0],
        selector: path,
        related_urls: urls.slice(1, 6),
        evidence: {
          observed: {
            url_pattern: path,
            pages_in_pattern: pages.length,
            similar_pages: urls.length,
            lowest_similarity: Math.floor(cluster.lowest * 100) / 100,
          },
          expected: 'Pages under one URL pattern that each have content of their own',
          detail: 'Google\'s examples of doorway pages include "pages targeted at specific regions or cities that funnel users to one page" and "substantially similar pages that are closer to search results than a clearly defined, browseable hierarchy".',
        },
      });
    }
    return results;
  },
};

/**
 * The largest group of pages linked by pairs at or above the similarity threshold,
 * with the lowest similarity of the pairs that link it.
 * @param {{url: string, own: Set<string>}[]} items
 * @returns {{urls: string[], lowest: number}}
 */
function largestCluster(items) {
  const parent = items.map((_, index) => index);
  /** @param {number} index @returns {number} */
  const root = (index) => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]];
    return index;
  };
  /** @type {{a: number, b: number, value: number}[]} */
  const links = [];
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const value = jaccard(items[a].own, items[b].own);
      if (value < TEMPLATE_SIMILARITY) continue;
      links.push({ a, b, value });
      parent[root(a)] = root(b);
    }
  }
  /** @type {Map<number, number[]>} */
  const groups = new Map();
  items.forEach((_, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), index]));
  let best = /** @type {number[]} */ ([]);
  for (const group of groups.values()) if (group.length > best.length) best = group;
  if (best.length < 2) return { urls: best.map((index) => items[index].url), lowest: 1 };
  const top = root(best[0]);
  const lowest = Math.min(...links.filter((link) => root(link.a) === top).map((link) => link.value));
  return { urls: best.map((index) => items[index].url), lowest };
}

export const templateChecks = [templateNearDuplicate];
