// Reading the export file the user names. It must be a regular file inside the
// project folder, reached without a symbolic link: the rules of a logo named by
// the project profile (tools/logo.js) and of source_dir (repo/scan.js). The
// path is checked before anything is touched, so a path such as
// \\host\share\export.zip on Windows never makes the system contact another machine.

import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { entryKind, isInside } from '../repo/scan.js';
import { ImportError } from './errors.js';

/** The largest export file Seekwide reads. A Search Console download of seven tables of 1,000 rows is about 100 KB. */
export const IMPORT_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Open the file `input` names for reading.
 *
 * Guarantees: the path, resolved against the project folder, lies inside it
 * (as written or after the project folder's own links are resolved); every step
 * of the way to the file is a real folder and the file a regular file, checked
 * without following a link, and the opened file is checked again; a file
 * larger than `maxBytes` is refused before it is read, and an empty one too.
 * The error messages name the path the caller passed, never the file's content.
 * The caller closes the handle.
 * @param {string} projectDir  Absolute path of the project folder.
 * @param {string} input       Absolute, or relative to the project folder.
 * @param {number} maxBytes
 * @param {string} [what]      What the file is, for the messages: "export file" by default.
 * @returns {Promise<{handle: import('node:fs/promises').FileHandle, size: number, relative: string, file: string}>}
 *   `relative` is the file's path inside the project, with forward slashes; `size` its size when it was opened.
 * @throws {ImportError}
 */
export async function openImportFile(projectDir, input, maxBytes, what = 'export file') {
  const advice = `Save the ${what} inside the project folder and pass its path, absolute or relative to the project folder.`;
  if (typeof input !== 'string' || input.trim() === '' || input.includes('\0')) {
    throw new ImportError('NOT_FOUND', `Name the ${what} to import. ${advice}`);
  }
  const lexicalProject = path.resolve(projectDir);
  const file = path.resolve(lexicalProject, input);
  const realProject = await fs.realpath(lexicalProject).catch(() => lexicalProject);
  const base = isInside(lexicalProject, file) ? lexicalProject : isInside(realProject, file) ? realProject : null;
  if (base === null) throw new ImportError('OUTSIDE_PROJECT', `The file ${file} is outside the project folder ${lexicalProject}. ${advice}`);
  if (file === base) throw new ImportError('NOT_A_FILE', `${file} is the project folder. Pass the path of the ${what} itself.`);
  const relative = path.relative(base, file).split(path.sep).join('/');
  // Both bases name the same folder; the walk starts at its real path and follows no link from there.
  const kind = await entryKind(realProject, relative);
  if (kind === null) {
    throw new ImportError('NOT_FOUND', `The file ${file} does not exist, is not a regular file, or a symbolic link is on the way to it. ${advice}`);
  }
  if (kind !== 'file') throw new ImportError('NOT_A_FILE', `${file} is a folder. Pass the path of the ${what} itself.`);

  let handle;
  try {
    // O_NOFOLLOW refuses a link at the last step; O_NONBLOCK keeps a named pipe from blocking. Neither exists on Windows.
    handle = await fs.open(path.join(realProject, ...relative.split('/')), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch {
    throw new ImportError('NOT_FOUND', `The file ${file} could not be opened. ${advice}`);
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new ImportError('NOT_A_FILE', `${file} is not a regular file. Pass the path of the ${what} itself.`);
    if (stat.size > maxBytes) {
      const megabytes = (/** @type {number} */ bytes) => `${Math.ceil(bytes / 1048576).toLocaleString('en-US')} MB`;
      throw new ImportError('TOO_LARGE', what === 'export file'
        ? `The file is ${megabytes(stat.size)}; Seekwide imports files of at most ${megabytes(maxBytes)}. An export of a report is far smaller; check that this is the export file.`
        : `The file is ${megabytes(stat.size)}; Seekwide imports a ${what} of at most ${megabytes(maxBytes)}. Split it, or import the files of fewer days.`);
    }
    if (stat.size === 0) throw new ImportError('EMPTY', `The file ${file} is empty.${what === 'export file' ? ' Download the export again.' : ''}`);
    return { handle, size: stat.size, relative, file };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/**
 * Read the file `input` names, as bytes, with the guarantees of `openImportFile`.
 * @param {string} projectDir  Absolute path of the project folder.
 * @param {string} input       Absolute, or relative to the project folder.
 * @param {number} [maxBytes]
 * @returns {Promise<{bytes: Buffer, relative: string}>} `relative` is the file's path inside the project, with forward slashes.
 * @throws {ImportError}
 */
export async function readImportFile(projectDir, input, maxBytes = IMPORT_MAX_BYTES) {
  const { handle, size, relative, file } = await openImportFile(projectDir, input, maxBytes);
  try {
    // Read at most the size seen when it was opened, so a file that grows meanwhile cannot pass the limit.
    const buffer = Buffer.alloc(size);
    let filled = 0;
    while (filled < size) {
      const { bytesRead } = await handle.read(buffer, filled, size - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    if (filled === 0) throw new ImportError('EMPTY', `The file ${file} is empty. Download the export again.`);
    return { bytes: buffer.subarray(0, filled), relative };
  } finally {
    await handle.close();
  }
}
