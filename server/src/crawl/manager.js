// Crawl jobs: validation, background execution, snapshots and stored results.

import { randomBytes } from 'node:crypto';
import dns from 'node:dns';
import { chmod, lstat, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
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

/** @import { CrawlJob, CrawlResult } from '../types.js' */
/** @import { Extractor } from './chain.js' */

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const RESULTS_IN_MEMORY = 5;
const FILES_KEPT = 20;
/** A temporary file this old is left over from a write that never finished. */
const STALE_TEMP_MS = 24 * 60 * 60 * 1000;

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
 * `<dataDir>/crawls/<id>.json`, and null for anything else. The crawl
 * directory is private to the user (0700, files 0600, older files included once
 * it is opened) and keeps the 20 newest files.
 *
 * @param {{dataDir?: string, fetch?: typeof safeFetch, extract?: Extractor, lookup?: Lookup,
 *          now?: () => Date, sleep?: (ms: number) => Promise<void>, idFactory?: () => string, maxStoredChars?: number}} [deps]
 */
export function createCrawlManager(deps = {}) {
  const { dataDir = defaultDataDir(), fetch = safeFetch, now = () => new Date(), sleep = realSleep, idFactory } = deps;
  const lookup = deps.lookup ?? /** @type {Lookup} */ ((hostname, options) => dns.promises.lookup(hostname, options));
  const crawlsDir = path.join(dataDir, 'crawls');

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

  /** Delete all but the newest `FILES_KEPT` crawl files, and temporary files older than a day. */
  const prune = async () => {
    const all = await readdir(crawlsDir);
    const cutoff = Date.now() - STALE_TEMP_MS;
    for (const name of all.filter((entry) => entry.endsWith('.tmp'))) {
      const file = path.join(crawlsDir, name);
      const info = await lstat(file).catch(() => null);
      if (info !== null && info.isFile() && info.mtimeMs < cutoff) await unlink(file).catch(() => {});
    }
    const names = all.filter((name) => name.endsWith('.json'));
    if (names.length <= FILES_KEPT) return;
    const dated = await Promise.all(names.map(async (name) => ({ name, mtime: (await stat(path.join(crawlsDir, name))).mtimeMs })));
    dated.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1));
    await Promise.all(dated.slice(FILES_KEPT).map(({ name }) => unlink(path.join(crawlsDir, name)).catch(() => {})));
  };

  /** @type {Promise<void>|null} */
  let opened = null;
  /**
   * Create the crawl directory if needed and make it and every regular file in it
   * private (0700 and 0600), whatever the file's name: older crawl files and
   * temporary files left by an interrupted write too. Symbolic links are left
   * alone. Once per manager.
   */
  const openDir = () => {
    opened ??= (async () => {
      await mkdir(crawlsDir, { recursive: true, mode: 0o700 });
      await chmod(crawlsDir, 0o700);
      for (const name of await readdir(crawlsDir)) {
        const file = path.join(crawlsDir, name);
        if ((await lstat(file)).isFile()) await chmod(file, 0o600);
      }
    })().catch((error) => {
      opened = null;
      throw error;
    });
    return opened;
  };

  /** @param {CrawlResult} result */
  const persist = async (result) => {
    await openDir();
    const file = path.join(crawlsDir, `${result.id}.json`);
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(result), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, file);
    await prune();
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
        await persist(result);
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
   * Check a local start, then create and run the job.
   * @param {ReturnType<typeof validateStart>} input
   * @returns {Promise<CrawlJob>}
   */
  const register = async (input) => {
    if (input.allowLoopback) await checkLocalStart(input.startUrl, lookup);
    const id = idFactory ? idFactory() : defaultId(now());
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error(`crawl id ${String(id)} is not a safe file name`);
    if (jobs.has(id)) throw new Error(`crawl id ${id} is already in use`);
    /** @type {CrawlJob} */
    const job = {
      id, status: 'running', start_url: input.startUrl, max_pages: input.maxPages, pages_crawled: 0, pages_queued: 0,
      truncated: false, blocked: null, error: null, started_at: now().toISOString(), finished_at: null,
    };
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
      if (running.length + starting.size >= MAX_RUNNING) {
        throw busy(`${MAX_RUNNING} crawls are running already, the most at once. Wait for one of them to finish with crawl_status.`);
      }
      // Held until the job is registered, so that calls arriving while this one awaits are counted too.
      starting.add(site);
      try {
        const job = await register(input);
        siteOf.set(job.id, site);
        return job;
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
      const cached = results.get(id);
      if (cached) return cached;
      try {
        await openDir();
        return JSON.parse(await readFile(path.join(crawlsDir, `${id}.json`), 'utf8'));
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') log.warn('could not read crawl result', { id, error: String(error) });
        return null;
      }
    },
  };
}
