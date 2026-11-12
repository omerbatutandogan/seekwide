import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { storeError } from './errors.js';

/** The most a stored file may hold. Larger files are refused before they are read. */
export const STORE_LIMITS = Object.freeze({
  runBytes: 20 * 1024 * 1024,
  indexBytes: 2 * 1024 * 1024,
  profileBytes: 1024 * 1024,
});

/**
 * @param {string} where  The folder or file, relative to the project folder.
 * @param {string} what   What it is instead of a plain folder or file.
 */
function unsafe(where, what) {
  return storeError(
    'UNSAFE_STORE',
    `${where} in the project folder is ${what}. Seekwide reads and writes only a real .seekwide folder inside the project, ` +
      'so it does not follow links that a repository can bring along. Remove it, or audit a copy of the project you trust.',
  );
}

/**
 * Throws `UNSAFE_STORE` when `dir` exists and is a symbolic link or not a
 * folder. A missing folder passes: the caller creates it.
 * @param {string} dir         Absolute path.
 * @param {string} projectDir  The project folder, to name `dir` relative to it.
 * @returns {Promise<boolean>} Whether the folder exists.
 */
export async function assertRealDir(dir, projectDir) {
  let stat;
  try {
    stat = await fs.lstat(dir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return false;
    throw error;
  }
  const where = path.relative(projectDir, dir);
  if (stat.isSymbolicLink()) throw unsafe(where, 'a symbolic link');
  if (!stat.isDirectory()) throw unsafe(where, 'not a folder');
  return true;
}

/**
 * Create each folder of `dirs` in order (each inside the one before), refusing
 * any that is a symbolic link or not a folder, before and after it is created.
 * @param {string[]} dirs      Absolute paths, outermost first.
 * @param {string} projectDir
 * @returns {Promise<void>}
 */
export async function makeRealDirs(dirs, projectDir) {
  for (const dir of dirs) {
    if (!(await assertRealDir(dir, projectDir))) {
      try {
        await fs.mkdir(dir);
      } catch (error) {
        if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') throw error;
      }
      await assertRealDir(dir, projectDir);
    }
  }
}

/**
 * The text of a stored file, read without following a symbolic link.
 *
 * Guarantees: a missing file throws the ENOENT error of `open`; a link, a
 * folder, a device or a pipe throws `UNSAFE_STORE`; a file larger than
 * `maxBytes` throws `STORE_FILE_TOO_LARGE`; nothing of such a file is read.
 * @param {string} file        Absolute path.
 * @param {number} maxBytes
 * @param {string} projectDir
 * @returns {Promise<string>}
 */
export async function readStoreFile(file, maxBytes, projectDir) {
  const where = path.relative(projectDir, file);
  let handle;
  try {
    // O_NONBLOCK keeps a named pipe from blocking the open. O_NOFOLLOW does not exist on Windows.
    handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ELOOP') throw unsafe(where, 'a symbolic link');
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw unsafe(where, 'not a regular file');
    if (stat.size > maxBytes) {
      throw storeError('STORE_FILE_TOO_LARGE', `${where} is ${Math.round(stat.size / 1024)} KB, more than the ${Math.round(maxBytes / 1024)} KB the plugin ever writes there, so it was not read.`);
    }
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

/**
 * Write a file so that readers see either the old content or the new content,
 * never a partial file: the data goes to a temporary file in the same
 * directory, which is then renamed over the target. The temporary file is
 * removed when anything fails.
 * @param {string} file Absolute path of the target.
 * @param {string} data
 * @returns {Promise<void>}
 */
export async function writeFileAtomic(file, data) {
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, data, { flag: 'wx' });
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Serialize JSON the way every file under `.seekwide/` is written: two-space
 * indentation and a trailing newline, so the files are pleasant to read and to diff.
 * @param {unknown} value
 * @returns {string}
 */
export function toJsonFile(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
