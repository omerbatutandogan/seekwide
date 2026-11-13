import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ensureProject, projectPaths } from '../../plugin/server/src/store/project.js';

/** @param {import('node:test').TestContext} t */
async function makeDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seekwide-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('projectPaths builds every path under <projectDir>/.seekwide', () => {
  // An absolute path on this platform: /work/site here, D:\\work\\site on Windows.
  const work = path.resolve('/work/site');
  const paths = projectPaths(work);
  const under = (/** @type {string[]} */ ...names) => path.join(work, '.seekwide', ...names);
  assert.equal(paths.root, under());
  assert.equal(paths.gitignore, under('.gitignore'));
  assert.equal(paths.profile, under('profile.json'));
  assert.equal(paths.runsDir, under('runs'));
  assert.equal(paths.index, under('runs', 'index.json'));
  assert.equal(paths.runDir('2026-11-11T14-03-22Z'), under('runs', '2026-11-11T14-03-22Z'));
  assert.equal(paths.findingsFile('r1'), under('runs', 'r1', 'findings.json'));
  assert.equal(paths.reportFile('r1', 'md'), under('runs', 'r1', 'report.md'));
  assert.equal(paths.reportFile('r1', 'html'), under('runs', 'r1', 'report.html'));
  if (path.sep === '/') assert.equal(paths.findingsFile('r1'), '/work/site/.seekwide/runs/r1/findings.json');
});

test('projectPaths normalizes the project directory and creates nothing', async (t) => {
  const dir = await makeDir(t);
  const paths = projectPaths(`${dir}/a/../b/`);
  assert.equal(paths.projectDir, path.join(dir, 'b'));
  await assert.rejects(fs.stat(paths.root), { code: 'ENOENT' });
});

test('projectPaths rejects a project directory that is not an absolute path', () => {
  for (const bad of ['', 'relative/dir', './here', '.', '~/site', undefined, null, 42, {}, '/tmp/x\0y']) {
    assert.throws(() => projectPaths(/** @type {any} */ (bad)), { code: 'INVALID_PROJECT_DIR' }, `accepted ${String(bad)}`);
  }
});

test('run ids that are not safe file names are rejected by every path builder', () => {
  const paths = projectPaths('/work/site');
  const bad = [
    '../x', '../../etc/passwd', 'a/b', 'a\\b', '/abs', '..', '.', '.hidden', '', 'a b', 'a\0b', 'index.json', 'last', 'previous',
    'x'.repeat(129), '<script>', 'run;rm -rf', 'ünïcode', undefined, null, 5, {},
  ];
  for (const id of bad) {
    assert.throws(() => paths.runDir(/** @type {any} */ (id)), { code: 'INVALID_RUN_ID' }, `runDir accepted ${JSON.stringify(id)}`);
    assert.throws(() => paths.findingsFile(/** @type {any} */ (id)), { code: 'INVALID_RUN_ID' });
    assert.throws(() => paths.reportFile(/** @type {any} */ (id), 'md'), { code: 'INVALID_RUN_ID' });
  }
});

test('run ids made of letters, digits, dot, underscore and hyphen are accepted', () => {
  const work = path.resolve('/work/site');
  const paths = projectPaths(work);
  for (const id of ['2026-11-11T14-03-22Z', '2026-11-11T14-03-22Z-2', 'run_1', 'a.b-c', 'X'.repeat(128)]) {
    assert.equal(paths.runDir(id), path.join(work, '.seekwide', 'runs', id));
  }
});

test('reportFile accepts only the md and html formats', () => {
  assert.throws(() => projectPaths('/work/site').reportFile('r1', /** @type {any} */ ('pdf')), TypeError);
});

test('ensureProject creates .seekwide/runs and a .gitignore containing *', async (t) => {
  const dir = await makeDir(t);
  const paths = await ensureProject(dir);
  assert.equal(paths.root, path.join(dir, '.seekwide'));
  assert.equal((await fs.stat(paths.runsDir)).isDirectory(), true);
  assert.equal(await fs.readFile(paths.gitignore, 'utf8'), '*\n');
});

test('ensureProject never overwrites an existing .gitignore and can run twice', async (t) => {
  const dir = await makeDir(t);
  const paths = await ensureProject(dir);
  await fs.writeFile(paths.gitignore, '# mine\n!profile.json\n');
  await ensureProject(dir);
  assert.equal(await fs.readFile(paths.gitignore, 'utf8'), '# mine\n!profile.json\n');
});

test('ensureProject refuses a project directory that does not exist or is a file', async (t) => {
  const dir = await makeDir(t);
  await assert.rejects(ensureProject(path.join(dir, 'missing')), { code: 'PROJECT_DIR_NOT_FOUND' });
  await assert.rejects(fs.stat(path.join(dir, 'missing')), { code: 'ENOENT' }, 'a typo must not create folders');
  await fs.writeFile(path.join(dir, 'file'), 'x');
  await assert.rejects(ensureProject(path.join(dir, 'file')), { code: 'PROJECT_DIR_NOT_FOUND' });
});

test('ensureProject rejects a relative project directory', async () => {
  await assert.rejects(ensureProject('relative'), { code: 'INVALID_PROJECT_DIR' });
});
