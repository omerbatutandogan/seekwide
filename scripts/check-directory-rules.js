#!/usr/bin/env node
// Checks the repository against the mechanical rules of the Claude plugin
// directory, so a submission is not held or refused for something a script
// could have caught. `claude plugin validate --profile directory` covers the
// manifests; this covers the files around them. Only plugin/ is published (the
// marketplace's `source` names it), so the rules apply to the files under it;
// the marketplace at the root is checked for pointing there.
//
// Usage: node scripts/check-directory-rules.js
// Exits 1 and lists every problem when a rule is broken.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The folder the marketplace's `source` names, relative to the repository root: the only folder that ships. */
const PLUGIN = 'plugin';

const MAX_FILES = 512;
const MAX_TEXT_FILE_BYTES = 256 * 1024;
const MAX_ANY_FILE_BYTES = 5 * 1024 * 1024;
const MIN_README_WORDS = 40;
const RESERVED_NAME_WORDS = ['claude', 'anthropic', 'official', 'plugin', 'mcp', 'test'];
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.avif']);

/** @type {string[]} */
const problems = [];

/** @param {string} relative  A path from the repository root. */
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

/** @param {string} relative  A path from the plugin folder. */
const readPlugin = (relative) => read(`${PLUGIN}/${relative}`);

/** Files that would be published: tracked files plus untracked files that are not ignored, and only those under plugin/. */
function publishedFiles() {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', PLUGIN], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return out.split('\0').filter((file) => file !== '');
}

const files = publishedFiles();

/** Whether a file of the plugin folder would be published. @param {string} relative  A path from the plugin folder. */
const published = (relative) => files.includes(`${PLUGIN}/${relative}`);

if (files.length > MAX_FILES) {
  problems.push(`${files.length} files would be published under ${PLUGIN}/; the directory holds plugins with more than ${MAX_FILES} for review.`);
}

for (const file of files) {
  const stat = lstatSync(path.join(ROOT, file), { throwIfNoEntry: false });
  if (!stat) continue; // deleted but still in the index
  const base = path.basename(file);
  const ext = path.extname(file).toLowerCase();

  if (stat.isSymbolicLink()) problems.push(`${file}: symbolic links are not allowed.`);
  if (base === '.DS_Store') problems.push(`${file}: remove .DS_Store files.`);
  if (base === '.npmrc') problems.push(`${file}: an .npmrc file is not allowed next to launchers.`);
  if (stat.size > MAX_ANY_FILE_BYTES) problems.push(`${file}: ${stat.size} bytes; files must be under 5 MiB.`);
  if (!IMAGE_EXTENSIONS.has(ext) && stat.size > MAX_TEXT_FILE_BYTES) {
    problems.push(`${file}: ${stat.size} bytes; non-image files over 256 KiB are held for review.`);
  }
}

// Marketplace: one plugin, and it is the plugin folder
const marketplace = JSON.parse(read('.claude-plugin/marketplace.json'));
const listed = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
if (listed.length !== 1) {
  problems.push(`.claude-plugin/marketplace.json: lists ${listed.length} plugins; it must list exactly one.`);
} else if (listed[0].source !== `./${PLUGIN}`) {
  problems.push(`.claude-plugin/marketplace.json: the plugin's source is ${JSON.stringify(listed[0].source)}; it must be "./${PLUGIN}", or the whole repository is published.`);
}

// Manifest
const manifest = JSON.parse(readPlugin('.claude-plugin/plugin.json'));
const name = String(manifest.name ?? '');
if (!/^[a-z0-9-]{1,64}$/.test(name)) {
  problems.push(`${PLUGIN}/.claude-plugin/plugin.json: name "${name}" must be 1-64 characters of lower-case letters, digits and hyphens.`);
}
for (const word of RESERVED_NAME_WORDS) {
  if (name.split('-').includes(word)) problems.push(`${PLUGIN}/.claude-plugin/plugin.json: name must not contain the reserved word "${word}".`);
}
if (!published('LICENSE') && !manifest.license) {
  problems.push('A LICENSE file or a "license" field in plugin.json is required.');
}
// The copy in plugin/ is what users get; the one at the root is what GitHub shows.
const pluginLicense = path.join(ROOT, PLUGIN, 'LICENSE');
if (!published('LICENSE') || !existsSync(pluginLicense) || !readFileSync(pluginLicense).equals(readFileSync(path.join(ROOT, 'LICENSE')))) {
  problems.push(`${PLUGIN}/LICENSE must be an identical copy of LICENSE at the repository root.`);
}
if (!manifest.icon && !published('.claude-plugin/icon.png')) {
  problems.push(`An icon is required: add ${PLUGIN}/.claude-plugin/icon.png (square PNG, 512 to 2048 px) or set "icon" in plugin.json.`);
}

// README
if (!published('README.md')) {
  problems.push(`${PLUGIN}/README.md is missing.`);
} else {
  const words = readPlugin('README.md').split(/\s+/).filter((word) => /[A-Za-z0-9]/.test(word)).length;
  if (words < MIN_README_WORDS) problems.push(`${PLUGIN}/README.md has ${words} words; at least ${MIN_README_WORDS} are required.`);
}

// Dependencies: exact versions and a lockfile
const pkg = JSON.parse(readPlugin('package.json'));
if (pkg.version !== manifest.version) {
  problems.push(`${PLUGIN}/package.json says version ${JSON.stringify(pkg.version)} and ${PLUGIN}/.claude-plugin/plugin.json says ${JSON.stringify(manifest.version)}; they must match.`);
}
for (const [dep, range] of Object.entries(pkg.dependencies ?? {})) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(range))) {
    problems.push(`${PLUGIN}/package.json: dependency "${dep}" must be pinned to an exact version, found "${range}".`);
  }
}
if (Object.keys(pkg.dependencies ?? {}).length > 0 && !published('package-lock.json')) {
  problems.push(`${PLUGIN}/package-lock.json is required when ${PLUGIN}/package.json has dependencies.`);
}
if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
  problems.push(`${PLUGIN}/package.json: keep devDependencies empty; development tools are installed without saving in the repository root.`);
}

// MCP configuration
const mcp = JSON.parse(readPlugin('.mcp.json'));
for (const [serverName, server] of Object.entries(mcp.mcpServers ?? {})) {
  const config = /** @type {{command?: string, args?: string[], url?: string}} */ (server);
  if (config.command === 'npx' || config.command === 'uvx') {
    problems.push(`${PLUGIN}/.mcp.json: server "${serverName}" uses ${config.command}; launchers must be pinned or avoided.`);
  }
  if (typeof config.url === 'string' && !config.url.startsWith('https://')) {
    problems.push(`${PLUGIN}/.mcp.json: server "${serverName}" has a remote URL that is not https.`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`Directory rules: ${problems.length} problem(s)\n`);
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
  process.exit(1);
}
process.stdout.write(`Directory rules: ok (${files.length} files under ${PLUGIN}/ would be published)\n`);
