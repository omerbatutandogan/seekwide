// Crawl jobs: validation, background execution, snapshots and stored results.

import { randomBytes } from 'node:crypto';
import dns from 'node:dns';
import path from 'node:path';

import { dataDir as defaultDataDir } from '../config.js';
import { log } from '../log.js';
import { SHARED_HOST_GATES, sleep as wait } from '../net/polite.js';
import { SHARED_ROBOTS } from '../net/robots-cache.js';
import { safeFetch } from '../net/safe-fetch.js';
import { crawlKey } from '../util/site-identity.js';
import { originOf } from '../util/url.js';
import { MAX_RUNNING, busy } from './admission.js';
import { runCrawl } from './run.js';
import { checkLocalStart, validateStart } from './start-input.js';
import { createCrawlStore } from './store.js';

/** @import { CrawlJob, CrawlResult, VitalsData } from '../types.js' */
/** @import { StoredVitals } from './store.js' */
/** @import { Extractor } from './chain.js' */
/** @import { HostGates } from '../net/polite.js' */
/** @import { RobotsCache } from '../net/robots-cache.js' */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const RESULTS_IN_MEMORY = 5;

/** @typedef {import('./start-input.js').Lookup} Lookup */

/**
 * @param {Date} date
 * @returns {string} For example "c-20261111T140322Z-a1b2c3".
 */
function defaultId(date) {
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  return `c-${stamp}-${randomBytes(3).toString('hex')}`;
}

/**
 * Create a crawl manager.
 *
 * Guarantees: `start` validates its input (rejecting with `InputError` for a value the caller passed),
 * honours `allowLoopback` only for a start host whose every address is
 * loopback and then limits loopback to the start origin, accepts `deployedUrl`
 * only together with it (and never requests that address), resolves with a
 * snapshot as soon as the input is checked, and crawls in the background;
 * `get` and `wait` return copies, never live objects; `result` returns a
 * finished crawl ('done' or 'blocked') from memory (the last five) or from
 * `<dataDir>/crawls/<id>.json`, and null for anything else; `storeVitals`
 * keeps Core Web Vitals with a crawl, per page count, and `storedVitals` returns
 * them, or null. The crawl directory is private to the user (0700, files 0600,
 * older files included once it is opened) and keeps the 20 newest crawls, each
 * with its stored measurements (`crawl/store.js`); `wasPruned` says whether a
 * crawl was deleted to keep them.
 *
 * @param {{dataDir?: string, fetch?: typeof safeFetch, extract?: Extractor, lookup?: Lookup,
 *          now?: () => Date, sleep?: (ms: number) => Promise<void>, idFactory?: () => string, maxStoredChars?: number,
 *          hosts?: HostGates, robotsCache?: RobotsCache, aiRobots?: import('./run.js').CrawlDeps['aiRobots']}} [deps]  `hosts` and `robotsCache` default to the ones the
 *   whole process shares (net/polite.js, net/robots-cache.js).
 */
