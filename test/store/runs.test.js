import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { writeFileAtomic } from '../../server/src/store/fs-util.js';
import { projectPaths } from '../../server/src/store/project.js';
import { listRuns, loadRun, newRunId, saveRun } from '../../server/src/store/runs.js';
import { makeFinding, makeRun } from '../helpers/run-factory.js';

/** @param {import('node:test').TestContext} t */
async function makeDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seekwide-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * @param {string} id
 * @param {string} at
 * @param {object} [extra]
 */
const run = (id, at, extra = {}) => makeRun({ run_id: id, created_at: at, ...extra });

test('newRunId formats the date in UTC as 2026-11-11T14-03-22Z', () => {
  assert.equal(newRunId(new Date('2026-11-11T14:03:22.987Z'), []), '2026-11-11T14-03-22Z');
  assert.equal(newRunId(new Date('2026-01-02T03:04:05+02:00'), []), '2026-01-02T01-04-05Z');
  assert.equal(newRunId(new Date('2026-11-11T14:03:22Z')), '2026-11-11T14-03-22Z');
});

test('newRunId adds -2, -3 when the id is taken, from an array or a Set', () => {
  const date = new Date('2026-11-11T14:03:22Z');
  const base = '2026-11-11T14-03-22Z';
  assert.equal(newRunId(date, [base]), `${base}-2`);
  assert.equal(newRunId(date, [base, `${base}-2`]), `${base}-3`);
  assert.equal(newRunId(date, new Set([base, `${base}-3`])), `${base}-2`);
  assert.equal(newRunId(date, ['2026-11-11T14-03-23Z', 'other']), base);
});

test('newRunId produces ids the store accepts', () => {
  const paths = projectPaths('/work/site');
  const id = newRunId(new Date('2026-11-11T14:03:22Z'), ['2026-11-11T14-03-22Z']);
  assert.doesNotThrow(() => paths.runDir(id));
});

test('newRunId rejects an invalid date', () => {
  for (const bad of [new Date('nope'), '2026-11-11', 0, null, new Date(Date.UTC(10000, 0, 1))]) {
    assert.throws(() => newRunId(/** @type {any} */ (bad), []), TypeError);
  }
});

test('an empty project has no runs, and reading it creates nothing', async (t) => {
  const dir = await makeDir(t);
  assert.deepEqual(await listRuns(dir), []);
  for (const ref of ['last', 'previous', '2026-11-11T14-03-22Z']) {
    await assert.rejects(loadRun(dir, ref), { code: 'RUN_NOT_FOUND' });
  }
  await assert.rejects(fs.stat(path.join(dir, '.seekwide')), { code: 'ENOENT' });
});

test('saveRun writes findings.json and the index entry, and creates the project folder', async (t) => {
  const dir = await makeDir(t);
  const saved = await saveRun(dir, run('r1', '2026-11-11T14:03:22.000Z'));
  const paths = projectPaths(dir);
  assert.equal(saved.runId, 'r1');
  assert.equal(saved.findingsFile, paths.findingsFile('r1'));
  assert.deepEqual(JSON.parse(await fs.readFile(paths.findingsFile('r1'), 'utf8')), run('r1', '2026-11-11T14:03:22.000Z'));
  assert.equal(await fs.readFile(paths.gitignore, 'utf8'), '*\n');

  const index = JSON.parse(await fs.readFile(paths.index, 'utf8'));
  assert.equal(index.schema_version, 1);
  assert.deepEqual(index.runs, [
    {
      run_id: 'r1',
      created_at: '2026-11-11T14:03:22.000Z',
      start_url: 'https://example.test/',
      scores: { links: 88, seo: 78 },
      findings: makeRun().findings.length,
    },
  ]);
  assert.deepEqual(saved.entry, index.runs[0]);
});

test('the index lists runs oldest first, whatever order they were saved in', async (t) => {
  const dir = await makeDir(t);
  await saveRun(dir, run('b', '2026-11-12T10:00:00.000Z'));
  await saveRun(dir, run('a', '2026-11-10T10:00:00.000Z'));
  await saveRun(dir, run('c', '2026-11-11T10:00:00.000Z'));
  assert.deepEqual((await listRuns(dir)).map((entry) => entry.run_id), ['a', 'c', 'b']);
  assert.equal((await loadRun(dir, 'last')).run_id, 'b');
  assert.equal((await loadRun(dir, 'previous')).run_id, 'c');
});

test('index entries record a null score for a module that could not be scored', async (t) => {
  const dir = await makeDir(t);
  const unscored = run('r1', '2026-11-11T14:03:22.000Z');
  unscored.modules.links = { ...unscored.modules.links, score: null };
  await saveRun(dir, unscored);
  assert.deepEqual((await listRuns(dir))[0].scores, { links: null, seo: 78 });
});

