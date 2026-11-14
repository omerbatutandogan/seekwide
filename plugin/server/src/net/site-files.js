// Reading a well-known file of the audited site, politely: robots.txt first,
// the host gates, one GET, redirects followed by hand only on the site. The
// aso module's app association files and the ai module's /llms.txt are read
// through it; each caller classifies the answer itself.

import { LIMITS } from '../config.js';
import { NOT_REQUESTED, offLimitsReason } from '../util/off-limits.js';
import { clip } from '../util/strings.js';
import { originOf } from '../util/url.js';
import { SHARED_HOST_GATES, createPacer, followRedirects, guardFetch, hostOf, rawTarget, sleep as wait } from './polite.js';
import { SHARED_ROBOTS, readRobots } from './robots-cache.js';
import { safeFetch } from './safe-fetch.js';

/** @import { FetchResult } from '../types.js' */
/** @import { HostGates } from './polite.js' */
/** @import { RobotsCache, RobotsRead } from './robots-cache.js' */

/** Redirects followed to see whether a file is behind one: enough for a host or slash change, not a tour. */
export const MAX_FILE_HOPS = 3;

/**
 * What came back for one file, before the caller says what it means.
 * @typedef {Object} SiteFileAnswer
 * @property {string} url              The address asked for.
 * @property {number} status           Status of the first answer; 0 when there was none.
 * @property {string|null} location    Where the first answer redirects, clipped; null when it is no redirect.
 * @property {{outcome: 'disallowed'|'unverifiable', reason: string}|null} stopped  Set when no answer is to be read: a
 *   step robots.txt disallows (the first: 'disallowed'), a robots.txt that could not be read, a redirect off the site or
 *   to a host never contacted, a loop or too many steps, a network error.
 * @property {FetchResult|null} result The last response, when `stopped` is null.
 * @property {string|null} final_url   Where the redirects ended, when there were any.
 */

/**
 * @typedef {Object} SiteFileOptions
 * @property {typeof safeFetch} [fetch]
 * @property {Parameters<typeof safeFetch>[1]} [fetchOptions]
 * @property {number} [perHostDelayMs]
 * @property {(ms: number, signal?: AbortSignal) => Promise<void>} [sleep]
 * @property {AbortSignal} [signal]
 * @property {HostGates} [hosts]
 * @property {RobotsCache} [robotsCache]
 * @property {(url: string) => boolean} [sameSite]  Whether a redirect may be followed to a URL; default: the same origin.
 */

/**
 * A reader of files at `siteOrigin`.
 *
 * Guarantees: every request goes through `guardFetch` (never Google Play or a
 * social platform, robots.txt and its redirects included). Before the first
 * request to an origin its robots.txt is read once (or taken from
 * `robotsCache`, where another requester of this process left it); a file it
 * disallows is never requested. Each file gets one GET with `maxRedirects: 0`
 * that reads at most `maxBytes`; a redirect is followed by hand, at most
 * `MAX_FILE_HOPS` steps, each only where `sameSite` allows and its robots.txt
 * allows. Requests to one host are `perHostDelayMs` apart, or the host's
 * crawl-delay when that is longer (at most `LIMITS.crawlDelayMaxSec`), and
 * pass the process-wide host gates. No request starts after `signal` fired:
 * `read` then rejects with its reason.
 * @param {string} siteOrigin
 * @param {SiteFileOptions} [options]
 * @returns {{origin: string, read: (url: string, request: {accept: string, maxBytes: number}) => Promise<SiteFileAnswer>}}
 */
