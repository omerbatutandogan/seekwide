// Checking external (outbound) links: HEAD first, GET once on failure.

import { LIMITS } from '../config.js';
import { originOf } from '../util/url.js';
import { SHARED_HOST_GATES, createPacer, followRedirects, hostOf, rawTarget, sleep as wait } from './polite.js';
import { SHARED_ROBOTS, readRobots } from './robots-cache.js';
import { safeFetch } from './safe-fetch.js';

/** @import { FetchResult, OutboundResult } from '../types.js' */
/** @import { HostGates } from './polite.js' */
/** @import { RobotsCache, RobotsRead } from './robots-cache.js' */

/** Bytes read by the GET retry; enough to get a status, not a whole page. */
const RETRY_MAX_BYTES = 16 * 1024;
/** Redirect hops followed for one external link. */
const MAX_HOPS = 5;

/**
 * @param {string} url
 * @param {FetchResult} result
 * @returns {OutboundResult}
 */
function classify(url, result) {
  const finalUrl = result.status > 0 ? result.finalUrl : null;
  if (result.error !== null) {
    const outcome = result.error.code === 'dns_error' ? 'broken' : 'unverifiable';
    return { url, status: result.status, outcome, reason: result.error.code, final_url: finalUrl };
  }
  if (result.status < 400) return { url, status: result.status, outcome: 'ok', reason: null, final_url: finalUrl };
  const outcome = result.status === 404 || result.status === 410 ? 'broken' : 'unverifiable';
  return { url, status: result.status, outcome, reason: `status_${result.status}`, final_url: finalUrl };
}

/**
 * Check external links politely.
 *
 * Guarantees: URLs are de-duplicated in the order given, and only the first
 * `maxLinks` are checked. Before the first request to an origin its robots.txt
 * is read once (or taken from `robotsCache`, where another check of this
 * process left it); a URL it disallows, or any URL of an origin whose
 * robots.txt cannot be read, is 'unverifiable' and never requested. Requests
 * to one host are sequential and `perHostDelayMs` apart, or the host's
 * crawl-delay when that is longer (at most `LIMITS.crawlDelayMaxSec`), robots.txt
 * and the GET retry included, redirect hops to that host too; they also pass
 * the process-wide host gates (`hosts`), which space them from the requests of
 * other crawls and audits. At most `concurrency` hosts are checked at once. At
 * most 5 redirects are followed, one request per hop, and a hop is requested
 * only when its origin's robots.txt allows it. 'broken' means 404, 410 or a
 * name that does not exist (`dns_error`); anything that may be a refusal of
 * automated requests or a temporary failure is 'unverifiable'. No request
 * starts after `signal` fired: the call rejects with its reason. The map
 * iterates in the order given.
 *
 * @param {string[]} urls  external URLs
 * @param {{fetch?: typeof safeFetch, fetchOptions?: Parameters<typeof safeFetch>[1], maxLinks?: number, concurrency?: number,
 *          perHostDelayMs?: number, sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, signal?: AbortSignal,
 *          hosts?: HostGates, robotsCache?: RobotsCache}} [options]
 * @returns {Promise<Map<string, OutboundResult>>}
 */
