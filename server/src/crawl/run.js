// One crawl, start to finish (ARCHITECTURE.md 4.5, with docs/internal/REVIEW-FIXES.md R2 to R5 and R9).

import { LIMITS, SCHEMA_VERSION, USER_AGENT } from '../config.js';
import { loadRobots } from '../net/robots.js';
import { loadSitemaps } from '../net/sitemap.js';
import { isInternalUrl, looksLikeHtmlUrl, originOf } from '../util/url.js';
import { createChainFollower, recordsForChain } from './chain.js';
import { isBotChallenge, RETRY_AFTER_MAX_MS, retryAfterMs } from './challenge.js';
import { createFrontier } from './frontier.js';
import { probeHttp } from './probe.js';

/** @import { CrawlBlock, CrawlResult, FetchResult, HttpProbe, PageRecord, SitemapSummary } from '../types.js' */
/** @import { safeFetch } from '../net/safe-fetch.js' */
/** @import { Chain, Extractor } from './chain.js' */

const MAX_ROBOTS_BLOCKED = 200;
const STRIKES = 3;

/**
 * @typedef {Object} CrawlParams
 * @property {string} id
 * @property {string} startedAt  ISO 8601.
 * @property {string} startUrl   Normalized.
 * @property {number} maxPages
 * @property {number} ratePerSec
 * @property {boolean} includeSubdomains
 * @property {string|null} loopbackOrigin  The start origin when auditing a local site; null otherwise.
 */

/**
 * @typedef {Object} CrawlDeps
 * @property {typeof safeFetch} fetch
 * @property {Extractor} extract
 * @property {() => Date} now
 * @property {(ms: number) => Promise<void>} sleep
 */

/** @typedef {{status: 'done'|'blocked', result: CrawlResult} | {status: 'failed', error: string}} CrawlOutcome */

/**
 * Crawl one site politely and deterministically.
 *
 * Guarantees: one request at a time, with `max(1000 / ratePerSec, crawl-delay)`
 * between consecutive requests, every redirect hop included; only on-site,
 * HTML-looking, robots-allowed URLs are requested, and a redirect never leads
 * to any other URL; the fetch order depends only on the site's content; a
 * response that refuses the crawler is recorded as unreadable, never as content;
 * the crawl stops at a bot challenge on the start page, or after three
 * challenges or three 429s in a row.
 *
 * @param {CrawlParams} params
 * @param {CrawlDeps} deps
 * @param {(progress: {pages_crawled: number, pages_queued: number}) => void} onProgress
 * @returns {Promise<CrawlOutcome>}
 */
