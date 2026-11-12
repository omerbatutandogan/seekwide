// Crawl jobs: validation, background execution, snapshots and stored results.

import { randomBytes } from 'node:crypto';
import dns from 'node:dns';
import net from 'node:net';
import path from 'node:path';

import { dataDir as defaultDataDir, LIMITS } from '../config.js';
import { log } from '../log.js';
import { classifyAddress } from '../net/ip.js';
import { safeFetch } from '../net/safe-fetch.js';
import { normalizeUrl, originOf } from '../util/url.js';
import { deployedOriginOf } from './deployed.js';
import { MAX_RUNNING, busy, siteKey } from './admission.js';
import { runCrawl } from './run.js';
import { createCrawlStore } from './store.js';

/** @import { CrawlJob, CrawlResult, VitalsData } from '../types.js' */
/** @import { StoredVitals } from './store.js' */
/** @import { Extractor } from './chain.js' */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const RESULTS_IN_MEMORY = 5;

/** @typedef {(hostname: string, options: {all: true}) => Promise<{address: string, family: number}[]>} Lookup */

/**
 * `allowLoopback` is honoured only for a host whose every address is loopback.
 * @param {string} startUrl
 * @param {Lookup} lookup
 * @returns {Promise<void>}
 */
async function checkLocalStart(startUrl, lookup) {
  const { hostname } = new URL(startUrl);
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  let addresses;
  if (net.isIP(bare) !== 0) {
    addresses = [bare];
  } else {
    try {
      addresses = (await lookup(bare, { all: true })).map((entry) => entry.address);
    } catch (error) {
      throw new TypeError(`allowLoopback is only for a site on this machine, and ${bare} could not be resolved (${String(/** @type {any} */ (error)?.code ?? error)}).`);
    }
  }
  const outside = addresses.filter((address) => classifyAddress(address) !== 'loopback');
  if (addresses.length === 0 || outside.length > 0) {
    throw new TypeError(`allowLoopback is only for a site on this machine, but ${bare} resolves to ${outside.join(', ') || 'no address'}, which is not a loopback address. Leave allowLoopback off for this site.`);
  }
}

/** @param {number} ms */
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {Date} date
 * @returns {string} For example "c-20261111T140322Z-a1b2c3".
 */
function defaultId(date) {
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
  return `c-${stamp}-${randomBytes(3).toString('hex')}`;
}

/**
 * @param {unknown} options
 * @returns {{startUrl: string, maxPages: number, ratePerSec: number, includeSubdomains: boolean, allowLoopback: boolean, deployedOrigin: string|null}}
 */
function validateStart(options) {
  if (options === null || typeof options !== 'object') throw new TypeError('crawl start options must be an object with a url');
  const { url, maxPages = LIMITS.maxPagesDefault, ratePerSec = LIMITS.ratePerSecDefault } = /** @type {any} */ (options);
  const { includeSubdomains = false, allowLoopback = false, deployedUrl } = /** @type {any} */ (options);
  const startUrl = typeof url === 'string' ? normalizeUrl(url) : null;
  if (startUrl === null) {
    throw new TypeError(`"${String(url)}" is not an http or https URL. Pass a full URL such as https://example.com/.`);
  }
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > LIMITS.maxPagesHardCap) {
    throw new TypeError(`maxPages must be a whole number from 1 to ${LIMITS.maxPagesHardCap}.`);
  }
  if (typeof ratePerSec !== 'number' || !Number.isFinite(ratePerSec) || ratePerSec <= 0 || ratePerSec > LIMITS.ratePerSecMax) {
    throw new TypeError(`ratePerSec must be a number above 0 and at most ${LIMITS.ratePerSecMax}.`);
  }
  if (typeof includeSubdomains !== 'boolean') throw new TypeError('includeSubdomains must be true or false.');
  if (typeof allowLoopback !== 'boolean') throw new TypeError('allowLoopback must be true or false.');
  /** @type {string|null} */
  let deployedOrigin = null;
  if (deployedUrl !== undefined && deployedUrl !== null && deployedUrl !== '') {
    if (!allowLoopback) throw new TypeError('deployedUrl is for a crawl of a site on this machine (allowLoopback). A deployed site is crawled at its own address.');
    deployedOrigin = deployedOriginOf(deployedUrl);
    // Naming the local server itself changes nothing.
    if (deployedOrigin === originOf(startUrl)) deployedOrigin = null;
  }
  return { startUrl, maxPages, ratePerSec, includeSubdomains, allowLoopback, deployedOrigin };
}

/**
 * Create a crawl manager.
 *
 * Guarantees: `start` validates its input (rejecting with `TypeError`),
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
 *          now?: () => Date, sleep?: (ms: number) => Promise<void>, idFactory?: () => string, maxStoredChars?: number}} [deps]
 */
export function createCrawlManager(deps = {}) {
  const { dataDir = defaultDataDir(), fetch = safeFetch, now = () => new Date(), sleep = realSleep, idFactory } = deps;
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
        { fetch, extract, now, sleep, ...(deps.maxStoredChars === undefined ? {} : { maxStoredChars: deps.maxStoredChars }) },
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
  /** The site key (`siteKey`) of each job. @type {Map<string, string>} */
  const siteOf = new Map();

  /**
   * Check a local start, then create and run the job. The job and its site are
   * stored in the same step, so a call that arrives later finds the site once.
   * @param {ReturnType<typeof validateStart>} input
   * @param {string} site  `siteKey` of the start URL.
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
      const site = siteKey(input.startUrl, input.allowLoopback);
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
