import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';

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