export async function runCrawl(params, deps, onProgress) {
  const { startUrl, maxPages, ratePerSec, includeSubdomains, loopbackOrigin, startedAt } = params;
  const { fetch, extract, now, sleep } = deps;
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

  /** @type {Map<string, Awaited<ReturnType<typeof loadRobots>>>} */
  const robotsByOrigin = new Map();
  /** @param {string} origin */
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

  /** @type {PageRecord[]} */
  const pages = [];
  /** @type {Map<string, PageRecord>} */
  const recorded = new Map();
  /** @type {string[]} */
  const robotsBlocked = [];
  const robotsBlockedSet = new Set();
  const frontier = createFrontier();
  /** @type {SitemapSummary} */
  let sitemap = { loaded: false, files: [], urls: [], truncated: false };
  let sitemapSet = new Set();
  /** @type {HttpProbe|null} */
  let httpProbe = null;
  let truncated = false;
  /** @type {CrawlBlock|null} */
  let blocked = null;
  let origin = /** @type {string} */ (originOf(startUrl));
  let host = new URL(startUrl).host;
  let robots = await robotsFor(origin);

  /** @returns {CrawlOutcome} */
  const finish = () => {
    /** @type {CrawlResult} */
    const result = {
      schema_version: SCHEMA_VERSION, id: params.id, start_url: startUrl, site_origin: origin, site_host: host,
      started_at: startedAt, finished_at: now().toISOString(),
      options: { max_pages: maxPages, rate_per_sec: ratePerSec, include_subdomains: includeSubdomains, local: loopbackOrigin !== null },
      robots: robots.summary, sitemap, http_probe: httpProbe, pages,
      robots_blocked: robotsBlocked, truncated, blocked, user_agent: USER_AGENT,
    };
    return { status: blocked ? 'blocked' : 'done', result };
  };
  /** @param {CrawlBlock['reason']} reason @param {string} url @param {number} status */
  const block = (reason, url, status) => {
    blocked = { reason, url, status };
    return finish();
  };
  /** @param {string} url @param {NonNullable<FetchResult['error']>} error @returns {CrawlOutcome} */
  const failure = (url, error) => {
    const hint = error.code === 'blocked_address'
      ? ' Seekwide audits public sites only; for a site on this machine, allow localhost explicitly.'
      : ' Check the URL and that the site is reachable.';
    return { status: 'failed', error: `Could not fetch ${url}: ${error.message} (${error.code}).${hint}` };
  };
  /** @param {string} url */
  const noteRobotsBlocked = (url) => {
    if (robotsBlockedSet.has(url) || robotsBlocked.length >= MAX_ROBOTS_BLOCKED) return;
    robotsBlockedSet.add(url);
    robotsBlocked.push(url);
  };
  /** @param {string} url */
  const crawlable = (url) => isInternalUrl(url, host, includeSubdomains) && looksLikeHtmlUrl(url);
  /** True when a URL could still be fetched: not recorded and not known to be disallowed. @param {string} url */
  const fetchable = (url) => {
    if (recorded.has(url)) return false;
    const known = robotsByOrigin.get(/** @type {string} */ (originOf(url)));
    return known === undefined || known.isAllowed(url);
  };

  const followChain = createChainFollower({
    fetchPage, robotsFor, noteRobotsBlocked, loopbackOrigin, site: () => ({ host, includeSubdomains }),
    recordOf: (url) => recorded.get(url),
  });

  /** @param {PageRecord[]} records */
  const addRecords = (records) => {
    for (const record of records) {
      if (recorded.has(record.url)) continue;
      if (pages.length >= maxPages) {
        truncated = truncated || fetchable(record.url);
        return;
      }
      pages.push(record);
      recorded.set(record.url, record);
      frontier.markSeen(record.url);
      if (record.depth === null || record.status !== 200 || !record.is_html) continue;
      for (const link of record.links) {
        if (link.url !== null && crawlable(link.url) && !recorded.has(link.url)) frontier.add(link.url, record.depth + 1);
      }
    }
  };
  /** @param {string} url @param {Chain} chain @param {number|null} depth @param {PageRecord['discovered_via']} discoveredVia */
  const record = (url, chain, depth, discoveredVia) => addRecords(recordsForChain({
    url, chain, depth, discoveredVia, extract, siteHost: host, includeSubdomains, isRecorded: (u) => recorded.has(u),
  }));

  let challenges = 0;
  let rateLimits = 0;
  /** @param {Chain} chain @param {boolean} isStart @returns {CrawlBlock['reason']|null} */
  const strike = (chain, isStart) => {
    challenges = chain.refusal === 'bot_challenge' ? challenges + 1 : 0;
    rateLimits = chain.result?.status === 429 ? rateLimits + 1 : 0;
    if (challenges > 0 && (isStart || challenges >= STRIKES)) return 'bot_challenge';
    if (rateLimits >= STRIKES) return 'rate_limited';
    return null;
  };

  // 1. robots.txt for the start origin. A host that cannot be resolved, or may
  // not be contacted at all, is a failed crawl rather than a robots.txt problem.
  if (robots.summary.status === 'unreachable') {
    const error = lastErrors.get(robots.summary.url);
    if (error && (error.code === 'blocked_address' || error.code === 'dns_error')) return failure(startUrl, error);
    return block('robots_unreachable', robots.summary.url, robots.summary.http_status);
  }
  if (!robots.isAllowed(startUrl)) return block('robots_disallow', startUrl, 0);

  // 2. The start URL. Its redirects may cross origins; the last origin becomes the site.
  const start = await followChain(startUrl, 'start');
  if (start.kind === 'fail') return { status: 'failed', error: start.message };
  if (start.kind === 'block') return block(start.reason, start.url, start.status);
  if (start.result !== null && start.result.error !== null) return failure(start.finalUrl, start.result.error);
  if (start.result !== null && start.finalUrl !== startUrl) {
    origin = /** @type {string} */ (originOf(start.finalUrl));
    host = new URL(start.finalUrl).host;
    robots = await robotsFor(origin);
  }
  record(startUrl, start, 0, ['start']);
  onProgress({ pages_crawled: pages.length, pages_queued: frontier.size() });
  const startStrike = strike(start, true);
  if (startStrike) return block(startStrike, start.finalUrl, start.result?.status ?? 0);

  // 3. Sitemaps listed in robots.txt, or a guess at /sitemap.xml. Only on-site sitemaps are read.
  // Each sitemap request (file, index child, guess, redirect hop) is asked of its own origin's robots.txt.
  /** @param {string} url */
  const sitemapAllowed = async (url) => (await robotsFor(/** @type {string} */ (originOf(url)))).isAllowed(url);
  const sitemapOptions = { fetch: politeFetch, siteHost: host, includeSubdomains, isAllowed: sitemapAllowed };
  sitemap = robots.summary.sitemaps.length > 0
    ? await loadSitemaps(robots.summary.sitemaps, sitemapOptions)
    : await loadSitemaps([`${origin}/sitemap.xml`], { ...sitemapOptions, probe: true });
  sitemapSet = new Set(sitemap.urls);
  for (const url of sitemap.urls) if (crawlable(url)) frontier.addSitemap(url);

  // 4. Does http:// redirect to https://? Only for a site on the default port: http on port 80 of a
  // host served on another port is another site. Followed by hand while it stays on http:// on the site.
  const siteUrl = new URL(origin);
  if (siteUrl.protocol === 'https:' && siteUrl.port === '') {
    httpProbe = await probeHttp(`http://${siteUrl.hostname}/`, { fetch: politeFetch, robotsFor, siteHost: host, includeSubdomains });
  }

  // 5 to 10. Breadth-first crawl.
  for (let entry = frontier.next(); entry !== null; entry = frontier.next()) {
    const { url, depth } = entry;
    if (recorded.has(url)) continue;
    if (pages.length >= maxPages) {
      truncated = truncated || remainsFetchable(url);
      break;
    }
    if (!(await robotsFor(/** @type {string} */ (originOf(url)))).isAllowed(url)) {
      noteRobotsBlocked(url);
      continue;
    }
    const chain = /** @type {Chain} */ (await followChain(url, 'page'));
    /** @type {PageRecord['discovered_via']} */
    const discoveredVia = depth === null ? ['sitemap'] : sitemapSet.has(url) ? ['link', 'sitemap'] : ['link'];
    record(url, chain, depth, discoveredVia);
    onProgress({ pages_crawled: pages.length, pages_queued: frontier.size() });
    const reason = strike(chain, false);
    if (reason) return block(reason, chain.finalUrl, chain.result?.status ?? 0);
  }
  return finish();

  /** @param {string} first A URL taken from the frontier. @returns {boolean} */
  function remainsFetchable(first) {
    if (fetchable(first)) return true;
    for (let entry = frontier.next(); entry !== null; entry = frontier.next()) {
      if (fetchable(entry.url)) return true;
    }
    return false;
  }
}
