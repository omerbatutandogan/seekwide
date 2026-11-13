// robots.txt files read by any crawl or audit of this process, shared for a
// short time, so that parallel audits, and the image and link checks of an
// audit right after its crawl, do not each ask a site for the same file.
//
// Only public sites are shared. A crawl of a site on this machine reads its
// robots.txt every time: that is the project being worked on, and its file may
// have changed a minute ago.

/** @import { FetchError, FetchResult } from '../types.js' */
/** @import { safeFetch } from './safe-fetch.js' */

import { loadRobots } from './robots.js';

/** How long a shared robots.txt is used before it is read again. */
export const ROBOTS_TTL_MS = 10 * 60 * 1000;
/** Origins kept per transport; the oldest is dropped first. */
const MAX_ENTRIES = 500;

/** @typedef {Awaited<ReturnType<typeof loadRobots>>} Robots  What `loadRobots` returns. */

/**
 * A robots.txt as one requester read it. `firstError` is the error of the
 * first request (it says whether the host exists); `complete` is false when a
 * request of the read was not sent (the requester's time ran out), so the
 * result says nothing about the site.
 * @typedef {{robots: Robots, firstError: FetchError|null, complete: boolean}} RobotsRead
 */

/**
 * Read `origin`'s robots.txt through `request`, one paced request per hop.
 * @param {string} origin
 * @param {(url: string, options: Parameters<typeof safeFetch>[1]) => Promise<FetchResult|null>} request
 *   One request; null when it was not sent.
 * @param {Parameters<typeof safeFetch>[1]} [fetchOptions]
 * @returns {Promise<RobotsRead>}
 */
export async function readRobots(origin, request, fetchOptions = {}) {
  /** @type {FetchError|null} */
  let firstError = null;
  let calls = 0;
  let complete = true;
  const robots = await loadRobots(origin, {
    fetchOptions,
    fetch: async (url, options) => {
      const result = await request(url, options);
      if (result === null) {
        complete = false;
        return {
          url, finalUrl: url, status: 0, headers: {}, headerLines: {}, redirectChain: [], body: null, truncated: false, bytes: 0, elapsedMs: 0,
          error: { code: 'timeout', message: 'The request was not sent: the time for these requests ran out.' },
        };
      }
      if (calls === 0) firstError = result.error;
      calls += 1;
      return result;
    },
  });
  return { robots, firstError, complete };
}

/**
 * @typedef {Object} RobotsCache
 * @property {(key: {origin: string, fetch: Function, shared: boolean, fresh?: boolean}, load: () => Promise<RobotsRead>) => Promise<RobotsRead>} get
 *   The robots.txt of `origin`: one that a requester using the same transport (`fetch`) read less than
 *   `ROBOTS_TTL_MS` ago, else the result of `load`, which is kept for others. With `shared: false` (a site on
 *   this machine) nothing is kept or reused; with `fresh: true` the file is read again and replaces the kept one.
 */

/**
 * A robots.txt cache. The plugin uses one for the whole process
 * (`SHARED_ROBOTS`); tests make their own.
 *
 * Guarantees: a read that failed (its requester was cancelled) or is not
 * `complete` is never kept, and a requester that was handed such a read by
 * another requester reads the file itself instead.
 * @param {{now?: () => number, ttlMs?: number, maxEntries?: number}} [options]
 * @returns {RobotsCache}
 */
export function createRobotsCache({ now = Date.now, ttlMs = ROBOTS_TTL_MS, maxEntries = MAX_ENTRIES } = {}) {
  /** @type {WeakMap<Function, Map<string, {at: number, read: Promise<RobotsRead>}>>} */
  const byTransport = new WeakMap();

  /** @type {RobotsCache['get']} */
  const get = ({ origin, fetch, shared, fresh = false }, load) => {
    if (!shared) return load();
    let entries = byTransport.get(fetch);
    if (!entries) {
      entries = new Map();
      byTransport.set(fetch, entries);
    }
    const kept = entries;
    const hit = kept.get(origin);
    if (!fresh && hit !== undefined && now() - hit.at < ttlMs) {
      // The read handed out failed or was cut short: the first requester to see that reads again, and the
      // others waiting for it join that new read instead of each reading the file.
      const again = () => get({ origin, fetch, shared, fresh: kept.get(origin) === undefined || kept.get(origin) === hit }, load);
      return hit.read.then((read) => (read.complete ? read : again()), again);
    }
    const entry = { at: now(), read: load() };
    kept.delete(origin);
    kept.set(origin, entry);
    if (kept.size > maxEntries) kept.delete(/** @type {string} */ (kept.keys().next().value));
    const forget = () => {
      if (kept.get(origin) === entry) kept.delete(origin);
    };
    entry.read.then((read) => {
      if (!read.complete) forget();
    }, forget);
    return entry.read;
  };
  return { get };
}

/** The robots.txt cache of this process: every crawl and audit uses it. */
export const SHARED_ROBOTS = createRobotsCache();