test("loadRun resolves 'last', 'previous' and an explicit id", async (t) => {
  const dir = await makeDir(t);
  await saveRun(dir, run('r1', '2026-11-01T10:00:00.000Z'));
  await saveRun(dir, run('r2', '2026-11-02T10:00:00.000Z', { findings: [makeFinding()] }));
  await saveRun(dir, run('r3', '2026-11-03T10:00:00.000Z'));

  assert.equal((await loadRun(dir, 'last')).run_id, 'r3');
  assert.equal((await loadRun(dir, 'previous')).run_id, 'r2');
  assert.equal((await loadRun(dir, 'r1')).run_id, 'r1');
  const r2 = await loadRun(dir, 'r2');
  assert.equal(r2.findings.length, 1);
  assert.deepEqual(r2, run('r2', '2026-11-02T10:00:00.000Z', { findings: [makeFinding()] }));
});

test("loadRun 'previous' needs two runs", async (t) => {
  const dir = await makeDir(t);
  await saveRun(dir, run('only', '2026-11-01T10:00:00.000Z'));
  assert.equal((await loadRun(dir, 'last')).run_id, 'only');
  await assert.rejects(loadRun(dir, 'previous'), (error) => {
    assert.equal(/** @type {any} */ (error).code, 'RUN_NOT_FOUND');
    assert.match(/** @type {Error} */ (error).message, /only one run \(only\)/);
    return true;
  });
});

test('loadRun for an unknown id throws RUN_NOT_FOUND and names the known runs', async (t) => {
  const dir = await makeDir(t);
  await saveRun(dir, run('r1', '2026-11-01T10:00:00.000Z'));
  await assert.rejects(loadRun(dir, 'nope'), (error) => {
    assert.equal(/** @type {any} */ (error).code, 'RUN_NOT_FOUND');
    assert.match(/** @type {Error} */ (error).message, /Known runs: r1\./);
    return true;
  });
});

test('loadRun rejects ids that would leave the runs folder and never reads outside it', async (t) => {
  const dir = await makeDir(t);
  await saveRun(dir, run('r1', '2026-11-01T10:00:00.000Z'));
  const outside = path.join(dir, 'secret');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'findings.json'), JSON.stringify(run('secret', '2026-11-01T10:00:00.000Z')));
  for (const bad of ['../../secret', '../runs/r1', '..', 'r1/..', '/etc/passwd', 'a\\b']) {
    await assert.rejects(loadRun(dir, bad), { code: 'INVALID_RUN_ID' }, `loaded ${bad}`);
  }
});

test('saveRun rejects run ids that are unsafe or reserved, and writes nothing', async (t) => {
  const dir = await makeDir(t);
  for (const id of ['../escape', 'a/b', '..', 'index.json', 'last', 'previous', '']) {
    await assert.rejects(saveRun(dir, run(id, '2026-11-01T10:00:00.000Z')), { code: 'INVALID_RUN_ID' }, `saved ${id}`);
  }
  assert.deepEqual(await listRuns(dir), []);
  assert.deepEqual(await fs.readdir(path.join(dir, '.seekwide')).catch(() => []), []);
});

test('saveRun rejects a value that is not a run', async (t) => {
  const dir = await makeDir(t);
  await assert.rejects(saveRun(dir, /** @type {any} */ (null)), TypeError);
  await assert.rejects(saveRun(dir, /** @type {any} */ ({ run_id: 'r1' })), TypeError);
  await assert.rejects(saveRun(dir, /** @type {any} */ ({ ...run('r1', '2026-11-01T10:00:00.000Z'), findings: 'x' })), TypeError);
});

test('saving a run id that is already stored fails with RUN_EXISTS and keeps the original', async (t) => {
  const dir = await makeDir(t);
  await saveRun(dir, run('r1', '2026-11-01T10:00:00.000Z', { findings: [makeFinding()] }));
  await assert.rejects(saveRun(dir, run('r1', '2026-11-05T10:00:00.000Z', { findings: [] })), { code: 'RUN_EXISTS' });
  assert.equal((await loadRun(dir, 'r1')).findings.length, 1);
  assert.equal((await listRuns(dir)).length, 1);
});

test('a run folder missing from the index can be saved again (recovery after a crash)', async (t) => {
  const dir = await makeDir(t);
  const paths = projectPaths(dir);
  await saveRun(dir, run('keep', '2026-11-01T10:00:00.000Z'));
  await fs.mkdir(paths.runDir('orphan'));
  await fs.writeFile(paths.findingsFile('orphan'), '{"half":');
  assert.deepEqual((await listRuns(dir)).map((e) => e.run_id), ['keep']);
  await saveRun(dir, run('orphan', '2026-11-02T10:00:00.000Z'));
  assert.deepEqual((await listRuns(dir)).map((e) => e.run_id), ['keep', 'orphan']);
  assert.equal((await loadRun(dir, 'orphan')).run_id, 'orphan');
});

