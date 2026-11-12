// One crawl, start to finish (ARCHITECTURE.md 4.5).

import { LIMITS, SCHEMA_VERSION, USER_AGENT } from '../config.js';
import { loadSitemaps } from '../net/sitemap.js';
import { isInternalUrl, looksLikeHtmlUrl, originOf } from '../util/url.js';
import { asksFirst, createChainFollower, recordsForChain } from './chain.js';
import { localizeRecord, localizeUrls } from './deployed.js';
import { createFrontier } from './frontier.js';
import { probeHttp } from './probe.js';
import { createRecords } from './records.js';
import { createRequests } from './requests.js';

/** @import { CrawlBlock, CrawlResult, FetchResult, HttpProbe, PageRecord, SitemapSummary } from '../types.js' */
/** @import { safeFetch } from '../net/safe-fetch.js' */
/** @import { Chain, Extractor } from './chain.js' */
/** @import { HostGates } from '../net/polite.js' */
/** @import { RobotsCache } from '../net/robots-cache.js' */

const MAX_ROBOTS_BLOCKED = 200;
const STRIKES = 3;
/** URLs ending in .js, .json, .xml or .txt asked about with HEAD in one crawl (crawl/chain.js `asksFirst`). */
const MAX_ASKED = 50;
/** Fetch errors after which no HTTP answer came back: the connection was refused or cut, or nothing answered in time. */
const NO_ANSWER = new Set(['connection_error', 'timeout']);
/** What to check when a server on this machine does not answer. */
const DEV_SERVER_HINT = ' Check that the dev server is running and that the port is right.';

/**
 * @typedef {Object} CrawlParams
 * @property {string} id
 * @property {string} startedAt  ISO 8601.
 * @property {string} startUrl   Normalized.
 * @property {number} maxPages
 * @property {number} ratePerSec
 * @property {boolean} includeSubdomains
 * @property {string|null} loopbackOrigin  The start origin when auditing a local site; null otherwise.
 * @property {string|null} [deployedOrigin]  Local site only: the origin the project is deployed at. Canonicals and
 *   sitemap entries on it are read as addresses on the local server (crawl/deployed.js); it is never requested.
 */

/**
 * @typedef {Object} CrawlDeps
 * @property {typeof safeFetch} fetch
 * @property {Extractor} extract
 * @property {() => Date} now
 * @property {(ms: number) => Promise<void>} sleep
 * @property {HostGates} [hosts]  The host gates every request passes; defaults to the process's (net/polite.js).
 * @property {RobotsCache} [robotsCache]  Where robots.txt files read are shared; defaults to the process's.
 * @property {number} [maxStoredChars]  Characters the page records of one crawl may hold in all; defaults
 *   to `MAX_STORED_CHARS`.
 * @property {number} [maxDurationMs]  How long the crawl may take, by `now`; defaults to `LIMITS.crawlMaxMs`.
 */

/**
 * Characters the page records of one crawl may hold, as JSON. A page record is
 * bounded (about 1.5 MB at most), but a few hundred of them could still exhaust
 * memory and exceed what one stored file can hold; the crawl stops there as
 * truncated. Ordinary crawls stay far below it.
 */
export const MAX_STORED_CHARS = 150_000_000;

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
 * challenges or three 429s in a row; no new page is taken from the frontier once
 * `maxDurationMs` has passed (the page under way finishes, with its waits, its
 * 429 retry and its redirect hops), and the crawl ends as truncated, with
 * `time_limit_reached`, when a URL that could be fetched was left. A crawl of a local site (`loopbackOrigin`)
 * sends no request to any other origin, whatever a redirect says. With `deployedOrigin`, URLs on that origin
 * in canonical links, links, robots.txt Sitemap lines and sitemaps count as local ones.
 *
 * @param {CrawlParams} params
 * @param {CrawlDeps} deps
 * @param {(progress: {pages_crawled: number, pages_queued: number}) => void} onProgress
 * @returns {Promise<CrawlOutcome>}
 */
