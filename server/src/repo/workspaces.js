// Monorepos: the folders the root of a monorepo names as its workspaces (the
// `workspaces` field of package.json or pnpm-workspace.yaml, both read as data;
// only plain folder names and a final `*` are expanded), and the folders where
// a web project in one of them keeps its lock file and dependencies.

import path from 'node:path';
import { entryKind, isInside, listDirs, readFileInside } from './scan.js';

/** Workspace folders looked at, at most: each is classified like a project of its own. */
export const MAX_WORKSPACE_FOLDERS = 50;
const MAX_PATTERNS = 50;
const MAX_PNPM_YAML_BYTES = 64 * 1024;
/** One folder name of a pattern: no glob character, no separator, not a dot folder (nor `.` or `..`). */
const PLAIN_NAME = /^(?!\.)[A-Za-z0-9@._+-]+$/;

/**
 * `text` without the `/` characters at its end. A loop, not a pattern: a
 * pattern such as /\/+$/ takes quadratic time on a long run of slashes.
 * @param {string} text
 * @returns {string}
 */
function trimSlashes(text) {
  let end = text.length;
  while (end > 0 && text[end - 1] === '/') end -= 1;
  return text.slice(0, end);
}

/**
 * A pattern as a folder and whether it names every folder inside it, or null
 * for a form that is not expanded (`**`, `{a,b}`, `!negation`, `..`, an
 * absolute path).
 * @param {string} raw
 * @returns {{base: string, star: boolean}|null}
 */
function parsePattern(raw) {
  let pattern = raw.trim();
  if (pattern.startsWith('./')) pattern = pattern.slice(2);
  pattern = trimSlashes(pattern);
  if (pattern === '*') return { base: '', star: true };
  const star = pattern.endsWith('/*');
  const base = star ? pattern.slice(0, -2) : pattern;
  // node_modules is never read, as in listFiles; a pattern that names it, or a folder inside it, is not expanded.
  return base !== '' && base.split('/').every((name) => PLAIN_NAME.test(name) && name !== 'node_modules') ? { base, star } : null;
}

/**
 * The `packages` list of a pnpm-workspace.yaml, read line by line: a block
 * list or a one-line flow list of strings. Anything else is ignored.
 * @param {string} text
 * @returns {string[]}
 */
function pnpmPatterns(text) {
  /** @type {string[]} */
  const patterns = [];
  // Plain string operations only: no pattern here can backtrack on a long line.
  const withoutComment = (/** @type {string} */ value) => {
    const hash = value.search(/\s#/);
    return (hash === -1 ? value : value.slice(0, hash)).trim();
  };
  const unquote = (/** @type {string} */ value) => {
    const trimmed = value.trim();
    const quote = trimmed[0];
    return (quote === '"' || quote === "'") && trimmed.length >= 2 && trimmed.endsWith(quote) ? trimmed.slice(1, -1) : trimmed;
  };
  let inList = false;
  for (const line of text.split('\n')) {
    const content = withoutComment(line.startsWith('#') ? '' : line);
    // Only the top-level key: a `packages:` indented under another key is something else.
    if (!/^\s/.test(line) && content.startsWith('packages') && content.slice('packages'.length).trimStart().startsWith(':')) {
      const rest = content.slice(content.indexOf(':') + 1).trim();
      if (rest.startsWith('[') && rest.endsWith(']')) return rest.slice(1, -1).split(',').map(unquote).filter((value) => value !== '');
      inList = rest === '';
      continue;
    }
    if (!inList || content === '') continue;
    if (content.startsWith('- ')) patterns.push(unquote(content.slice(2)));
    else if (!/^\s/.test(line)) inList = false;
  }
  return patterns;
}

/**
 * The workspace folders `root` declares, as forward-slash paths relative to
 * it, in the order of the patterns, or null when `root` declares no workspaces.
 *
 * Guarantees: at most `MAX_WORKSPACE_FOLDERS` folders; every one is a folder
 * reached without a symbolic link, inside `root`, and not `node_modules` or a
 * dot folder. Nothing is executed; the YAML file is scanned as text.
 *
 * @param {string} root  Absolute real path.
 * @param {Record<string, unknown>|null} pkg  package.json of `root`, as data.
 * @returns {Promise<string[]|null>}
 */
export async function workspaceFolders(root, pkg) {
  const field = pkg?.workspaces;
  const listed = Array.isArray(field)
    ? field
    : field !== null && typeof field === 'object' && Array.isArray(/** @type {Record<string, unknown>} */ (field).packages)
      ? /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (field).packages)
      : null;
  let patterns = listed?.filter((value) => typeof value === 'string') ?? null;
  if (patterns === null) {
    const yaml = await readFileInside(root, 'pnpm-workspace.yaml', MAX_PNPM_YAML_BYTES);
    if (yaml === null) return null;
    patterns = pnpmPatterns(yaml.toString('utf8'));
  }

  /** @type {string[]} */
  const folders = [];
  for (const raw of patterns.slice(0, MAX_PATTERNS)) {
    const pattern = parsePattern(raw);
    if (pattern === null) continue;
    const found = pattern.star
      ? (await listDirs(root, pattern.base, MAX_WORKSPACE_FOLDERS)).map((name) => (pattern.base === '' ? name : `${pattern.base}/${name}`))
      : (await entryKind(root, pattern.base)) === 'dir' ? [pattern.base] : [];
    for (const folder of found) {
      if (folders.length >= MAX_WORKSPACE_FOLDERS) return folders;
      if (!folders.includes(folder)) folders.push(folder);
    }
  }
  return folders;
}

/**
 * Where to look for a lock file and for `node_modules`: `root` first, then
 * each folder above it up to the project folder, and never above that. A
 * monorepo keeps both at the workspace root.
 * @param {string} root
 * @param {string} projectDir
 * @returns {{base: string, prefix: string}[]}  Folders as `prefix` (forward slashes, '' for `base` itself) inside `base`.
 */
export function foldersUpward(root, projectDir) {
  const levels = [{ base: root, prefix: '' }];
  if (root === projectDir || !isInside(projectDir, root)) return levels;
  const names = path.relative(projectDir, root).split(path.sep);
  for (let depth = names.length - 1; depth >= 0; depth -= 1) levels.push({ base: projectDir, prefix: names.slice(0, depth).join('/') });
  return levels;
}
