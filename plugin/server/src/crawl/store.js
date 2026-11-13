// The crawl files on disk (ARCHITECTURE.md 4.5, step 12): `<id>.json` holds a
// crawl result, and `<id>.vitals.json` next to it the Core Web Vitals measured
// for that crawl, so that every audit of one crawl rates the same numbers.

import { randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { log } from '../log.js';

/** @import { CrawlResult, VitalsData } from '../types.js' */

/** Crawl files kept in one data folder; older ones are deleted. */
export const FILES_KEPT = 20;
/** The ids of deleted crawls, one per line, so that a request for one can say it was deleted rather than unknown. */
const PRUNED_FILE = 'pruned-ids.txt';
/** Most deleted ids remembered; the oldest are forgotten first. */
const PRUNED_KEPT = 1000;
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
/** A temporary file this old is left over from a write that never finished. */
const STALE_TEMP_MS = 24 * 60 * 60 * 1000;
const VITALS_SUFFIX = '.vitals.json';
const VITALS_SCHEMA = 1;
/** A measurement of ten pages is a few kilobytes; a larger file is not one this plugin wrote. */
const MAX_VITALS_BYTES = 1024 * 1024;

/**
 * @typedef {Object} StoredVitals
 * @property {VitalsData} vitals
 * @property {string} measured_at  ISO 8601: when Google was asked.
 */

/** @param {unknown} value @returns {value is Record<string, any>} */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * True when a value has the shape of a measurement this plugin stores. The
 * values inside are not trusted further: the checks and the report read
 * numbers as numbers and treat anything else as missing.
 * @param {unknown} value
 * @returns {value is VitalsData}
 */
function isVitalsData(value) {
  return isObject(value)
    && isObject(value.lab) && typeof value.lab.available === 'boolean' && value.lab.device === 'mobile'
    && isObject(value.field) && typeof value.field.available === 'boolean' && value.field.form_factor === 'phone'
    && isObject(value.origin) && typeof value.origin.origin === 'string'
    && Array.isArray(value.pages) && value.pages.every((page) => isObject(page) && typeof page.url === 'string')
    && Array.isArray(value.notes) && value.notes.every((note) => typeof note === 'string');
}

/**
 * The crawl files of one data folder.
 *
 * Guarantees: the folder is private to the user (0700, every regular file in
 * it 0600, files written by an older version included, once per store); every
 * file is written whole or not at all (a temporary file of its own for each
 * write, then a rename); the measurements of one crawl are saved one after the
 * other inside this store, so two audits that finish together both keep
 * theirs (there is no lock across processes); only
 * the 20 newest crawl files are kept, each with its measurement file, and a
 * measurement file whose crawl file is gone is deleted with them; the ids of
 * deleted crawls are remembered (the newest 1000, in `pruned-ids.txt`), so
 * `wasPruned` can tell a deleted crawl from one that never existed; a temporary
 * file is deleted once it is a day old. `id` must already be a safe file name.
 *
 * @param {string} crawlsDir
 */
export function createCrawlStore(crawlsDir) {
  /** @type {Promise<void>|null} */
  let opened = null;
  /**
   * Create the crawl directory if needed and make it and every regular file in it
   * private (0700 and 0600), whatever the file's name: older crawl files and
   * temporary files left by an interrupted write too. Symbolic links are left
   * alone. Once per store.
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

  /** @returns {Promise<string[]>} The remembered ids of deleted crawls, oldest first. */
  const readPruned = async () => {
    try {
      const text = await readFile(path.join(crawlsDir, PRUNED_FILE), 'utf8');
      return text.split('\n').filter((line) => SAFE_ID.test(line)).slice(-PRUNED_KEPT);
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') log.warn('could not read the ids of deleted crawls', { error: String(error) });
      return [];
    }
  };
  /** The last write of the deleted ids, so writes of this store follow one another. @type {Promise<void>} */
  let prunedWrite = Promise.resolve();
  /** @param {string[]} ids Crawls just deleted. */
  const rememberPruned = (ids) => {
    prunedWrite = prunedWrite.catch(() => {}).then(async () => {
      const known = (await readPruned()).filter((id) => !ids.includes(id));
      await writeWhole(path.join(crawlsDir, PRUNED_FILE), `${[...known, ...ids].slice(-PRUNED_KEPT).join('\n')}\n`);
    });
    return prunedWrite;
  };

  /** Delete all but the newest `FILES_KEPT` crawl files with their measurements, and temporary files older than a day. */
  const prune = async () => {
    const all = await readdir(crawlsDir);
    const cutoff = Date.now() - STALE_TEMP_MS;
    for (const name of all.filter((entry) => entry.endsWith('.tmp'))) {
      const file = path.join(crawlsDir, name);
      const info = await lstat(file).catch(() => null);
      if (info !== null && info.isFile() && info.mtimeMs < cutoff) await unlink(file).catch(() => {});
    }
    const names = all.filter((name) => name.endsWith('.json') && !name.endsWith(VITALS_SUFFIX));
    /** @type {Set<string>} */
    let kept = new Set(names);
    if (names.length > FILES_KEPT) {
      const dated = await Promise.all(names.map(async (name) => ({ name, mtime: (await stat(path.join(crawlsDir, name))).mtimeMs })));
      dated.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1));
      const removed = await Promise.all(dated.slice(FILES_KEPT).map(({ name }) => unlink(path.join(crawlsDir, name)).then(() => name, () => null)));
      kept = new Set(dated.slice(0, FILES_KEPT).map(({ name }) => name));
      const ids = removed.filter((name) => name !== null).map((name) => /** @type {string} */ (name).slice(0, -'.json'.length));
      if (ids.length > 0) await rememberPruned(ids);
    }
    const orphans = all.filter((name) => name.endsWith(VITALS_SUFFIX) && !kept.has(`${name.slice(0, -VITALS_SUFFIX.length)}.json`));
    await Promise.all(orphans.map((name) => unlink(path.join(crawlsDir, name)).catch(() => {})));
  };

  /** @param {string} file @param {string} text */
  const writeWhole = async (file, text) => {
    await openDir();
    const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temp, text, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, file);
  };

  /** @param {string} id */
  const vitalsFile = (id) => path.join(crawlsDir, `${id}${VITALS_SUFFIX}`);
  /** The last write of each crawl's measurement file, so the next one reads what it wrote. @type {Map<string, Promise<void>>} */
  const vitalsWrites = new Map();

  /** @param {string} id @returns {Promise<Record<string, unknown>>} The measurements by page count, or an empty object. */
  const readVitals = async (id) => {
    try {
      await openDir();
      const file = vitalsFile(id);
      const info = await lstat(file);
      if (!info.isFile() || info.size > MAX_VITALS_BYTES) return {};
      const stored = JSON.parse(await readFile(file, 'utf8'));
      return isObject(stored) && stored.schema_version === VITALS_SCHEMA && stored.crawl_id === id && isObject(stored.measurements) ? stored.measurements : {};
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') log.warn('could not read stored core web vitals', { id, error: String(error) });
      return {};
    }
  };

  return {
    /** Write a crawl result and prune the folder. @param {CrawlResult} result */
    async save(result) {
      await writeWhole(path.join(crawlsDir, `${result.id}.json`), JSON.stringify(result));
      await prune();
    },

    /** True when the crawl was deleted to keep the newest `FILES_KEPT`. @param {string} id @returns {Promise<boolean>} */
    async wasPruned(id) {
      await openDir();
      await prunedWrite.catch(() => {});
      return (await readPruned()).includes(id);
    },

    /** A stored crawl result, or null when there is none or it cannot be read. @param {string} id @returns {Promise<CrawlResult|null>} */
    async load(id) {
      try {
        await openDir();
        return JSON.parse(await readFile(path.join(crawlsDir, `${id}.json`), 'utf8'));
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') log.warn('could not read crawl result', { id, error: String(error) });
        return null;
      }
    },

    /**
     * The measurement stored for a crawl and a page count, or null.
     * @param {string} id @param {number} pages @returns {Promise<StoredVitals|null>}
     */
    async loadVitals(id, pages) {
      const entry = (await readVitals(id))[String(pages)];
      if (!isObject(entry) || typeof entry.measured_at !== 'string' || Number.isNaN(Date.parse(entry.measured_at)) || !isVitalsData(entry.vitals)) return null;
      return { vitals: entry.vitals, measured_at: entry.measured_at };
    },

    /**
     * Keep a measurement with its crawl, beside those of other page counts.
     * @param {string} id @param {number} pages @param {StoredVitals} measurement
     */
    async saveVitals(id, pages, measurement) {
      const write = (vitalsWrites.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
        const measurements = { ...(await readVitals(id)), [String(pages)]: measurement };
        await writeWhole(vitalsFile(id), JSON.stringify({ schema_version: VITALS_SCHEMA, crawl_id: id, measurements }));
      });
      vitalsWrites.set(id, write);
      try {
        await write;
      } finally {
        if (vitalsWrites.get(id) === write) vitalsWrites.delete(id);
      }
    },
  };
}
