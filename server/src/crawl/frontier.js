// The crawl frontier: breadth-first by click depth, sampling across page
// templates within a depth, then sitemap-only URLs. Fully deterministic.

import { templateSignature } from '../util/url.js';

/**
 * Order URLs round-robin across template groups: groups sorted by signature,
 * URLs sorted inside a group, then the first of every group, the second of
 * every group, and so on.
 * @param {Iterable<string>} urls
 * @returns {string[]}
 */
export function roundRobinByTemplate(urls) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const url of urls) {
    const signature = templateSignature(url);
    const group = groups.get(signature) ?? [];
    group.push(url);
    groups.set(signature, group);
  }
  const ordered = [...groups.keys()].sort().map((key) => /** @type {string[]} */ (groups.get(key)).sort());
  /** @type {string[]} */
  const out = [];
  for (let i = 0; ordered.some((group) => i < group.length); i += 1) {
    for (const group of ordered) if (i < group.length) out.push(group[i]);
  }
  return out;
}

/**
 * @typedef {Object} FrontierEntry
 * @property {string} url
 * @property {number|null} depth  null for URLs that only a sitemap listed.
 */

/**
 * Create an empty frontier.
 *
 * Guarantees: every URL is handed out at most once; all URLs of a smaller
 * depth come before those of a larger depth; within one batch of a depth the
 * order is `roundRobinByTemplate`; sitemap URLs come last and only if no page
 * linked to them. The order depends only on the URLs added, never on timing.
 */
export function createFrontier() {
  /** @type {Set<string>} URLs queued or handed out (or marked seen). */
  const seen = new Set();
  /** @type {Map<number, string[]>} */
  const pending = new Map();
  /** @type {FrontierEntry[]} */
  let batch = [];
  /** @type {string[]} */
  const sitemapPending = [];
  const sitemapSeen = new Set();
  let sitemapPhase = false;

  return {
    /**
     * Queue a linked URL at `depth`. Ignored when the URL was seen before.
     * @param {string} url
     * @param {number} depth
     * @returns {boolean} True when the URL was queued.
     */
    add(url, depth) {
      if (seen.has(url)) return false;
      seen.add(url);
      const list = pending.get(depth) ?? [];
      list.push(url);
      pending.set(depth, list);
      return true;
    },

    /**
     * Remember a sitemap URL, to be crawled after every linked URL if nothing links to it.
     * @param {string} url
     */
    addSitemap(url) {
      if (sitemapSeen.has(url)) return;
      sitemapSeen.add(url);
      sitemapPending.push(url);
    },

    /**
     * Mark a URL as known so it is never queued (for example, a redirect target that is already recorded).
     * @param {string} url
     */
    markSeen(url) {
      seen.add(url);
    },

    /** @param {string} url */
    has(url) {
      return seen.has(url);
    },

    /** @returns {FrontierEntry|null} The next URL to fetch, or null when the frontier is empty. */
    next() {
      if (batch.length === 0 && pending.size > 0) {
        const depth = Math.min(...pending.keys());
        const urls = /** @type {string[]} */ (pending.get(depth));
        pending.delete(depth);
        batch = roundRobinByTemplate(urls).map((url) => ({ url, depth }));
      }
      if (batch.length === 0 && !sitemapPhase) {
        sitemapPhase = true;
        const remaining = sitemapPending.filter((url) => !seen.has(url));
        for (const url of remaining) seen.add(url);
        batch = roundRobinByTemplate(remaining).map((url) => ({ url, depth: null }));
      }
      return batch.shift() ?? null;
    },

    /** @returns {number} URLs still waiting, including sitemap URLs nothing has linked to yet. */
    size() {
      let count = batch.length;
      for (const list of pending.values()) count += list.length;
      if (!sitemapPhase) count += sitemapPending.filter((url) => !seen.has(url)).length;
      return count;
    },
  };
}

/** @typedef {ReturnType<typeof createFrontier>} Frontier */
