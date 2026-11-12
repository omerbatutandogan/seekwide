// Checking image files (media module): robots.txt first, HEAD, and one ranged
// GET when the HEAD says too little. No image is ever downloaded whole.

import { LIMITS } from '../config.js';
import { clip } from '../util/strings.js';
import { originOf } from '../util/url.js';
import { loadRobots } from './robots.js';
import { safeFetch } from './safe-fetch.js';

/** @import { FetchResult, ImageFileResult } from '../types.js' */

/** What the requests say they accept: AVIF and WebP first, as browsers ask, so a server that negotiates shows its best format. */
export const IMAGE_ACCEPT = 'image/avif,image/webp,image/*;q=0.8,*/*;q=0.5';
/** Bytes the ranged GET reads at most, when the server ignores the range. */
const GET_MAX_BYTES = 1024;
const MAX_HOPS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Googlebot-Image answers to both tokens (Google's list of common crawlers); Googlebot to its own. */
const GOOGLE_AGENTS = /** @type {const} */ ([['Googlebot', ['Googlebot']], ['Googlebot-Image', ['Googlebot-Image', 'Googlebot']]]);

/** @param {number} ms */
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} url
 * @returns {string} Host used to pace requests; '' for an invalid URL.
 */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Absolute http(s) target of a redirect, without fragment or credentials; null when invalid.
 * @param {string} location
 * @param {string} base
 * @returns {string|null}
 */
function redirectTarget(location, base) {
  try {
    const target = new URL(location, base);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    target.hash = '';
    target.username = '';
    target.password = '';
    return target.href;
  } catch {
    return null;
  }
}

/**
 * The size of the whole file from one answer: the total of `Content-Range`
 * (206), else `Content-Length` of a 200. Null when neither says.
 * @param {FetchResult} result
 * @param {'HEAD'|'GET'} method
 * @returns {number|null}
 */
export function fileSize(result, method) {
  const range = result.headers['content-range'];
  if (result.status === 206 && range !== undefined) {
    const total = /\/\s*(\d{1,15})\s*$/.exec(range);
    return total ? Number(total[1]) : null;
  }
  const length = result.headers['content-length'];
  if (result.status !== 200 || length === undefined || !/^\s*\d{1,15}\s*$/.test(length)) return null;
  const bytes = Number(length);
  // A HEAD that says 0 bytes says nothing; a GET of an empty file does.
  return method === 'HEAD' && bytes === 0 ? null : bytes;
}

/**
 * @param {FetchResult} result
 * @returns {string|null}
 */
function mediaType(result) {
  const type = result.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() ?? '';
  return type === '' ? null : clip(type, 100);
}

/**
 * Check image files politely, in the order given.
 *
 * Guarantees: URLs are de-duplicated in order and only the first `maxImages`
 * are checked. Before the first request to an origin its robots.txt is read
 * once; a URL it disallows for the crawler is 'disallowed' and never
 * requested, and every URL of an origin whose robots.txt cannot be read is
 * 'unverifiable'. Each URL gets a HEAD, then at most one GET with
 * `Range: bytes=0-0` that reads at most 1 KiB, when the HEAD fails, answers
 * 400 or above, or answers 2xx without a usable size. Every request says it
 * accepts AVIF and WebP (`IMAGE_ACCEPT`). At most 5 redirects are followed,
 * one request per hop, each only when its origin's robots.txt allows it.
 * With `onlyOrigin`, nothing on another origin is requested, robots.txt
 * included: such a URL or step is 'unverifiable'. Requests to one host are
 * sequential and `perHostDelayMs` apart, or the host's crawl-delay when that
 * is longer (at most `LIMITS.crawlDelayMaxSec`); at most `concurrency` hosts
 * are checked at once. No request starts once `deadlineMs` has passed by
 * `now`; what was not reached is 'not_checked'. `google` says whether
 * robots.txt lets Googlebot and Googlebot-Image fetch the URL and every
 * redirect step that was followed. The map iterates in the order of `urls`.
 *
 * @param {string[]} urls
 * @param {{fetch?: typeof safeFetch, fetchOptions?: Parameters<typeof safeFetch>[1], maxImages?: number, concurrency?: number,
 *          perHostDelayMs?: number, sleep?: (ms: number) => Promise<void>, now?: () => number, deadlineMs?: number,
 *          onlyOrigin?: string|null}} [options]
 * @returns {Promise<Map<string, ImageFileResult>>}
 */