export function createCrawlManager(deps = {}) {
  const {
    dataDir = defaultDataDir(), fetch = safeFetch, now = () => new Date(), sleep = (ms) => wait(ms), idFactory,
    hosts = SHARED_HOST_GATES, robotsCache = SHARED_ROBOTS,
  } = deps;
  const lookup = deps.lookup ?? /** @type {Lookup} */ ((hostname, options) => dns.promises.lookup(hostname, options));
  const store = createCrawlStore(path.join(dataDir, 'crawls'));

  /** @type {Map<string, {job: CrawlJob, done: Promise<void>}>} */
  const jobs = new Map();
  /** @type {Map<string, CrawlResult>} */
  const results = new Map();

  /** @returns {Promise<Extractor>} */
  const loadExtractor = async () => {
    if (deps.extract) return deps.extract;
    // Loaded lazily so the crawler can be used and tested with an injected extractor.
    const module = /** @type {any} */ (await import('../extract/page.js'));
    for (const name of ['extractPage', 'redirectRecord', 'unreadableRecord']) {
      if (typeof module[name] !== 'function') throw new Error(`extract/page.js does not export ${name}`);
    }
    return { extractPage: module.extractPage, redirectRecord: module.redirectRecord, unreadableRecord: module.unreadableRecord };
  };

  /** @param {CrawlResult} result */
  const remember = (result) => {
    results.delete(result.id);
    results.set(result.id, result);
    while (results.size > RESULTS_IN_MEMORY) results.delete(/** @type {string} */ (results.keys().next().value));
  };

  /** @param {CrawlJob} job @param {ReturnType<typeof validateStart>} input */
  const execute = async (job, input) => {
    try {
      const extract = await loadExtractor();
      const { allowLoopback, ...rest } = input;
      const outcome = await runCrawl(
        { id: job.id, startedAt: job.started_at, ...rest, loopbackOrigin: allowLoopback ? originOf(input.startUrl) : null },
        { fetch, extract, now, sleep, hosts, robotsCache, ...(deps.maxStoredChars === undefined ? {} : { maxStoredChars: deps.maxStoredChars }), ...(deps.aiRobots ? { aiRobots: deps.aiRobots } : {}) },
        (progress) => Object.assign(job, progress),
      );
      if (outcome.status === 'failed') {
        Object.assign(job, { status: 'failed', error: outcome.error, finished_at: now().toISOString() });
        return;
      }
      const { result } = outcome;
      remember(result);
      try {
        await store.save(result);
      } catch (error) {
        log.warn('could not store crawl result', { id: job.id, error: String(error) });
      }
      Object.assign(job, {
        status: outcome.status, pages_crawled: result.pages.length, truncated: result.truncated,
        blocked: result.blocked, finished_at: result.finished_at,
      });
    } catch (error) {
      log.error('crawl crashed', { id: job.id, error: String(/** @type {Error} */ (error)?.stack ?? error) });
      Object.assign(job, { status: 'failed', error: `The crawl stopped because of an internal error: ${String(/** @type {Error} */ (error)?.message ?? error)}`, finished_at: now().toISOString() });
    }
  };

  /** Origins whose crawl is being started: between the checks in `start` and the job's registration. */
  /** @type {Set<string>} */
  const starting = new Set();
  /** The site key (`crawlKey`) of each job. @type {Map<string, string>} */
  const siteOf = new Map();

  /**
   * Check a local start, then create and run the job. The job and its site are
   * stored in the same step, so a call that arrives later finds the site once.
   * @param {ReturnType<typeof validateStart>} input
   * @param {string} site  `crawlKey` of the start URL.
   * @returns {Promise<CrawlJob>}
   */
  const register = async (input, site) => {
    if (input.allowLoopback) await checkLocalStart(input.startUrl, lookup);
    const id = idFactory ? idFactory() : defaultId(now());
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error(`crawl id ${String(id)} is not a safe file name`);
    if (jobs.has(id)) throw new Error(`crawl id ${id} is already in use`);
    /** @type {CrawlJob} */
    const job = {
      id, status: 'running', start_url: input.startUrl, max_pages: input.maxPages, pages_crawled: 0, pages_queued: 0,
      truncated: false, blocked: null, error: null, started_at: now().toISOString(), finished_at: null,
    };
    siteOf.set(id, site);
    jobs.set(id, { job, done: execute(job, input) });
    return structuredClone(job);
  };

  return {
    /**
     * @param {{url: string, maxPages?: number, ratePerSec?: number, includeSubdomains?: boolean, allowLoopback?: boolean, deployedUrl?: string}} options
     * @returns {Promise<CrawlJob>}  Rejects with a TypeError while a crawl of the same origin is running,
     *   or while `MAX_RUNNING` crawls are.
     */
    async start(options) {
      const input = validateStart(options);
      const running = [...jobs.values()].filter((entry) => entry.job.status === 'running').map((entry) => entry.job);
      const site = crawlKey(input.startUrl, input.allowLoopback);
      const same = running.find((job) => siteOf.get(job.id) === site);
      if (same || starting.has(site)) {
        throw busy(`A crawl of this site is already running${same ? ` (job ${same.id}, ${same.start_url})` : ''}. Seekwide sends one request at a time to a site: wait for it with crawl_status, then start the next one.`);
      }
      // A site counts once, whether its job is registered already or still starting.
      const active = new Set([...running.map((job) => siteOf.get(job.id) ?? job.id), ...starting]);
      if (active.size >= MAX_RUNNING) {
        throw busy(`${MAX_RUNNING} crawls are running already, the most at once. Wait for one of them to finish with crawl_status.`);
      }
      // Held until the job is registered, so that calls arriving while this one awaits are counted too.
      starting.add(site);
      try {
        return await register(input, site);
      } finally {
        starting.delete(site);
      }
    },

    /** @param {string} id @returns {CrawlJob|null} */
    get(id) {
      const entry = jobs.get(id);
      return entry ? structuredClone(entry.job) : null;
    },

    /**
     * Wait until the job finishes or `timeoutMs` passes, whichever comes first.
     * @param {string} id @param {number} timeoutMs @returns {Promise<CrawlJob|null>}
     */
    async wait(id, timeoutMs) {
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) throw new TypeError('timeoutMs must be a non-negative number');
      const entry = jobs.get(id);
      if (!entry) return null;
      if (entry.job.status === 'running') {
        /** @type {NodeJS.Timeout|undefined} */
        let timer;
        await Promise.race([entry.done, new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); })]);
        clearTimeout(timer);
      }
      return structuredClone(entry.job);
    },

    /** @param {string} id @returns {Promise<CrawlResult|null>} */
    async result(id) {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) return null;
      const entry = jobs.get(id);
      if (entry && entry.job.status !== 'done' && entry.job.status !== 'blocked') return null;
      return results.get(id) ?? store.load(id);
    },

    /**
     * True when a finished crawl's result was deleted from the cache, which keeps the newest 20.
     * @param {string} id @returns {Promise<boolean>}
     */
    async wasPruned(id) {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) return false;
      return store.wasPruned(id);
    },

    /**
     * The Core Web Vitals kept with a crawl for a page count, or null.
     * @param {string} id @param {number} pages @returns {Promise<StoredVitals|null>}
     */
    async storedVitals(id, pages) {
      if (typeof id !== 'string' || !ID_PATTERN.test(id) || !Number.isInteger(pages)) return null;
      return store.loadVitals(id, pages);
    },

    /**
     * Keep Core Web Vitals with a crawl, so that later audits of it reuse them.
     * @param {string} id @param {number} pages @param {VitalsData} vitals @param {string} measuredAt
     */
    async storeVitals(id, pages, vitals, measuredAt) {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new TypeError(`crawl id ${String(id)} is not a safe file name`);
      if (!Number.isInteger(pages) || pages < 1) throw new TypeError('pages must be a whole number of 1 or more.');
      await store.saveVitals(id, pages, { vitals, measured_at: measuredAt });
    },
  };
}