export function createSiteFileReader(siteOrigin, options = {}) {
  const origin = originOf(siteOrigin);
  if (origin === null || !/^https?:/.test(origin)) throw new TypeError('createSiteFileReader needs an http(s) origin');
  const {
    fetch: given = safeFetch, fetchOptions = {}, perHostDelayMs = 1000 / LIMITS.ratePerSecDefault, sleep = wait, signal,
    hosts = SHARED_HOST_GATES, robotsCache = SHARED_ROBOTS, sameSite = (/** @type {string} */ url) => originOf(url) === origin,
  } = options;
  const fetch = guardFetch(given);
  if (!Number.isFinite(perHostDelayMs) || perHostDelayMs < 0) throw new TypeError('createSiteFileReader perHostDelayMs must be a non-negative number');

  /** A host's crawl-delay in milliseconds, once its robots.txt was read. @type {Map<string, number>} */
  const crawlDelays = new Map();
  const paced = createPacer({ delayMs: (host) => Math.max(perHostDelayMs, crawlDelays.get(host) ?? 0), sleep, signal, hosts });
  /** @param {string} url @param {Parameters<typeof safeFetch>[1]} opts */
  const send = async (url, opts) => /** @type {FetchResult} */ (await paced(url, () => fetch(url, { ...fetchOptions, ...opts, maxRedirects: 0 })));

  /** @type {Map<string, Promise<RobotsRead>>} */
  const robotsByOrigin = new Map();
  /** @param {string} target */
  const robotsFor = (target) => {
    let entry = robotsByOrigin.get(target);
    if (!entry) {
      entry = robotsCache.get({ origin: target, fetch, shared: !fetchOptions.allowLoopback }, () => readRobots(target, send, fetchOptions)).then((read) => {
        const delay = read.robots.summary.crawl_delay_sec;
        if (delay !== null) crawlDelays.set(hostOf(target), Math.min(delay, LIMITS.crawlDelayMaxSec) * 1000);
        return read;
      });
      robotsByOrigin.set(target, entry);
    }
    return entry;
  };

  /**
   * @param {string} url
   * @param {{accept: string, maxBytes: number}} request
   * @returns {Promise<SiteFileAnswer>}
   */
  const read = async (url, { accept, maxBytes }) => {
    if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new TypeError('createSiteFileReader maxBytes must be a positive integer');
    /** @param {'disallowed'|'unverifiable'} outcome @param {string} reason */
    const stop = (outcome, reason) => ({ outcome, reason });
    const chain = await followRedirects(url, {
      maxHops: MAX_FILE_HOPS,
      resolve: rawTarget,
      before: async (current, hop) => {
        if (!sameSite(current)) return stop('unverifiable', 'Redirects off the site, so not followed');
        const rule = offLimitsReason(current);
        if (rule !== null) return stop('unverifiable', NOT_REQUESTED[rule]);
        const { robots } = await robotsFor(/** @type {string} */ (originOf(current)));
        if (robots.summary.status === 'unreachable') return stop('unverifiable', 'robots.txt could not be read');
        if (robots.isAllowed(current)) return undefined;
        return hop === 0 ? stop('disallowed', 'Disallowed by robots.txt') : stop('unverifiable', 'A redirect step is disallowed by robots.txt');
      },
      request: (current) => send(current, { method: 'GET', headers: { accept }, maxBytes }),
    });
    const first = chain.hops[0];
    const status = first?.status ?? (chain.kind === 'response' ? chain.result.status : 0);
    const location = first === undefined ? null : clip(first.location ?? '', LIMITS.maxStringLength) || null;
    /** @type {SiteFileAnswer} */
    const answer = { url, status, location, stopped: null, result: null, final_url: null };
    if (chain.kind === 'stopped') return { ...answer, stopped: chain.value };
    if (chain.kind === 'unsent') return { ...answer, stopped: stop('unverifiable', 'Not sent') };
    if (chain.kind !== 'response') return { ...answer, stopped: stop('unverifiable', { invalid: 'invalid_url', loop: 'redirect_loop', too_many: 'too_many_redirects' }[chain.kind]) };
    const final = chain.url === url ? null : chain.url;
    if (chain.result.error !== null) return { ...answer, final_url: final, stopped: stop('unverifiable', chain.result.error.code) };
    return { ...answer, final_url: final, result: chain.result };
  };
  return { origin, read };
}

/**
 * The media type of a response, lower-cased and clipped; null without one.
 * @param {FetchResult} result
 * @returns {string|null}
 */
export function mediaTypeOf(result) {
  const type = result.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() ?? '';
  return type === '' ? null : clip(type, 100);
}
