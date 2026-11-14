// Reading the audited site's app association files (aso module): Apple's
// apple-app-site-association and Android's assetlinks.json, at the addresses
// both platforms read them from. robots.txt first; one GET each.

import { LIMITS } from '../config.js';
import { NOT_REQUESTED, offLimitsReason } from '../util/off-limits.js';
import { clip } from '../util/strings.js';
import { originOf } from '../util/url.js';
import { SHARED_HOST_GATES, createPacer, followRedirects, guardFetch, hostOf, rawTarget, sleep as wait } from './polite.js';
import { SHARED_ROBOTS, readRobots } from './robots-cache.js';
import { safeFetch } from './safe-fetch.js';

/** @import { AppFileResult, AppFiles, FetchResult } from '../types.js' */
/** @import { HostGates } from './polite.js' */
/** @import { RobotsCache, RobotsRead } from './robots-cache.js' */

/** Where Apple (Supporting associated domains) and Android (Configure assetlinks) read the files. */
export const APP_FILE_PATHS = Object.freeze({
  aasa: '/.well-known/apple-app-site-association',
  assetlinks: '/.well-known/assetlinks.json',
});
/** Redirects followed to see whether a file is behind one: enough for a host or slash change, not a tour. */
const MAX_HOPS = 3;
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/**
 * @param {FetchResult} result
 * @returns {string|null}
 */
function mediaType(result) {
  const type = result.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() ?? '';
  return type === '' ? null : clip(type, 100);
}

/**
 * Read the two app association files of a site, politely.
 *
 * Guarantees: the files are asked for at `siteOrigin` + `APP_FILE_PATHS`, one
 * after the other. Before the first request to an origin its robots.txt is
 * read once (or taken from `robotsCache`, where another check of this process
 * left it); a file it disallows is 'disallowed' and never requested, and a
 * file of an origin whose robots.txt cannot be read is 'unverifiable'. Each
 * file gets one GET that reads at most `maxBytes`. A redirect is recorded and,
 * to learn whether the file is behind it, followed by hand up to 3 steps, each
 * only on a host `sameSite` accepts and its robots.txt allows; nothing is ever
 * sent to Google Play or a social platform. Requests to one host are
 * `perHostDelayMs` apart, or the host's crawl-delay when that is longer (at
 * most `LIMITS.crawlDelayMaxSec`), and pass the process-wide host gates
 * (`hosts`). The outcome is 'answered' for a 200 whose body is neither empty
 * nor an HTML page (a site that answers every unknown address with a page),
 * 'not_found' for 404, 410, an empty body or an HTML page, and 'unverifiable'
 * for anything else (a refusal, a server error, a body over `maxBytes`, a
 * network error, a redirect off the site or past 3 steps). Only an 'answered'
 * file keeps its body. No request starts after `signal` fired: the call
 * rejects with its reason.
 *
 * @param {string} siteOrigin
 * @param {{fetch?: typeof safeFetch, fetchOptions?: Parameters<typeof safeFetch>[1], perHostDelayMs?: number,
 *          sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, signal?: AbortSignal, hosts?: HostGates,
 *          robotsCache?: RobotsCache, maxBytes?: number, sameSite?: (url: string) => boolean}} [options]
 * @returns {Promise<AppFiles>}
 */
export async function fetchAppFiles(siteOrigin, options = {}) {
  const origin = originOf(siteOrigin);
  if (origin === null || !/^https?:/.test(origin)) throw new TypeError('fetchAppFiles needs an http(s) origin');
  const {
    fetch: given = safeFetch, fetchOptions = {}, perHostDelayMs = 1000 / LIMITS.ratePerSecDefault, sleep = wait, signal,
    hosts = SHARED_HOST_GATES, robotsCache = SHARED_ROBOTS, maxBytes = LIMITS.appFileMaxBytes,
    sameSite = (/** @type {string} */ url) => originOf(url) === origin,
  } = options;
  // Every request, robots.txt and its redirects included, goes through the off-limits guard.
  const fetch = guardFetch(given);
  if (!Number.isFinite(perHostDelayMs) || perHostDelayMs < 0) throw new TypeError('fetchAppFiles perHostDelayMs must be a non-negative number');
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new TypeError('fetchAppFiles maxBytes must be a positive integer');

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
   * @returns {Promise<AppFileResult>}
   */
  const readFile = async (url) => {
    /** @type {AppFileResult} */
    const out = { url, outcome: 'unverifiable', status: 0, reason: null, location: null, final_url: null, content_type: null, body: null };
    /** @param {AppFileResult['outcome']} outcome @param {string} reason */
    const stop = (outcome, reason) => ({ ...out, outcome, reason });
    const chain = await followRedirects(url, {
      maxHops: MAX_HOPS,
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
      request: (current) => send(current, { method: 'GET', headers: { accept: 'application/json' }, maxBytes }),
    });
    const first = chain.hops[0];
    out.status = first?.status ?? (chain.kind === 'response' ? chain.result.status : 0);
    out.location = first === undefined ? null : clip(first.location ?? '', LIMITS.maxStringLength) || null;
    if (chain.kind === 'stopped') return { ...chain.value, status: out.status, location: out.location };
    if (chain.kind === 'unsent') return stop('unverifiable', 'Not sent');
    if (chain.kind !== 'response') return stop('unverifiable', { invalid: 'invalid_url', loop: 'redirect_loop', too_many: 'too_many_redirects' }[chain.kind]);
    const { result } = chain;
    out.final_url = chain.url === url ? null : chain.url;
    if (result.error !== null) return stop('unverifiable', result.error.code);
    out.content_type = mediaType(result);
    if (result.status === 404 || result.status === 410) return stop('not_found', `status_${result.status}`);
    if (result.status !== 200) return stop('unverifiable', `status_${result.status}`);
    if (result.truncated) return stop('unverifiable', `Larger than ${Math.round(maxBytes / 1024)} KiB, so not read`);
    const body = (result.body ?? Buffer.alloc(0)).toString('utf8').replace(/^﻿/, '');
    if (body.trim() === '') return stop('not_found', 'empty');
    // A page is known by its body: a server can send the real file as text/html (Apple reads no content type).
    if (body.trimStart().startsWith('<')) return stop('not_found', HTML_TYPES.has(out.content_type ?? '') ? 'html_page' : 'markup');
    return { ...out, outcome: 'answered', body };
  };

  const aasa = await readFile(`${origin}${APP_FILE_PATHS.aasa}`);
  const assetlinks = await readFile(`${origin}${APP_FILE_PATHS.assetlinks}`);
  return { aasa, assetlinks };
}
