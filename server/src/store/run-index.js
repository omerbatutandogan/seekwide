/** @import { Run, RunIndexEntry } from '../types.js' */

import fs from 'node:fs/promises';
import { SCHEMA_VERSION } from '../config.js';
import { STORE_LIMITS, readStoreFile, writeFileAtomic, toJsonFile } from './fs-util.js';
import { assertStoreDirs, isValidRunId } from './project.js';
import { isStoredEntry, storedRunProblem } from './run-validate.js';

/** A damaged index is rebuilt from at most this many run folders, the newest by name. */
const MAX_REBUILD_RUNS = 1000;

/**
 * Minimal shape every stored run must have for the store and the reports to work with it.
 * @param {unknown} value
 * @returns {value is Run}
 */
export function isRunShape(value) {
  const run = /** @type {Record<string, unknown>|null} */ (value);
  return (
    run !== null &&
    typeof run === 'object' &&
    isValidRunId(run.run_id) &&
    typeof run.created_at === 'string' &&
    typeof run.start_url === 'string' &&
    Array.isArray(run.findings) &&
    Array.isArray(run.checks) &&
    run.modules !== null &&
    typeof run.modules === 'object' &&
    !Array.isArray(run.modules) &&
    run.crawl !== null &&
    typeof run.crawl === 'object'
  );
}

/**
 * @param {Run} run
 * @returns {RunIndexEntry}
 */
export function entryFromRun(run) {
  /** @type {Record<string, number|null>} */
  const scores = {};
  /** @type {Record<string, {passed: number, of: number}>} */
  const counts = {};
  for (const name of Object.keys(run.modules).sort()) {
    const score = run.modules[name]?.score;
    scores[name] = typeof score === 'number' ? score : null;
    const count = run.modules[name]?.count;
    if (count) counts[name] = { passed: count.passed, of: count.of };
  }
  return {
    run_id: run.run_id, created_at: run.created_at, start_url: run.start_url, scores,
    ...(Object.keys(counts).length > 0 ? { counts } : {}), findings: run.findings.length,
  };
}

/**
 * Oldest first; ties broken by run id so the order never depends on insertion order.
 * @param {RunIndexEntry[]} entries
 * @returns {RunIndexEntry[]}
 */
export function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const byTime = (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0);
    if (byTime !== 0) return byTime;
    if (a.run_id === b.run_id) return 0;
    return a.run_id < b.run_id ? -1 : 1;
  });
}

/**
 * @param {unknown} value
 * @returns {value is RunIndexEntry}
 */
function isEntry(value) {
  const entry = /** @type {Record<string, unknown>|null} */ (value);
  return (
    entry !== null &&
    typeof entry === 'object' &&
    isValidRunId(entry.run_id) &&
    typeof entry.created_at === 'string' &&
    typeof entry.start_url === 'string' &&
    typeof entry.findings === 'number' &&
    entry.scores !== null &&
    typeof entry.scores === 'object' &&
    isStoredEntry(entry)
  );
}

/**
 * Rebuild the index from the run folders. Used when `index.json` is missing or
 * damaged; run folders that cannot be read, or whose run is damaged, are left
 * out, and only the newest `MAX_REBUILD_RUNS` folders by name are read.
 * @param {import('./project.js').ProjectPaths} paths
 * @returns {Promise<RunIndexEntry[]>}
 */
async function rebuildIndex(paths) {
  let dirents;
  try {
    dirents = await fs.readdir(paths.runsDir, { withFileTypes: true });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
    throw error;
  }
  /** @type {RunIndexEntry[]} */
  const entries = [];
  const names = dirents.filter((dirent) => dirent.isDirectory() && isValidRunId(dirent.name)).map((dirent) => dirent.name).sort().slice(-MAX_REBUILD_RUNS);
  for (const name of names) {
    try {
      const run = JSON.parse(await readStoreFile(paths.findingsFile(name), STORE_LIMITS.runBytes, paths.projectDir));
      if (isRunShape(run) && run.run_id === name && storedRunProblem(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (run))) === null) {
        entries.push(entryFromRun(run));
      }
    } catch {
      // A run folder without a readable findings.json is not a run.
    }
  }
  return sortEntries(entries);
}

/**
 * Read the run index, oldest run first. A missing, damaged or oversized index
 * is rebuilt from the run folders in memory; nothing is written. An entry
 * dated in the future counts as damage (`isStoredEntry`), so a hand-edited
 * index cannot make its own run the newest for good. Throws `UNSAFE_STORE`
 * when `.seekwide`, `runs` or the index is a symbolic link.
 * @param {import('./project.js').ProjectPaths} paths
 * @returns {Promise<RunIndexEntry[]>}
 */
export async function readIndex(paths) {
  await assertStoreDirs(paths);
  let text;
  try {
    text = await readStoreFile(paths.index, STORE_LIMITS.indexBytes, paths.projectDir);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'ENOENT' || code === 'STORE_FILE_TOO_LARGE') return rebuildIndex(paths);
    throw error;
  }
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed?.runs) && parsed.runs.every(isEntry)) return sortEntries(parsed.runs);
  } catch {
    // Damaged JSON falls through to a rebuild.
  }
  return rebuildIndex(paths);
}

/**
 * @param {import('./project.js').ProjectPaths} paths
 * @param {RunIndexEntry[]} entries
 * @returns {Promise<void>}
 */
export async function writeIndex(paths, entries) {
  await writeFileAtomic(paths.index, toJsonFile({ schema_version: SCHEMA_VERSION, runs: sortEntries(entries) }));
}

/** @type {Map<string, Promise<unknown>>} */
const queues = new Map();

/**
 * Run `task` after every earlier task for the same key has finished, so two
 * saves in one process cannot overwrite each other's index update.
 * @template T
 * @param {string} key
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export function serialize(key, task) {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(task, task);
  const tail = result.catch(() => {});
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return result;
}