export async function checkImageFiles(urls, options = {}) {
  if (!Array.isArray(urls)) throw new TypeError('checkImageFiles needs an array of URLs');
  const {
    fetch = safeFetch, fetchOptions = {}, maxImages = LIMITS.maxImageChecks, concurrency = LIMITS.imageCheckConcurrency,
    perHostDelayMs = 1000 / LIMITS.ratePerSecDefault, sleep = realSleep, now = Date.now, deadlineMs = LIMITS.imageCheckDeadlineMs,
    onlyOrigin = null,
  } = options;
  if (!Number.isInteger(maxImages) || maxImages < 0) throw new TypeError('checkImageFiles maxImages must be a non-negative integer');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('checkImageFiles concurrency must be a positive integer');
  if (!Number.isFinite(perHostDelayMs) || perHostDelayMs < 0) throw new TypeError('checkImageFiles perHostDelayMs must be a non-negative number');
  if (!Number.isFinite(deadlineMs) || deadlineMs < 0) throw new TypeError('checkImageFiles deadlineMs must be a non-negative number');

  const selected = [...new Set(urls.filter((u) => typeof u === 'string'))].slice(0, maxImages);
  const startedAt = now();
  const expired = () => now() - startedAt >= deadlineMs;
  const local = onlyOrigin === null ? null : originOf(onlyOrigin);
  /** @param {string} url */
  const reachable = (url) => local === null || originOf(url) === local;

  /** Per-host pacing shared by every worker. @type {Map<string, {tail: Promise<unknown>, used: boolean, delayMs: number}>} */
  const pacers = new Map();
  /** @param {string} host */
  const pacerOf = (host) => {
    let pacer = pacers.get(host);
    if (!pacer) {
      pacer = { tail: Promise.resolve(), used: false, delayMs: perHostDelayMs };
      pacers.set(host, pacer);
    }
    return pacer;
  };
  /**
   * One paced request, or null when the time for image checks ran out before it could start.
   * @param {string} url @param {Parameters<typeof safeFetch>[1]} opts @returns {Promise<FetchResult|null>}
   */
  const paced = (url, opts) => {
    const pacer = pacerOf(hostOf(url));
    const run = pacer.tail.then(async () => {
      if (pacer.used && pacer.delayMs > 0) await sleep(pacer.delayMs);
      if (expired()) return null;
      pacer.used = true;
      return fetch(url, { ...fetchOptions, ...opts, maxRedirects: 0 });
    });
    pacer.tail = run.catch(() => undefined);
    return run;
  };

  /** @type {Map<string, Promise<{robots: Awaited<ReturnType<typeof loadRobots>>, firstError: FetchResult['error'], late: boolean}>>} */
  const robotsByOrigin = new Map();
  /** robots.txt of an origin, read once. @param {string} origin */
  const robotsFor = (origin) => {
    let entry = robotsByOrigin.get(origin);
    if (!entry) {
      entry = (async () => {
        let calls = 0;
        let late = false;
        /** @type {FetchResult['error']} */
        let firstError = null;
        /** @type {typeof safeFetch} */
        const robotsFetch = async (url, opts) => {
          // A robots.txt of the local site that redirects away is not followed there.
          if (!reachable(url)) {
            return { url, finalUrl: url, status: 0, headers: {}, headerLines: {}, redirectChain: [], body: null, truncated: false, bytes: 0, elapsedMs: 0,
              error: { code: 'blocked_address', message: 'Not on the address of the local site.' } };
          }
          const result = await paced(url, opts);
          if (result === null) {
            late = true;
            return { url, finalUrl: url, status: 0, headers: {}, headerLines: {}, redirectChain: [], body: null, truncated: false, bytes: 0, elapsedMs: 0,
              error: { code: 'timeout', message: 'The time for image checks ran out.' } };
          }
          if (calls === 0) firstError = result.error;
          calls += 1;
          return result;
        };
        const robots = await loadRobots(origin, { fetch: robotsFetch, fetchOptions });
        const delay = robots.summary.crawl_delay_sec;
        if (delay !== null) {
          const pacer = pacerOf(hostOf(origin));
          pacer.delayMs = Math.max(pacer.delayMs, Math.min(delay, LIMITS.crawlDelayMaxSec) * 1000);
        }
        return { robots, firstError, late };
      })();
      robotsByOrigin.set(origin, entry);
    }
    return entry;
  };

  /**
   * Check one image, following its redirects by hand.
   * @param {string} url
   * @returns {Promise<ImageFileResult>}
   */
  const checkImage = async (url) => {
    /** @type {ImageFileResult} */
    const out = {
      url, outcome: 'unverifiable', status: 0, reason: null, final_url: null, content_type: null, bytes: null, vary: null,
      modern_accepted: true, google: 'allowed', google_agent: null, google_host: null,
    };
    /**
     * @param {ImageFileResult['outcome']} outcome @param {string} reason
     * @param {boolean} [known]  False when a step's robots.txt was not read, so what Google may fetch is not known
     *   (a robots.txt that disallowed an earlier step still says enough).
     */
    const stop = (outcome, reason, known = true) => {
      out.outcome = outcome;
      out.reason = reason;
      if (!known && out.google === 'allowed') out.google = null;
      return out;
    };
    let current = url;
    const seen = new Set([url]);
    for (let hops = 0; ; hops += 1) {
      if (!reachable(current)) return stop('unverifiable', 'Not on the address of the local site, so not requested', false);
      if (expired()) return stop('not_checked', 'The time for image checks ran out', false);
      const origin = /** @type {string} */ (originOf(current));
      const { robots, firstError, late } = await robotsFor(origin);
      if (late) return stop('not_checked', 'The time for image checks ran out', false);
      if (robots.summary.status === 'unreachable') {
        return firstError?.code === 'dns_error' ? stop('broken', 'dns_error', false) : stop('unverifiable', 'robots.txt could not be read', false);
      }
      if (out.google === 'allowed') {
        for (const [name, tokens] of GOOGLE_AGENTS) {
          if (!robots.allowsAgents(current, [...tokens])) {
            out.google = 'disallowed';
            out.google_agent = name;
            out.google_host = hostOf(current);
            break;
          }
        }
      }
      if (!robots.isAllowed(current)) return stop('disallowed', 'Disallowed by robots.txt');

      const headers = { accept: IMAGE_ACCEPT };
      let method = /** @type {'HEAD'|'GET'} */ ('HEAD');
      let result = await paced(current, { method, headers });
      if (result === null) return stop('not_checked', 'The time for image checks ran out', false);
      const redirect = result.error === null && REDIRECT_STATUSES.has(result.status);
      if (!redirect && (result.error !== null || result.status >= 400 || fileSize(result, method) === null)) {
        method = 'GET';
        const retry = await paced(current, { method, headers: { ...headers, range: 'bytes=0-0' }, maxBytes: GET_MAX_BYTES });
        if (retry === null) return stop('not_checked', 'The time for image checks ran out', false);
        // A HEAD that answered well keeps its answer when the GET does worse.
        if (result.error !== null || result.status >= 400 || (retry.error === null && retry.status < 400)) result = retry;
        else method = 'HEAD';
      }
      if (result.error !== null) return stop(result.error.code === 'dns_error' ? 'broken' : 'unverifiable', result.error.code);
      if (REDIRECT_STATUSES.has(result.status)) {
        const target = result.headers.location === undefined ? null : redirectTarget(result.headers.location, current);
        out.status = result.status;
        if (target === null) return stop('unverifiable', 'invalid_url', false);
        if (seen.has(target)) return stop('unverifiable', 'redirect_loop', false);
        if (hops + 1 > MAX_HOPS) return stop('unverifiable', 'too_many_redirects', false);
        seen.add(target);
        current = target;
        continue;
      }
      out.status = result.status;
      out.final_url = current === url ? null : current;
      if (result.status >= 400) {
        return stop(result.status === 404 || result.status === 410 ? 'broken' : 'unverifiable', `status_${result.status}`);
      }
      out.outcome = 'ok';
      out.content_type = mediaType(result);
      out.bytes = fileSize(result, method);
      out.vary = result.headers.vary === undefined ? null : clip(result.headers.vary, 200);
      return out;
    }
  };

  /** @type {Map<string, ImageFileResult>} */
  const results = new Map();
  /** @type {Map<string, string[]>} */
  const byHost = new Map();
  for (const url of selected) byHost.set(hostOf(url), [...(byHost.get(hostOf(url)) ?? []), url]);
  const hostQueue = [...byHost.keys()];
  const worker = async () => {
    for (let host = hostQueue.shift(); host !== undefined; host = hostQueue.shift()) {
      for (const url of /** @type {string[]} */ (byHost.get(host))) results.set(url, await checkImage(url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hostQueue.length) }, worker));

  /** @type {Map<string, ImageFileResult>} */
  const ordered = new Map();
  for (const url of selected) ordered.set(url, /** @type {ImageFileResult} */ (results.get(url)));
  return ordered;
}
