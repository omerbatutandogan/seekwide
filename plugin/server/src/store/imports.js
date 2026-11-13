// Imported search data under `.seekwide/imports/`: one file per source, which
// the next import from that source replaces. The file names are fixed, so
// nothing from an export or an argument becomes part of a path.

/** @import { ImportSource, SearchImport } from '../imports/parse.js' */

import path from 'node:path';
import { IMPORT_SOURCES } from '../imports/parse.js';
import { storeError } from './errors.js';
import { assertRealDir, makeRealDirs, readStoreFile, writeFileAtomic } from './fs-util.js';
import { importProblem } from './import-validate.js';
import { ensureProject, projectPaths } from './project.js';

/** The largest import file the plugin writes or reads: 50,000 pages and dates at most. */
export const IMPORT_STORE_BYTES = 20 * 1024 * 1024;

/**
 * @param {string} projectDir
 * @param {ImportSource} source
 * @returns {{dir: string, file: string, relative: string, paths: ReturnType<typeof projectPaths>}}
 */
function importPaths(projectDir, source) {
  if (!IMPORT_SOURCES.includes(source)) throw new TypeError(`Unknown import source ${JSON.stringify(source)}.`);
  const paths = projectPaths(projectDir);
  const dir = path.join(paths.root, 'imports');
  return { dir, file: path.join(dir, `${source}.json`), relative: `.seekwide/imports/${source}.json`, paths };
}

/**
 * @param {string} relative
 * @param {string} problem
 */
function corrupt(relative, problem) {
  return storeError('IMPORT_CORRUPT', `The imported search data in ${relative} is damaged or was not written by Seekwide: ${problem}.`);
}

/**
 * Store an import, replacing the one from the same source.
 *
 * Guarantees: the record is checked with the rules `loadSearchImport` applies,
 * and its stored form against `IMPORT_STORE_BYTES`, before anything is written
 * (`IMPORT_INVALID`, `IMPORT_TOO_LARGE`); `.seekwide` and `imports` must be real
 * folders (`UNSAFE_STORE`); the file is replaced atomically.
 * @param {string} projectDir
 * @param {SearchImport} record
 * @returns {Promise<{file: string, relative: string}>}
 */
export async function saveSearchImport(projectDir, record) {
  const { dir, file, relative, paths } = importPaths(projectDir, record.source);
  const problem = importProblem(record, record.source);
  if (problem !== null) throw storeError('IMPORT_INVALID', `The import could not be saved: ${problem}.`);
  const text = `${JSON.stringify(record)}\n`;
  if (Buffer.byteLength(text, 'utf8') > IMPORT_STORE_BYTES) {
    throw storeError('IMPORT_TOO_LARGE', `The import would take more than ${IMPORT_STORE_BYTES / 1048576} MB, the most Seekwide stores.`);
  }
  await ensureProject(projectDir);
  await makeRealDirs([paths.root, dir], paths.projectDir);
  await writeFileAtomic(file, text);
  return { file, relative };
}

/**
 * The stored import from one source, or null when there is none.
 *
 * Guarantees: `.seekwide` and `imports` must be real folders and the file a
 * regular file of at most `IMPORT_STORE_BYTES`, read without following a link
 * (`UNSAFE_STORE`, `STORE_FILE_TOO_LARGE`); a file that is not JSON or does not
 * have the form the plugin writes is refused with `IMPORT_CORRUPT`, which names
 * the field and never its value.
 * @param {string} projectDir
 * @param {ImportSource} source
 * @returns {Promise<SearchImport|null>}
 */
export async function loadSearchImport(projectDir, source) {
  const { dir, file, relative, paths } = importPaths(projectDir, source);
  if (!(await assertRealDir(paths.root, paths.projectDir)) || !(await assertRealDir(dir, paths.projectDir))) return null;
  let text;
  try {
    text = await readStoreFile(file, IMPORT_STORE_BYTES, paths.projectDir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw corrupt(relative, 'it is not JSON');
  }
  const problem = importProblem(value, source);
  if (problem !== null) throw corrupt(relative, problem);
  return /** @type {SearchImport} */ (value);
}