export async function checkExternalLinks(urls, options = {}) {
  if (!Array.isArray(urls)) throw new TypeError('checkExternalLinks needs an array of URLs');
  const {
    fetch = safeFetch, fetchOptions = {}, maxLinks = LIMITS.maxOutboundChecks, concurrency = LIMITS.outboundConcurrency,
    perHostDelayMs = 1000 / LIMITS.ratePerSecDefault, sleep = wait, signal, hosts = SHARED_HOST_GATES, robotsCache = SHARED_ROBOTS,
  } = options;
  if (!Number.isInteger(maxLinks) || maxLinks < 0) throw new TypeError('checkExternalLinks maxLinks must be a non-negative integer');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('checkExternalLinks concurrency must be a positive integer');
  if (!Number.isFinite(perHostDelayMs) || perHostDelayMs < 0) throw new TypeError('checkExternalLinks perHostDelayMs must be a non-negative number');

  const selected = [...new Set(urls.filter((u) => typeof u === 'string'))].slice(0, maxLinks);
  const maxHops = Math.min(fetchOptions.maxRedirects ?? MAX_HOPS, MAX_HOPS);

  /** A host's crawl-delay in milliseconds, once its robots.txt was read. @type {Map<string, number>} */
  const crawlDelays = new Map();
  // Pacing is per host name and shared by every worker, so a redirect to another
  // host waits its turn like that host's own requests.
  const paced = createPacer({ delayMs: (host) => Math.max(perHostDelayMs, crawlDelays.get(host) ?? 0), sleep, signal, hosts });
  /** @param {string} url @param {Parameters<typeof safeFetch>[1]} opts */
  const send = async (url, opts) => /** @type {FetchResult} */ (await paced(url, () => fetch(url, opts)));
  /** @param {string} url @param {'HEAD'|'GET'} method */
  const request = (url, method) => {
    const extra = method === 'GET' ? { maxBytes: Math.min(fetchOptions.maxBytes ?? RETRY_MAX_BYTES, RETRY_MAX_BYTES) } : {};
    return send(url, { ...fetchOptions, ...extra, maxRedirects: 0, method });
  };

  /** @type {Map<string, Promise<RobotsRead>>} */
  const robotsByOrigin = new Map();
  /** robots.txt of an origin, read once. Every hop of it is a separate, paced request. @param {string} origin */
  const robotsFor = (origin) => {
    let entry = robotsByOrigin.get(origin);
    if (!entry) {
      entry = robotsCache.get({ origin, fetch, shared: !fetchOptions.allowLoopback }, () => readRobots(origin, send, fetchOptions)).then((read) => {
        const delay = read.robots.summary.crawl_delay_sec;
        if (delay !== null) crawlDelays.set(hostOf(origin), Math.min(delay, LIMITS.crawlDelayMaxSec) * 1000);
        return read;
      });
      robotsByOrigin.set(origin, entry);
    }
    return entry;
  };

  /**
   * Check one link, following its redirects by hand. Every URL in the chain is
   * requested only when its origin's robots.txt allows it.
   * @param {string} url
   * @returns {Promise<OutboundResult>}
   */
  const checkLink = async (url) => {
    /** @param {string} reason @param {number} [status] @returns {OutboundResult} */
    const unverifiable = (reason, status = 0) => ({ url, status, outcome: 'unverifiable', reason, final_url: null });
    const chain = await followRedirects(url, {
      maxHops,
      resolve: rawTarget,
      before: async (current) => {
        const origin = originOf(current);
        if (origin === null || !/^https?:/.test(origin)) return undefined;
        const { robots, firstError } = await robotsFor(origin);
        if (robots.summary.status === 'unreachable') {
          return firstError?.code === 'dns_error'
            ? /** @type {OutboundResult} */ ({ url, status: 0, outcome: 'broken', reason: 'dns_error', final_url: null })
            : unverifiable('robots.txt could not be read');
        }
        return robots.isAllowed(current) ? undefined : unverifiable('Disallowed by robots.txt');
      },
      request: async (current) => {
        const result = await request(current, 'HEAD');
        return result.error !== null || result.status >= 400 ? request(current, 'GET') : result;
      },
    });
    if (chain.kind === 'stopped') return chain.value;
    if (chain.kind === 'response') return classify(url, chain.result);
    if (chain.kind === 'unsent') throw new TypeError('checkExternalLinks: every request of a link check is sent');
    const reasons = { invalid: 'invalid_url', loop: 'redirect_loop', too_many: 'too_many_redirects' };
    return unverifiable(reasons[chain.kind], chain.result.status);
  };

  /** @type {Map<string, OutboundResult>} */
  const results = new Map();
  /** @type {Map<string, string[]>} */
  const byHost = new Map();
  for (const url of selected) byHost.set(hostOf(url), [...(byHost.get(hostOf(url)) ?? []), url]);
  // Workers take hosts in the order their first link was given; per-host pacing keeps each host sequential.
  const hostQueue = [...byHost.keys()];
  const worker = async () => {
    for (let host = hostQueue.shift(); host !== undefined; host = hostQueue.shift()) {
      for (const url of /** @type {string[]} */ (byHost.get(host))) results.set(url, await checkLink(url));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, hostQueue.length) }, worker));

  /** @type {Map<string, OutboundResult>} */
  const ordered = new Map();
  for (const url of selected) ordered.set(url, /** @type {OutboundResult} */ (results.get(url)));
  return ordered;
}
