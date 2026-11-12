// Reading a project folder safely. Everything repo mode knows about a project
// comes through this file: names of files, and the text of a few of them.
// Nothing in the project is ever imported, required or executed.

import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { stripHidden } from '../util/strings.js';

export const SCAN_LIMITS = Object.freeze({
  /** Files listed per scan. A larger tree is cut and reported as truncated. */
  maxFiles: 20_000,
  /** Folders entered per scan, so a tree of empty folders ends too. */
  maxDirs: 20_000,
  maxDepth: 24,
  /** Largest file whose text is read (the crawler's own body limit). */
  maxFileBytes: 5 * 1024 * 1024,
  maxPackageJsonBytes: 1024 * 1024,
});

/** An error the user can act on: a folder that does not exist or lies outside the project. */
export class RepoError extends Error {}

/**
 * A directory that holds dependencies, build output or tool state, never
 * source: `node_modules` and every name that starts with a dot.
 * @param {string} name
 * @returns {boolean}
 */
function isSkippedDir(name) {
  return name === 'node_modules' || name.startsWith('.');
}

/**
 * @param {string} dir
 * @returns {Promise<string>}
 */
async function realDirectory(dir) {
  let real;
  try {
    real = await fs.realpath(dir);
    if (!(await fs.stat(real)).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new RepoError(`The folder ${dir} does not exist or is not a directory.`);
  }
  return real;
}

/**
 * True when `child` is `parent` or lies inside it. Both must be absolute.
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
export function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * The real paths of the project folder and of the folder that holds the web
 * project's source. Guarantees that the source folder is the project folder or
 * lies inside it after every symbolic link is resolved, so a link cannot move
 * the boundary.
 * @param {string} projectDir  Absolute path.
 * @param {string} [sourceDir] Absolute path; defaults to the project folder.
 * @returns {Promise<{projectDir: string, sourceDir: string, relative: string}>}
 *   `relative` is the source folder as seen from the project folder, with forward slashes ('' when they are the same).
 * @throws {RepoError}
 */
export async function resolveSourceDir(projectDir, sourceDir = projectDir) {
  for (const dir of [projectDir, sourceDir]) {
    if (typeof dir !== 'string' || dir === '' || dir.includes('\0') || !path.isAbsolute(dir)) {
      throw new RepoError('The project folder and source_dir must be absolute paths.');
    }
  }
  const realProject = await realDirectory(projectDir);
  const realSource = await realDirectory(sourceDir);
  if (!isInside(realProject, realSource)) {
    throw new RepoError(`source_dir must be the project folder (${projectDir}) or a folder inside it.`);
  }
  return { projectDir: realProject, sourceDir: realSource, relative: path.relative(realProject, realSource).split(path.sep).join('/') };
}

/**
 * What `relative` is inside `root`, without following a symbolic link at any
 * step: 'file', 'dir', or null when it does not exist, is something else, or
 * a link is in the way.
 * @param {string} root      Absolute real path.
 * @param {string} relative  Forward-slash path of plain names.
 * @returns {Promise<'file'|'dir'|null>}
 */
export async function entryKind(root, relative) {
  const names = relative.split('/');
  let current = root;
  for (const [index, name] of names.entries()) {
    if (name === '' || name === '.' || name === '..' || name.includes('\\') || name.includes('\0')) return null;
    current = path.join(current, name);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch {
      return null;
    }
    const last = index === names.length - 1;
    if (stat.isDirectory()) {
      if (last) return 'dir';
    } else {
      return last && stat.isFile() ? 'file' : null;
    }
  }
  return null;
}

/**
 * List the regular files under `<root>/<sub>`, as forward-slash paths relative
 * to `root`, sorted. Symbolic links are never followed or listed, and
 * `node_modules` and dot folders are not entered. The listing stops at
 * `SCAN_LIMITS.maxFiles` files, `SCAN_LIMITS.maxDirs` folders and `SCAN_LIMITS.maxDepth` levels and then says
 * so with `truncated`.
 * @param {string} root   Absolute real path of the source folder.
 * @param {string} [sub]  Folder inside it to list; '' lists the root.
 * @param {{maxFiles?: number, maxDepth?: number, maxDirs?: number}} [limits]
 * @returns {Promise<{files: string[], truncated: boolean}>}
 */
export async function listFiles(root, sub = '', limits = {}) {
  const maxFiles = limits.maxFiles ?? SCAN_LIMITS.maxFiles;
  const maxDepth = limits.maxDepth ?? SCAN_LIMITS.maxDepth;
  const maxDirs = limits.maxDirs ?? SCAN_LIMITS.maxDirs;
  let entered = 0;
  /** @type {string[]} */
  const files = [];
  let truncated = false;
  if (sub !== '' && (await entryKind(root, sub)) !== 'dir') return { files, truncated };

  /** @type {{relative: string, depth: number}[]} */
  const queue = [{ relative: sub, depth: 0 }];
  while (queue.length > 0 && !truncated) {
    const { relative, depth } = /** @type {{relative: string, depth: number}} */ (queue.shift());
    if (entered >= maxDirs) {
      truncated = true;
      break;
    }
    entered += 1;
    let entries;
    try {
      entries = await fs.readdir(path.join(root, ...relative.split('/').filter(Boolean)), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      // A name with a line break, a control or a direction character is not a page a server answers for,
      // and could make a file listing read differently from what it is: it is left out.
      if (stripHidden(entry.name) !== entry.name || /[\r\n\t]/.test(entry.name)) continue;
      if (entry.isDirectory()) {
        if (isSkippedDir(entry.name)) continue;
        if (depth + 1 > maxDepth) truncated = true;
        else queue.push({ relative: child, depth: depth + 1 });
      } else if (entry.isFile()) {
        if (files.length >= maxFiles) {
          truncated = true;
          break;
        }
        files.push(child);
      }
    }
  }
  files.sort();
  return { files, truncated };
}

/**
 * The bytes of a regular file inside `root`, or null when it is missing, is
 * not a regular file, is larger than `maxBytes`, or a symbolic link is on the
 * way to it. The file is opened without following a link, and what was opened
 * is checked again, so a file swapped for a link in between is not read.
 * @param {string} root      Absolute real path.
 * @param {string} relative  Forward-slash path of plain names.
 * @param {number} [maxBytes]
 * @returns {Promise<Buffer|null>}
 */
export async function readFileInside(root, relative, maxBytes = SCAN_LIMITS.maxFileBytes) {
  if ((await entryKind(root, relative)) !== 'file') return null;
  let handle;
  try {
    // O_NOFOLLOW does not exist on Windows; the checks before and after still apply there.
    handle = await fs.open(path.join(root, ...relative.split('/')), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maxBytes) return null;
    const buffer = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return buffer.subarray(0, offset);
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}
