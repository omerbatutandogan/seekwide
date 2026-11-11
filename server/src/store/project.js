import fs from 'node:fs/promises';
import path from 'node:path';
import { clip } from '../util/strings.js';
import { storeError } from './errors.js';

/** Run ids become directory names, so they are restricted to this alphabet. */
export const RUN_ID_PATTERN = /^[0-9A-Za-z._-]+$/;

const MAX_RUN_ID_LENGTH = 128;
// "index.json" would collide with the index file; "last" and "previous" are references, not ids.
const RESERVED_RUN_IDS = new Set(['index.json', 'last', 'previous']);

/**
 * @typedef {Object} ProjectPaths
 * @property {string} projectDir   The absolute, normalized project directory.
 * @property {string} root         `<projectDir>/.seekwide`
 * @property {string} gitignore
 * @property {string} profile
 * @property {string} runsDir
 * @property {string} index        `runs/index.json`
 * @property {(runId: string) => string} runDir
 * @property {(runId: string) => string} findingsFile
 * @property {(runId: string, format: 'md'|'html') => string} reportFile
 */

/**
 * @param {unknown} id
 * @returns {id is string}
 */
export function isValidRunId(id) {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= MAX_RUN_ID_LENGTH &&
    RUN_ID_PATTERN.test(id) &&
    !id.startsWith('.') &&
    !RESERVED_RUN_IDS.has(id)
  );
}

/**
 * Throws `INVALID_RUN_ID` unless `id` is safe to use as a directory name.
 * Rejects path separators, "." and "..", names that start with a dot, and
 * names the store reserves for itself.
 * @param {unknown} id
 * @returns {asserts id is string}
 */
export function assertRunId(id) {
  if (isValidRunId(id)) return;
  throw storeError(
    'INVALID_RUN_ID',
    `Invalid run id ${JSON.stringify(clip(String(id), 60))}. A run id has at most ${MAX_RUN_ID_LENGTH} letters, digits, ".", "_" or "-", and does not start with a dot. Use an id from runs_list, or "last" or "previous".`,
  );
}

/**
 * @param {unknown} projectDir
 * @returns {string}
 */
function resolveProjectDir(projectDir) {
  if (typeof projectDir !== 'string' || projectDir === '' || projectDir.includes('\0') || !path.isAbsolute(projectDir)) {
    throw storeError(
      'INVALID_PROJECT_DIR',
      `project_dir must be an absolute path (got ${JSON.stringify(clip(String(projectDir), 80))}). Pass the full path of the project folder.`,
    );
  }
  return path.resolve(projectDir);
}

/**
 * Every path the store uses for one project. Pure: nothing is created or read.
 * Throws `INVALID_PROJECT_DIR` unless `projectDir` is an absolute path, and the
 * run-specific builders throw `INVALID_RUN_ID` for ids that are not safe file names.
 * @param {string} projectDir
 * @returns {ProjectPaths}
 */
export function projectPaths(projectDir) {
  const dir = resolveProjectDir(projectDir);
  const root = path.join(dir, '.seekwide');
  const runsDir = path.join(root, 'runs');
  /** @param {string} runId */
  const runDir = (runId) => {
    assertRunId(runId);
    return path.join(runsDir, runId);
  };
  return {
    projectDir: dir,
    root,
    gitignore: path.join(root, '.gitignore'),
    profile: path.join(root, 'profile.json'),
    runsDir,
    index: path.join(runsDir, 'index.json'),
    runDir,
    findingsFile: (runId) => path.join(runDir(runId), 'findings.json'),
    reportFile: (runId, format) => {
      if (format !== 'md' && format !== 'html') throw new TypeError(`Unknown report format ${JSON.stringify(format)}; use "md" or "html".`);
      return path.join(runDir(runId), `report.${format}`);
    },
  };
}

/**
 * Create `<projectDir>/.seekwide/` and its `runs/` folder when missing, and a
 * `.gitignore` containing `*` so audit output is not committed by accident. An
 * existing `.gitignore` is never touched. The project directory itself must
 * already exist, so a mistyped path fails instead of creating a new folder tree.
 * @param {string} projectDir
 * @returns {Promise<ProjectPaths>}
 */
export async function ensureProject(projectDir) {
  const paths = projectPaths(projectDir);
  let stat;
  try {
    stat = await fs.stat(paths.projectDir);
  } catch {
    stat = null;
  }
  if (!stat?.isDirectory()) {
    throw storeError('PROJECT_DIR_NOT_FOUND', `The project folder ${paths.projectDir} does not exist. Check the path or create the folder first.`);
  }
  await fs.mkdir(paths.runsDir, { recursive: true });
  try {
    await fs.writeFile(paths.gitignore, '*\n', { flag: 'wx' });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
  }
  return paths;
}
