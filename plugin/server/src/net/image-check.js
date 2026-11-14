// Checking image files (media module): robots.txt first, HEAD, and one ranged
// GET when the HEAD says too little. No image is ever downloaded whole.

import { LIMITS } from '../config.js';
import { imageSize } from '../util/image-size.js';
import { NOT_REQUESTED, offLimitsReason } from '../util/off-limits.js';
import { clip } from '../util/strings.js';
import { originOf } from '../util/url.js';
import { REDIRECT_STATUSES, SHARED_HOST_GATES, createPacer, followRedirects, guardFetch, hostOf, rawTarget, sleep as wait } from './polite.js';
import { SHARED_ROBOTS, readRobots } from './robots-cache.js';
import { safeFetch } from './safe-fetch.js';

/** @import { FetchResult, ImageFileResult } from '../types.js' */
/** @import { HostGates } from './polite.js' */
/** @import { RobotsCache, RobotsRead } from './robots-cache.js' */

/** What the requests say they accept: AVIF and WebP first, as browsers ask, so a server that negotiates shows its best format. */
export const IMAGE_ACCEPT = 'image/avif,image/webp,image/*;q=0.8,*/*;q=0.5';
/** Bytes the ranged GET reads at most, when the server ignores the range. */
const GET_MAX_BYTES = 1024;
const MAX_HOPS = 5;
/** Googlebot-Image answers to both tokens (Google's list of common crawlers); Googlebot to its own. */
const GOOGLE_AGENTS = /** @type {const} */ ([['Googlebot', ['Googlebot']], ['Googlebot-Image', ['Googlebot-Image', 'Googlebot']]]);

/**
 * A request that was not sent because it is not on the address of the local site.
 * @param {string} url
 * @returns {FetchResult}
 */
