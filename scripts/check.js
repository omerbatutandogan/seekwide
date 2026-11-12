// Every check CI runs, in one command: `npm run check`.
//
// The tests, the strict type check, the generated checks document, the plugin
// directory rules, the plugin manifest validation and the dependency audit.
// TypeScript and the Node.js types are installed without saving, at the
// versions CI pins, because they are development tools only: Claude Code
// installs the plugin's dependencies on every user's machine. The script stops
// at the first check that fails and says which one.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The versions CI installs (`.github/workflows/ci.yml`); this script fails when the two differ. */
const TOOLS = ['typescript@7.0.2', '@types/node@22.20.5'];

/**
 * Run a command in the repository and stop the script when it fails.
 * @param {string} name     What the step checks.
 * @param {string} command
 * @param {string[]} args
 */
function step(name, command, args) {
  process.stdout.write(`\n== ${name}: ${command} ${args.join(' ')}\n`);
  // npm and npx are batch files on Windows, which only a shell runs.
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    process.stderr.write(`\n${name} failed${result.error ? `: ${result.error.message}` : ''}.\n`);
    process.exit(1);
  }
}

/**
 * The installed version of a package in node_modules, or null.
 * @param {string} name
 * @returns {string|null}
 */
function installed(name) {
  try {
    return JSON.parse(readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

const workflow = readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
const missing = TOOLS.filter((tool) => !workflow.includes(tool));
if (missing.length > 0) {
  process.stderr.write(`scripts/check.js pins ${missing.join(' and ')}, which .github/workflows/ci.yml does not install. Change both together.\n`);
  process.exit(1);
}

step('Tests', 'npm', ['test']);
const stale = TOOLS.filter((tool) => {
  const at = tool.lastIndexOf('@');
  return installed(tool.slice(0, at)) !== tool.slice(at + 1);
});
if (stale.length > 0) step('Install the type checker (not saved)', 'npm', ['install', '--no-save', '--ignore-scripts', ...TOOLS]);
step('Type check', 'npx', ['tsc', '-p', 'jsconfig.json']);
step('docs/checks.md matches the code', 'node', ['scripts/gen-checks-doc.js', '--check']);
step('Plugin directory rules', 'node', ['scripts/check-directory-rules.js']);
step('Plugin manifest and skills', 'claude', ['plugin', 'validate', '.', '--strict', '--profile', 'directory']);
step('Known vulnerabilities in runtime dependencies', 'npm', ['audit', '--omit=dev']);
process.stdout.write('\nEvery check passed.\n');