test('a missing index is rebuilt from the run folders, and saving keeps the old runs', async (t) => {
  const dir = await makeDir(t);
  const paths = projectPaths(dir);
  await saveRun(dir, run('r1', '2026-11-01T10:00:00.000Z'));
  await saveRun(dir, run('r2', '2026-11-02T10:00:00.000Z'));
  await fs.rm(paths.index);
  assert.deepEqual((await listRuns(dir)).map((e) => e.run_id), ['r1', 'r2']);
  await saveRun(dir, run('r3', '2026-11-03T10:00:00.000Z'));
  assert.deepEqual(JSON.parse(await fs.readFile(paths.index, 'utf8')).runs.map((e) => e.run_id), ['r1', 'r2', 'r3']);
});

test('a damaged index is rebuilt; unreadable run folders are left out', async (t) => {
  const dir = await makeDir(t);
  const paths = projectPaths(dir);
  await saveRun(dir, run('r1', '2026-11-01T10:00:00.000Z'));
  await fs.mkdir(paths.runDir('broken'));
  await fs.writeFile(paths.findingsFile('broken'), 'not json');
  await fs.mkdir(path.join(paths.runsDir, 'not a run id'));
  for (const damaged of ['{"runs": [', '{"runs": "x"}', '{"runs": [{"run_id": "../x"}]}', '[]']) {
    await fs.writeFile(paths.index, damaged);
    assert.deepEqual((await listRuns(dir)).map((e) => e.run_id), ['r1'], damaged);
  }
});

test('loadRun reports a damaged findings.json as RUN_CORRUPT', async (t) => {
  const dir = await makeDir(t);
  const paths = projectPaths(dir);
  await saveRun(dir, run('r1', '2026-11-01T10:00:00.000Z'));
  await fs.writeFile(paths.findingsFile('r1'), '{"run_id": ');
  await assert.rejects(loadRun(dir, 'r1'), { code: 'RUN_CORRUPT' });

  await fs.writeFile(paths.findingsFile('r1'), JSON.stringify({ run_id: 'r1', findings: [] }));
  await assert.rejects(loadRun(dir, 'r1'), { code: 'RUN_CORRUPT' });

  await fs.writeFile(paths.findingsFile('r1'), JSON.stringify(run('someone-else', '2026-11-01T10:00:00.000Z')));
  await assert.rejects(loadRun(dir, 'r1'), { code: 'RUN_CORRUPT' }, 'the file must describe the run it is stored under');
});

test('concurrent saves all reach the index', async (t) => {
  const dir = await makeDir(t);
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  await Promise.all(ids.map((id, n) => saveRun(dir, run(id, `2026-11-0${n + 1}T10:00:00.000Z`))));
  assert.deepEqual((await listRuns(dir)).map((e) => e.run_id), ids);
});

test('saving does not change the run it was given', async (t) => {
  const dir = await makeDir(t);
  const original = run('r1', '2026-11-01T10:00:00.000Z');
  const copy = structuredClone(original);
  await saveRun(dir, original);
  assert.deepEqual(original, copy);
});

test('writes leave no temporary files behind', async (t) => {
  const dir = await makeDir(t);
  await saveRun(dir, run('r1', '2026-11-01T10:00:00.000Z'));
  await saveRun(dir, run('r2', '2026-11-02T10:00:00.000Z'));
  const paths = projectPaths(dir);
  assert.deepEqual((await fs.readdir(paths.runsDir)).sort(), ['index.json', 'r1', 'r2']);
  assert.deepEqual(await fs.readdir(paths.runDir('r1')), ['findings.json']);
});

test('writeFileAtomic replaces content in one step and cleans up when it fails', async (t) => {
  const dir = await makeDir(t);
  const file = path.join(dir, 'data.json');
  await writeFileAtomic(file, 'one');
  await writeFileAtomic(file, 'two');
  assert.equal(await fs.readFile(file, 'utf8'), 'two');

  const target = path.join(dir, 'a-directory');
  await fs.mkdir(target);
  await assert.rejects(writeFileAtomic(target, 'x'));
  assert.deepEqual((await fs.readdir(dir)).sort(), ['a-directory', 'data.json']);
});

test('the stored file is pretty JSON that ends with a newline', async (t) => {
  const dir = await makeDir(t);
  await saveRun(dir, run('r1', '2026-11-01T10:00:00.000Z'));
  const text = await fs.readFile(projectPaths(dir).findingsFile('r1'), 'utf8');
  assert.ok(text.endsWith('}\n'));
  assert.ok(text.includes('\n  "run_id": "r1"'));
});

test('a relative project directory is rejected before anything is written', async () => {
  await assert.rejects(saveRun('relative', run('r1', '2026-11-01T10:00:00.000Z')), { code: 'INVALID_PROJECT_DIR' });
  await assert.rejects(loadRun('relative', 'last'), { code: 'INVALID_PROJECT_DIR' });
  await assert.rejects(listRuns('relative'), { code: 'INVALID_PROJECT_DIR' });
});