export async function runCrawl(params, deps, onProgress) {
  const { startUrl, maxPages, ratePerSec, includeSubdomains, loopbackOrigin, startedAt } = params;
  const { fetch, now, sleep } = deps;
  const startedMs = now().getTime();
  const maxDurationMs = deps.maxDurationMs ?? LIMITS.crawlMaxMs;
  let timeUp = false;
  const deployed = loopbackOrigin !== null && params.deployedOrigin ? params.deployedOrigin : null;
  /** @type {Extractor} */
  const extract = deployed === null || loopbackOrigin === null ? deps.extract : {
    ...deps.extract,
    extractPage: (input) => {
      // The deployed site's address is the site's own, share links that name it too.
      const record = deps.extract.extractPage({ ...input, deployedOrigin: deployed });
      const local = localizeRecord(record, deployed, loopbackOrigin);
      if (local !== record) localized += 1;
      return local;
    },
  };
  /** Pages, robots.txt Sitemap lines and sitemap entries that named the deployed origin. */
  let localized = 0;
  const { politeFetch, fetchPage, robotsFor, knownRobots, lastError } = createRequests({
    fetch, now, sleep, ratePerSec, loopbackOrigin, ...(deps.hosts ? { hosts: deps.hosts } : {}), ...(deps.robotsCache ? { robotsCache: deps.robotsCache } : {}),
  });

  /** @type {string[]} */
  const robotsBlocked = [];
  const robotsBlockedSet = new Set();
  const frontier = createFrontier();
  /** @type {SitemapSummary} */
  let sitemap = { loaded: false, files: [], urls: [], truncated: false };
  let sitemapSet = new Set();
  /** @type {HttpProbe|null} */
  let httpProbe = null;
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
      options: { max_pages: maxPages, rate_per_sec: ratePerSec, include_subdomains: includeSubdomains, local: loopbackOrigin !== null, ...(deployed === null ? {} : { deployed_origin: deployed, deployed_localized: localized }) },
      robots: robots.summary, sitemap, http_probe: httpProbe, pages: records.pages,
      robots_blocked: robotsBlocked, disallowed_links: records.disallowedLinks(), truncated: records.truncated(), blocked, user_agent: USER_AGENT,
      ...(timeUp ? { time_limit_reached: true } : {}),
    };
    return { status: blocked ? 'blocked' : 'done', result };
  };
  /**
   * @param {CrawlBlock['reason']} reason @param {string} url @param {number} status
   * @param {string|null} [redirectedTo]  Where robots.txt redirected, when that address was refused.
   */
  const block = (reason, url, status, redirectedTo = null) => {
    blocked = { reason, url, status, ...(redirectedTo === null ? {} : { redirected_to: redirectedTo }) };
    return finish();
  };
  /** @param {string} url @param {NonNullable<FetchResult['error']>} error @returns {CrawlOutcome} */
  const failure = (url, error) => {
    const hint = error.code === 'blocked_address'
      ? ' Seekwide audits public sites only; for a site on this machine, allow localhost explicitly.'
      : loopbackOrigin !== null && NO_ANSWER.has(error.code) ? DEV_SERVER_HINT : ' Check the URL and that the site is reachable.';
    return { status: 'failed', error: `Could not fetch ${url}: ${error.message} (${error.code}).${hint}` };
  };
  /** @param {string} url */
  const noteRobotsBlocked = (url) => {
    if (robotsBlockedSet.has(url) || robotsBlocked.length >= MAX_ROBOTS_BLOCKED) return;
    robotsBlockedSet.add(url);
    robotsBlocked.push(url);
  };
  /** A URL that may be a page: one that looks like one, or one the crawler asks about first (`asksFirst`). @param {string} url */
  const crawlable = (url) => isInternalUrl(url, host, includeSubdomains) && (looksLikeHtmlUrl(url) || asksFirst(url));
  /** URLs asked about with HEAD so far; at most `MAX_ASKED`, so a site full of .json links costs a few requests only. */
  let asked = 0;
  const records = createRecords({ maxPages, maxStoredChars: deps.maxStoredChars ?? MAX_STORED_CHARS, frontier, crawlable, knownRobots });

  const followChain = createChainFollower({
    fetchPage, robotsFor, noteRobotsBlocked, loopbackOrigin, site: () => ({ host, includeSubdomains }),
    recordOf: records.get,
  });

  /** @param {string} url @param {Chain} chain @param {number|null} depth @param {PageRecord['discovered_via']} discoveredVia */
  const record = (url, chain, depth, discoveredVia) => records.add(recordsForChain({
    url, chain, depth, discoveredVia, extract, siteHost: host, includeSubdomains, isRecorded: records.has,
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
  // not be contacted at all, is a failed crawl rather than a robots.txt problem;
  // so is a server on this machine that does not answer (a dev server not started
  // yet, or another port).
  if (robots.summary.status === 'unreachable') {
    // robots.txt answered with a redirect to an address this crawl may not request: say where it led.
    if (robots.refusedRedirect !== null) return block('robots_unreachable', robots.summary.url, robots.summary.http_status, robots.refusedRedirect);
    const error = lastError(robots.summary.url);
    if (error && (error.code === 'blocked_address' || error.code === 'dns_error')) return failure(startUrl, error);
    if (error && loopbackOrigin !== null && NO_ANSWER.has(error.code)) {
      return { status: 'failed', error: `Nothing answered at ${loopbackOrigin} (${error.message}).${DEV_SERVER_HINT}` };
    }
    return block('robots_unreachable', robots.summary.url, robots.summary.http_status);
  }
  if (!robots.isAllowed(startUrl)) return block('robots_disallow', startUrl, 0);

  // 2. The start URL. Its redirects may cross origins; the last origin becomes the site.
  const start = await followChain(startUrl, 'start');
  if (start.kind === 'fail') return { status: 'failed', error: start.message };
  if (start.kind === 'block') return block(start.reason, start.url, start.status, start.redirected_to ?? null);
  if (start.result !== null && start.result.error !== null) return failure(start.finalUrl, start.result.error);
  if (start.result !== null && start.finalUrl !== startUrl) {
    origin = /** @type {string} */ (originOf(start.finalUrl));
    host = new URL(start.finalUrl).host;
    robots = await robotsFor(origin);
  }
  record(startUrl, start, 0, ['start']);
  onProgress({ pages_crawled: records.pages.length, pages_queued: frontier.size() });
  const startStrike = strike(start, true);
  if (startStrike) return block(startStrike, start.finalUrl, start.result?.status ?? 0);

  // 3. Sitemaps listed in robots.txt, or a guess at /sitemap.xml. Only on-site sitemaps are read.
  // Each sitemap request (file, index child, guess, redirect hop) is asked of its own origin's robots.txt.
  /** @param {string} url */
  const sitemapAllowed = async (url) => (await robotsFor(/** @type {string} */ (originOf(url)))).isAllowed(url);
  const sitemapOptions = { fetch: politeFetch, siteHost: host, includeSubdomains, isAllowed: sitemapAllowed };
  const listed = deployed === null || loopbackOrigin === null ? robots.summary.sitemaps : localizeUrls(robots.summary.sitemaps, deployed, loopbackOrigin);
  sitemap = listed.length > 0
    ? await loadSitemaps(listed, sitemapOptions)
    : await loadSitemaps([`${origin}/sitemap.xml`], { ...sitemapOptions, probe: true });
  if (deployed !== null && loopbackOrigin !== null) {
    const urls = localizeUrls(sitemap.urls, deployed, loopbackOrigin);
    localized += robots.summary.sitemaps.filter((url) => !listed.includes(url)).length + sitemap.urls.filter((url) => !urls.includes(url)).length;
    sitemap = { ...sitemap, urls };
  }
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
    if (records.has(url)) continue;
    if (records.full()) break;
    if (records.atLimit()) {
      if (!records.truncated()) records.cutShort(remainsFetchable(url));
      break;
    }
    if (now().getTime() - startedMs >= maxDurationMs) {
      timeUp = remainsFetchable(url);
      records.cutShort(timeUp);
      break;
    }
    if (!(await robotsFor(/** @type {string} */ (originOf(url)))).isAllowed(url)) {
      noteRobotsBlocked(url);
      continue;
    }
    if (asksFirst(url)) {
      if (asked >= MAX_ASKED) continue;
      asked += 1;
    }
    const chain = /** @type {Chain} */ (await followChain(url, 'page'));
    /** @type {PageRecord['discovered_via']} */
    const discoveredVia = depth === null ? ['sitemap'] : sitemapSet.has(url) ? ['link', 'sitemap'] : ['link'];
    record(url, chain, depth, discoveredVia);
    onProgress({ pages_crawled: records.pages.length, pages_queued: frontier.size() });
    const reason = strike(chain, false);
    if (reason) return block(reason, chain.finalUrl, chain.result?.status ?? 0);
  }
  return finish();

  /** @param {string} first A URL taken from the frontier. @returns {boolean} */
  function remainsFetchable(first) {
    if (records.fetchable(first)) return true;
    for (let entry = frontier.next(); entry !== null; entry = frontier.next()) {
      if (records.fetchable(entry.url)) return true;
    }
    return false;
  }
}
