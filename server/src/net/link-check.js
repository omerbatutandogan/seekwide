// Checking external (outbound) links: HEAD first, GET once on failure.

import { LIMITS } from '../config.js';
import { originOf } from '../util/url.js';
import { loadRobots } from './robots.js';
import { safeFetch } from './safe-fetch.js';

/** @import { FetchResult, OutboundResult } from '../types.js' */

/** Bytes read by the GET retry; enough to get a status, not a whole page. */
const RETRY_MAX_BYTES = 16 * 1024;
/** Redirect hops followed for one external link. */
const MAX_HOPS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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

/** @param {number} ms */
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
 * @param {string} url
 * @returns {string} Host used to serialize requests; '' for an invalid URL.
 */
function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Check external links politely.
 *
 * Guarantees: URLs are de-duplicated and sorted, and only the first `maxLinks`
 * are checked. Before the first request to an origin its robots.txt is read
 * once; a URL it disallows, or any URL of an origin whose robots.txt cannot be
 * read, is 'unverifiable' and never requested. Requests to one host are
 * sequential and `perHostDelayMs` apart (robots.txt and the GET retry
 * included, redirect hops to that host too); at most `concurrency` hosts are
 * checked at once. At most 5 redirects are followed, one request per hop, and a
 * hop is requested only when its origin's robots.txt allows it. 'broken' means 404, 410 or a name that does not
 * exist (`dns_error`); anything that may be a refusal of automated requests or a
 * temporary failure is 'unverifiable'. The map iterates in sorted URL order.
 *
 * @param {string[]} urls  external URLs
 * @param {{fetch?: typeof safeFetch, fetchOptions?: Parameters<typeof safeFetch>[1], maxLinks?: number, concurrency?: number,
 *          perHostDelayMs?: number, sleep?: (ms: number) => Promise<void>}} [options]
 * @returns {Promise<Map<string, OutboundResult>>}
 */
export async function checkExternalLinks(urls, options = {}) {
  if (!Array.isArray(urls)) throw new TypeError('checkExternalLinks needs an array of URLs');
  const {
    fetch = safeFetch, fetchOptions = {}, maxLinks = LIMITS.maxOutboundChecks,
    concurrency = LIMITS.outboundConcurrency, perHostDelayMs = 1000 / LIMITS.ratePerSecDefault, sleep = realSleep,
  } = options;
  if (!Number.isInteger(maxLinks) || maxLinks < 0) throw new TypeError('checkExternalLinks maxLinks must be a non-negative integer');
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('checkExternalLinks concurrency must be a positive integer');
  if (!Number.isFinite(perHostDelayMs) || perHostDelayMs < 0) throw new TypeError('checkExternalLinks perHostDelayMs must be a non-negative number');

  const selected = [...new Set(urls.filter((u) => typeof u === 'string'))].sort().slice(0, maxLinks);
  const maxHops = Math.min(fetchOptions.maxRedirects ?? MAX_HOPS, MAX_HOPS);

  // Pacing is per host name and shared by every worker, so a redirect to another
  // host waits its turn like that host's own requests.
  /** @type {Map<string, {tail: Promise<unknown>, used: boolean}>} */
  const pacers = new Map();
  /** @param {string} url @param {Parameters<typeof safeFetch>[1]} options @returns {Promise<FetchResult>} */
  const paced = (url, options) => {
    const host = hostOf(url);
    const pacer = pacers.get(host) ?? { tail: Promise.resolve(), used: false };
    pacers.set(host, pacer);
    const run = pacer.tail.then(async () => {
      if (pacer.used && perHostDelayMs > 0) await sleep(perHostDelayMs);
      pacer.used = true;
      return fetch(url, options);
    });
    pacer.tail = run.catch(() => undefined);
    return run;
  };
  /** @param {string} url @param {'HEAD'|'GET'} method */
  const request = (url, method) => {
    const extra = method === 'GET' ? { maxBytes: Math.min(fetchOptions.maxBytes ?? RETRY_MAX_BYTES, RETRY_MAX_BYTES) } : {};
    return paced(url, { ...fetchOptions, ...extra, maxRedirects: 0, method });
  };

  /** @type {Map<string, Promise<{robots: Awaited<ReturnType<typeof loadRobots>>, error: FetchResult['error']}>>} */
  const robotsByOrigin = new Map();
  /** robots.txt of an origin, read once. @param {string} origin */
  const robotsFor = (origin) => {
    let entry = robotsByOrigin.get(origin);
    if (!entry) {
      entry = (async () => {
        /** @type {FetchResult['error']} The first request's error: it says whether the host exists. */
        let error = null;
        let calls = 0;
        /** @type {typeof safeFetch} Every robots.txt hop is a separate, paced request. */
        const robotsFetch = async (url, opts) => {
          const result = await paced(url, opts);
          if (calls === 0) error = result.error;
          calls += 1;
          return result;
        };
        const robots = await loadRobots(origin, { fetch: robotsFetch, fetchOptions });
        return { robots, error };
      })();
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
    let current = url;
    const seen = new Set([url]);
    for (let hops = 0; ; hops += 1) {
      const origin = originOf(current);
      if (origin !== null && /^https?:/.test(origin)) {
        const { robots, error } = await robotsFor(origin);
        if (robots.summary.status === 'unreachable') {
          return error?.code === 'dns_error'
            ? { url, status: 0, outcome: 'broken', reason: 'dns_error', final_url: null }
            : unverifiable('robots.txt could not be read');
        }
        if (!robots.isAllowed(current)) return unverifiable('Disallowed by robots.txt');
      }
      let result = await request(current, 'HEAD');
      if (result.error !== null || result.status >= 400) result = await request(current, 'GET');
      if (result.error !== null || !REDIRECT_STATUSES.has(result.status)) return classify(url, result);
      const location = result.headers.location;
      if (location === undefined) return unverifiable('invalid_url', result.status);

      const target = redirectTarget(location, current);
      if (target === null) return unverifiable('invalid_url', result.status);
      if (seen.has(target)) return unverifiable('redirect_loop', result.status);
      if (hops + 1 > maxHops) return unverifiable('too_many_redirects', result.status);
      seen.add(target);
      current = target;
    }
  };

  /** @type {Map<string, OutboundResult>} */
  const results = new Map();
  // Workers take links in sorted order; per-host pacing keeps each host sequential.
  const byHost = new Map();
  for (const url of selected) {
    const host = hostOf(url);
    byHost.set(host, [...(byHost.get(host) ?? []), url]);
  }
  const hostQueue = [...byHost.keys()].sort();
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
