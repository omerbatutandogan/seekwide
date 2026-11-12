/** @import { Run, RunIndexEntry } from '../types.js' */

import { storeError } from './errors.js';
import { STORE_LIMITS, readStoreFile, writeFileAtomic } from './fs-util.js';
import { assertRunId, assertStoreDirs, ensureProject, ensureRunDir, projectPaths } from './project.js';
import { parseStoredRun, serializeRun } from './run-file.js';
import { entryFromRun, readIndex, serialize, writeIndex } from './run-index.js';
import { isRunShape } from './run-validate.js';

/**
 * Run id for an audit started at `date`: "2026-11-11T14-03-22Z", then
 * "2026-11-11T14-03-22Z-2", "-3" when that id is already taken.
 * @param {Date} date
 * @param {Iterable<string>} [existingIds]
 * @returns {string}
 */
export function newRunId(date, existingIds = []) {
  const year = date instanceof Date ? date.getUTCFullYear() : NaN;
  if (!(year >= 0 && year <= 9999)) throw new TypeError('newRunId needs a valid Date between the years 0 and 9999.');
  const base = `${date.toISOString().slice(0, 19).replace(/:/g, '-')}Z`;
  const taken = new Set(existingIds);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Store a run at `<projectDir>/.seekwide/runs/<run_id>/findings.json` and add it
 * at the end of the index. Both files are written atomically. A run is history,
 * so an id that is already in the index is refused with `RUN_EXISTS`; pick a new
 * one with `newRunId`.
 *
 * The run is checked with the rules `loadRun` applies before anything is
 * written (`serializeRun`): a run whose values do not have the stored form is
 * refused with `RUN_INVALID`, and one larger than `STORE_LIMITS.runBytes` with
 * `RUN_TOO_LARGE`. So every run this function saves can be loaded.
 * @param {string} projectDir
 * @param {Run} run
 * @returns {Promise<{runId: string, runDir: string, findingsFile: string, entry: RunIndexEntry}>}
 */
export async function saveRun(projectDir, run) {
  if (run !== null && typeof run === 'object') assertRunId(run.run_id);
  if (!isRunShape(run)) {
    throw new TypeError('saveRun needs a Run with a valid run_id, created_at, start_url, crawl, modules, checks and findings.');
  }
  const text = serializeRun(run);
  const paths = await ensureProject(projectDir);
  const runDir = paths.runDir(run.run_id);
  const findingsFile = paths.findingsFile(run.run_id);
  const entry = entryFromRun(run);

  await serialize(paths.index, async () => {
    const runs = await readIndex(paths);
    if (runs.some((existing) => existing.run_id === run.run_id)) {
      throw storeError('RUN_EXISTS', `Run ${run.run_id} is already stored. Runs are never overwritten; use a new run id.`);
    }
    await ensureRunDir(paths, run.run_id);
    await writeFileAtomic(findingsFile, text);
    await writeIndex(paths, [...runs, entry]);
  });
  return { runId: run.run_id, runDir, findingsFile, entry };
}

/**
 * @param {RunIndexEntry[]} runs
 * @returns {string}
 */
function describeKnown(runs) {
  if (runs.length === 0) return 'There are no runs yet; run an audit first.';
  const latest = runs.slice(-5).map((entry) => entry.run_id);
  return `Known runs: ${latest.join(', ')}${runs.length > latest.length ? ', ...' : ''}.`;
}

/**
 * Load a stored run by id, or by reference: 'last' is the newest run and
 * 'previous' the one before it. Throws `RUN_NOT_FOUND` when there is no such
 * run, `INVALID_RUN_ID` for an id that is not a safe file name, `UNSAFE_STORE`
 * when a folder or file on the way is a symbolic link, `STORE_FILE_TOO_LARGE`
 * for a file larger than `STORE_LIMITS.runBytes` (which `saveRun` never writes,
 * but version 0.1.0 could), and `RUN_CORRUPT` when the stored file is damaged
 * or a value the tools rely on does not have the form the plugin writes
 * (`parseStoredRun`). Runs in the stored form of any version are read.
 * @param {string} projectDir
 * @param {string} ref
 * @returns {Promise<Run>}
 */
export async function loadRun(projectDir, ref) {
  const paths = projectPaths(projectDir);
  let runId = ref;
  if (ref === 'last' || ref === 'previous') {
    const runs = await readIndex(paths);
    const entry = ref === 'last' ? runs.at(-1) : runs.at(-2);
    if (!entry) {
      const message =
        ref === 'last' || runs.length === 0
          ? `No audit runs found in ${paths.root}. Run an audit first.`
          : `There is only one run (${runs[0].run_id}), so there is no previous run.`;
      throw storeError('RUN_NOT_FOUND', message);
    }
    runId = entry.run_id;
  } else {
    assertRunId(ref);
  }

  await assertStoreDirs(paths, runId);
  let text;
  try {
    text = await readStoreFile(paths.findingsFile(runId), STORE_LIMITS.runBytes, paths.projectDir);
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'STORE_FILE_TOO_LARGE') {
      throw storeError(
        'STORE_FILE_TOO_LARGE',
        `Run ${runId} was not read: ${/** @type {Error} */ (error).message} This version of the plugin never saves a run that large; ` +
          'Seekwide 0.1.0 could, for a large site, and the file may also have been written by hand.',
      );
    }
    if (code !== 'ENOENT') throw error;
    throw storeError('RUN_NOT_FOUND', `Run ${runId} was not found in ${paths.root}. ${describeKnown(await readIndex(paths))}`);
  }
  const { run, problem } = parseStoredRun(text, runId);
  if (run === null) throw storeError('RUN_CORRUPT', `Run ${runId} is damaged: ${problem}. Run the audit again.`);
  return run;
}

/**
 * All stored runs, oldest first. An empty or missing project gives an empty list
 * and creates nothing.
 * @param {string} projectDir
 * @returns {Promise<RunIndexEntry[]>}
 */
export async function listRuns(projectDir) {
  return readIndex(projectPaths(projectDir));
}