const notLocal = (url) => ({
  url, finalUrl: url, status: 0, headers: {}, headerLines: {}, redirectChain: [], body: null, truncated: false, bytes: 0, elapsedMs: 0,
  error: { code: 'blocked_address', message: 'Not on the address of the local site.' },
});

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
 * is longer (at most `LIMITS.crawlDelayMaxSec`), and pass the process-wide
 * host gates (`hosts`), which space them from the requests of other crawls
 * and audits; a robots.txt another check of this process read less than ten
 * minutes ago is used again (`robotsCache`), except for a site on this
 * machine. At most `concurrency` hosts are checked at once. No request starts
 * once `deadlineMs` has passed by `now`; what was not reached is
 * 'not_checked'. No request starts after `signal` fired: the call rejects with
 * its reason. `google` says whether robots.txt lets Googlebot and
 * Googlebot-Image fetch the URL and every redirect step that was followed.
 * Nothing is ever sent to Google Play or a social platform (`offLimitsReason`),
 * robots.txt included: such a URL, or a redirect step to such a host, is
 * 'unverifiable'. With `readBytes` (the smo module's sharing images), each
 * step gets one GET with `Range: bytes=0-<readBytes - 1>` that reads at most
 * `readBytes`, instead of the HEAD and the 1 KiB GET, and an answer below 400
 * gets `size`: the format and pixel size its first bytes declare
 * (`imageSize`), or null. The map iterates in the order of `urls`.
 *
 * @param {string[]} urls
 * @param {{fetch?: typeof safeFetch, fetchOptions?: Parameters<typeof safeFetch>[1], maxImages?: number, concurrency?: number,
 *          perHostDelayMs?: number, sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, now?: () => number, deadlineMs?: number,
 *          onlyOrigin?: string|null, signal?: AbortSignal, hosts?: HostGates, robotsCache?: RobotsCache, readBytes?: number}} [options]
 * @returns {Promise<Map<string, ImageFileResult>>}
 */
export async function checkImageFiles(urls, options = {}) {
  if (!Array.isArray(urls)) throw new TypeError('checkImageFiles needs an array of URLs');
  const {
    fetch: given = safeFetch, fetchOptions = {}, maxImages = LIMITS.maxImageChecks, concurrency = LIMITS.imageCheckConcurrency,
    perHostDelayMs = 1000 / LIMITS.ratePerSecDefault, sleep = wait, now = Date.now, deadlineMs = LIMITS.imageCheckDeadlineMs,
    onlyOrigin = null, signal, hosts = SHARED_HOST_GATES, robotsCache = SHARED_ROBOTS, readBytes = 0,
  } = options;
  // Every request of the check, robots.txt and its redirects included, goes through the off-limits guard.
  const fetch = guardFetch(given);
  if (!Number.isInteger(maxImages) || maxImages < 0) throw new TypeError('checkImageFiles maxImages must be a non-negative integer');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('checkImageFiles concurrency must be a positive integer');
  if (!Number.isFinite(perHostDelayMs) || perHostDelayMs < 0) throw new TypeError('checkImageFiles perHostDelayMs must be a non-negative number');
  if (!Number.isFinite(deadlineMs) || deadlineMs < 0) throw new TypeError('checkImageFiles deadlineMs must be a non-negative number');
  if (!Number.isInteger(readBytes) || readBytes < 0) throw new TypeError('checkImageFiles readBytes must be a non-negative integer');

  const selected = [...new Set(urls.filter((u) => typeof u === 'string'))].slice(0, maxImages);
  const startedAt = now();
  const expired = () => now() - startedAt >= deadlineMs;
  const local = onlyOrigin === null ? null : originOf(onlyOrigin);
  /** @param {string} url */
  const reachable = (url) => local === null || originOf(url) === local;

  /** A host's crawl-delay in milliseconds, once its robots.txt was read. @type {Map<string, number>} */
  const crawlDelays = new Map();
  const paced = createPacer({ delayMs: (host) => Math.max(perHostDelayMs, crawlDelays.get(host) ?? 0), sleep, signal, hosts });
  /**
   * One paced request, or null when the time for image checks ran out before it could start.
   * @param {string} url @param {Parameters<typeof safeFetch>[1]} opts @returns {Promise<FetchResult|null>}
   */
  const request = (url, opts) => paced(url, async () => (expired() ? null : fetch(url, { ...fetchOptions, ...opts, maxRedirects: 0 })));

  /** @type {Map<string, Promise<RobotsRead>>} */
  const robotsByOrigin = new Map();
  /** robots.txt of an origin, read once. @param {string} origin */
  const robotsFor = (origin) => {
    let entry = robotsByOrigin.get(origin);
    if (!entry) {
      // A robots.txt of the local site that redirects away is not followed there.
      /** @type {(url: string, opts: Parameters<typeof safeFetch>[1]) => Promise<FetchResult|null>} */
      const robotsRequest = (url, opts) => (reachable(url) ? request(url, opts) : Promise.resolve(notLocal(url)));
      entry = robotsCache.get({ origin, fetch, shared: local === null && !fetchOptions.allowLoopback }, () => readRobots(origin, robotsRequest, fetchOptions)).then((read) => {
        const delay = read.robots.summary.crawl_delay_sec;
        if (delay !== null) crawlDelays.set(hostOf(origin), Math.max(crawlDelays.get(hostOf(origin)) ?? 0, Math.min(delay, LIMITS.crawlDelayMaxSec) * 1000));
        return read;
      });
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
    let method = /** @type {'HEAD'|'GET'} */ ('HEAD');
    const chain = await followRedirects(url, {
      maxHops: MAX_HOPS,
      resolve: rawTarget,
      before: async (current) => {
        if (!reachable(current)) return stop('unverifiable', 'Not on the address of the local site, so not requested', false);
        // Google Play and social platforms are never contacted, robots.txt included (rule set 0.1.9).
        const rule = offLimitsReason(current);
        if (rule !== null) return stop('unverifiable', NOT_REQUESTED[rule], false);
        if (expired()) return stop('not_checked', 'The time for image checks ran out', false);
        const { robots, firstError, complete } = await robotsFor(/** @type {string} */ (originOf(current)));
        if (!complete) return stop('not_checked', 'The time for image checks ran out', false);
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
        return robots.isAllowed(current) ? undefined : stop('disallowed', 'Disallowed by robots.txt');
      },
      request: async (current) => {
        const headers = { accept: IMAGE_ACCEPT };
        if (readBytes > 0) {
          // The first bytes, for the pixel size: one ranged GET per step, never more than `readBytes` read.
          method = 'GET';
          return request(current, { method, headers: { ...headers, range: `bytes=0-${readBytes - 1}` }, maxBytes: readBytes });
        }
        method = 'HEAD';
        const head = await request(current, { method, headers });
        if (head === null) return null;
        const redirect = head.error === null && REDIRECT_STATUSES.has(head.status);
        if (redirect || (head.error === null && head.status < 400 && fileSize(head, method) !== null)) return head;
        method = 'GET';
        const retry = await request(current, { method, headers: { ...headers, range: 'bytes=0-0' }, maxBytes: GET_MAX_BYTES });
        if (retry === null) return null;
        // A HEAD that answered well keeps its answer when the GET does worse.
        if (head.error !== null || head.status >= 400 || (retry.error === null && retry.status < 400)) return retry;
        method = 'HEAD';
        return head;
      },
    });
    if (chain.kind === 'stopped') return chain.value;
    if (chain.kind === 'unsent') return stop('not_checked', 'The time for image checks ran out', false);
    if (chain.kind !== 'response') {
      out.status = chain.result.status;
      const reasons = { invalid: 'invalid_url', loop: 'redirect_loop', too_many: 'too_many_redirects' };
      return stop('unverifiable', reasons[chain.kind], false);
    }
    const { result } = chain;
    if (result.error !== null) return stop(result.error.code === 'dns_error' ? 'broken' : 'unverifiable', result.error.code);
    out.status = result.status;
    out.final_url = chain.url === url ? null : chain.url;
    if (result.status >= 400) {
      return stop(result.status === 404 || result.status === 410 ? 'broken' : 'unverifiable', `status_${result.status}`);
    }
    out.outcome = 'ok';
    out.content_type = mediaType(result);
    out.bytes = fileSize(result, method);
    out.vary = result.headers.vary === undefined ? null : clip(result.headers.vary, 200);
    if (readBytes > 0) out.size = result.body === null ? null : imageSize(result.body);
    return out;
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
