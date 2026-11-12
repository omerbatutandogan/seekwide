// Every request of a crawl: the wait between requests, the one retry of a 429,
// robots.txt per origin, and the rule that a crawl of this machine requests
// nothing from another address (ARCHITECTURE.md 4.5, steps 6 and 11).

import { LIMITS } from '../config.js';
import { loadRobots } from '../net/robots.js';
import { originOf } from '../util/url.js';
import { isBotChallenge, RETRY_AFTER_MAX_MS, retryAfterMs } from './challenge.js';

/** @import { FetchResult } from '../types.js' */
/** @import { safeFetch } from '../net/safe-fetch.js' */

/** @typedef {Awaited<ReturnType<typeof loadRobots>>} Robots */

/**
 * The request functions of one crawl.
 *
 * Guarantees: requests go out one at a time through `politeFetch`, the first
 * at once and every later one after the current delay, which is
 * `max(1000 / ratePerSec, crawl-delay)` once a robots.txt with a crawl-delay
 * was read (capped at `LIMITS.crawlDelayMaxSec`); with `loopbackOrigin`, a URL
 * on any other origin is refused with `blocked_address` before anything is
 * sent; robots.txt is read once per origin.
 *
 * @param {{fetch: typeof safeFetch, now: () => Date, sleep: (ms: number) => Promise<void>, ratePerSec: number, loopbackOrigin: string|null}} options
 */
export function createRequests({ fetch, now, sleep, ratePerSec, loopbackOrigin }) {
  const baseDelayMs = 1000 / ratePerSec;
  let delayMs = baseDelayMs;
  let requests = 0;
  /** @type {Map<string, FetchResult['error']>} */
  const lastErrors = new Map();

  /**
   * Every request of the crawl goes through here.
   * @param {string} url
   * @param {Parameters<typeof safeFetch>[1]} [options]
   * @param {number} [waitMs] Wait before this request instead of the normal delay.
   */
  const politeFetch = async (url, options = {}, waitMs = delayMs) => {
    // A crawl of a local site requests that site and nothing else: a robots.txt, a sitemap or a probe that
    // leads to another origin is refused here, as the redirect follower refuses it for pages.
    if (loopbackOrigin !== null && originOf(url) !== loopbackOrigin) {
      /** @type {FetchResult} */
      const refused = {
        url, finalUrl: url, status: 0, headers: {}, headerLines: {}, redirectChain: [], body: null, truncated: false, bytes: 0, elapsedMs: 0,
        error: { code: 'blocked_address', message: 'A crawl of a site on this machine requests nothing from another address.' },
      };
      lastErrors.set(url, refused.error);
      return refused;
    }
    if (requests > 0) await sleep(waitMs);
    requests += 1;
    const result = await fetch(url, { ...options, allowLoopback: loopbackOrigin ?? false });
    lastErrors.set(url, result.error);
    return result;
  };

  /**
   * One page request without automatic redirects; a plain 429 is retried once after Retry-After.
   * @param {string} url @param {'GET'|'HEAD'} [method] @param {number} [maxBytes]
   */
  const fetchPage = async (url, method = 'GET', maxBytes = undefined) => {
    const options = { maxRedirects: 0, method, ...(maxBytes === undefined ? {} : { maxBytes }) };
    const result = await politeFetch(url, options);
    if (result.status !== 429 || isBotChallenge(result)) return result;
    const wait = Math.min(RETRY_AFTER_MAX_MS, Math.max(delayMs, retryAfterMs(result.headers['retry-after'], now())));
    return politeFetch(url, options, wait);
  };

  /** @type {Map<string, Robots>} */
  const robotsByOrigin = new Map();
  /** @param {string} origin @returns {Promise<Robots>} */
  const robotsFor = async (origin) => {
    let robots = robotsByOrigin.get(origin);
    if (!robots) {
      robots = await loadRobots(origin, { fetch: politeFetch });
      robotsByOrigin.set(origin, robots);
      const crawlDelaySec = Math.min(robots.summary.crawl_delay_sec ?? 0, LIMITS.crawlDelayMaxSec);
      delayMs = Math.max(delayMs, baseDelayMs, crawlDelaySec * 1000);
    }
    return robots;
  };

  return {
    politeFetch,
    fetchPage,
    robotsFor,
    /** robots.txt of an origin when it was read already, else undefined. @param {string} origin */
    knownRobots: (origin) => robotsByOrigin.get(origin),
    /** The error of the last request to a URL; null after a response, undefined when it was never requested. @param {string} url */
    lastError: (url) => lastErrors.get(url),
  };
}
