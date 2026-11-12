// Core Web Vitals kept with a crawl on disk: read back by a later server
// process, never trusted when the file is not one the plugin wrote, and pruned
// together with the crawl.

import assert from 'node:assert/strict';
import { mkdir, readdir, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, test } from 'node:test';

import { createCrawlManager } from '../../server/src/crawl/manager.js';
import { createCrawlStore } from '../../server/src/crawl/store.js';
import { makeCrawl, makeVitals } from '../helpers/factories.js';
import { removeTempDirs, tempDir } from './harness.js';

after(removeTempDirs);

const AT = '2026-11-12T10:00:00.000Z';

test('a measurement kept with a crawl is read back by another manager on the same folder, per page count', async () => {
  const dataDir = await tempDir();
  const vitals = makeVitals();
  await createCrawlManager({ dataDir }).storeVitals('c-1', 3, vitals, AT);
  await createCrawlManager({ dataDir }).storeVitals('c-1', 5, makeVitals({ notes: ['five'] }), AT);

  const later = createCrawlManager({ dataDir });
  assert.deepEqual(await later.storedVitals('c-1', 3), { vitals, measured_at: AT });
  assert.deepEqual((await later.storedVitals('c-1', 5))?.vitals.notes, ['five']);
  assert.equal(await later.storedVitals('c-1', 4), null);
  assert.equal(await later.storedVitals('c-2', 3), null);
  assert.equal((await stat(path.join(dataDir, 'crawls', 'c-1.vitals.json'))).mode & 0o777, 0o600);
});

test('two measurements of one crawl saved at the same time are both kept, in a whole file', async () => {
  const dataDir = await tempDir();
  const manager = createCrawlManager({ dataDir });
  // Different sizes, so a write that overlapped another would leave a broken file.
  const big = makeVitals({ notes: Array.from({ length: 300 }, (_, i) => `note ${i}`) });
  const small = makeVitals({ notes: ['small'] });
  await Promise.all([manager.storeVitals('c-1', 3, big, AT), manager.storeVitals('c-1', 5, small, AT), manager.storeVitals('c-1', 7, small, AT)]);
  const later = createCrawlManager({ dataDir });
  assert.equal((await later.storedVitals('c-1', 3))?.vitals.notes.length, 300);
  assert.deepEqual((await later.storedVitals('c-1', 5))?.vitals.notes, ['small']);
  assert.deepEqual((await later.storedVitals('c-1', 7))?.vitals.notes, ['small']);
  assert.deepEqual(await readdir(path.join(dataDir, 'crawls')), ['c-1.vitals.json'], 'no temporary file is left');
});

test('an id that is not a safe file name is never used as a path', async () => {
  const manager = createCrawlManager({ dataDir: await tempDir() });
  assert.equal(await manager.storedVitals('../c-1', 3), null);
  assert.equal(await manager.storedVitals('c-1', 2.5), null);
  await assert.rejects(manager.storeVitals('../c-1', 3, makeVitals(), AT), TypeError);
  await assert.rejects(manager.storeVitals('c-1', 0, makeVitals(), AT), TypeError);
});

test('a measurement file the plugin did not write is ignored, so the audit measures again', async () => {
  const dataDir = await tempDir();
  const dir = path.join(dataDir, 'crawls');
  await mkdir(dir, { recursive: true });
  const good = { measured_at: AT, vitals: makeVitals() };
  /** @type {[string, string|Buffer][]} */
  const files = [
    ['c-json', '{not json'],
    ['c-other', JSON.stringify({ schema_version: 1, crawl_id: 'c-1', measurements: { 3: good } })],
    ['c-schema', JSON.stringify({ schema_version: 2, crawl_id: 'c-schema', measurements: { 3: good } })],
    ['c-shape', JSON.stringify({ schema_version: 1, crawl_id: 'c-shape', measurements: { 3: { measured_at: AT, vitals: { ...good.vitals, pages: 'many' } } } })],
    ['c-date', JSON.stringify({ schema_version: 1, crawl_id: 'c-date', measurements: { 3: { ...good, measured_at: 'yesterday' } } })],
    ['c-big', JSON.stringify({ schema_version: 1, crawl_id: 'c-big', measurements: { 3: good }, pad: 'x'.repeat(1024 * 1024) })],
  ];
  for (const [id, content] of files) await writeFile(path.join(dir, `${id}.vitals.json`), content);
  await writeFile(path.join(dir, 'target.json'), JSON.stringify({ schema_version: 1, crawl_id: 'c-link', measurements: { 3: good } }));
  await symlink(path.join(dir, 'target.json'), path.join(dir, 'c-link.vitals.json'));
  await writeFile(path.join(dir, 'c-ok.vitals.json'), JSON.stringify({ schema_version: 1, crawl_id: 'c-ok', measurements: { 3: good } }));

  const manager = createCrawlManager({ dataDir });
  for (const id of ['c-json', 'c-other', 'c-schema', 'c-shape', 'c-date', 'c-big', 'c-link']) {
    assert.equal(await manager.storedVitals(id, 3), null, id);
  }
  assert.deepEqual(await manager.storedVitals('c-ok', 3), good, 'the same reader accepts a file the plugin wrote');
});

test('the folder keeps 20 crawls with their measurements and deletes a measurement whose crawl is gone', async () => {
  const dataDir = await tempDir();
  const dir = path.join(dataDir, 'crawls');
  const store = createCrawlStore(dir);
  for (let i = 1; i <= 20; i += 1) {
    const id = `c-${String(i).padStart(2, '0')}`;
    await store.save(makeCrawl({ id }));
    await store.saveVitals(id, 3, { vitals: makeVitals(), measured_at: AT });
    // Older than the crawl saved last, oldest first.
    const old = new Date(Date.now() - (100 - i) * 1000);
    await utimes(path.join(dir, `${id}.json`), old, old);
  }
  await store.saveVitals('c-gone', 3, { vitals: makeVitals(), measured_at: AT });
  assert.equal((await readdir(dir)).length, 41, 'measurement files do not count as crawls');

  await store.save(makeCrawl({ id: 'c-21' }));
  const names = (await readdir(dir)).sort();
  assert.equal(names.filter((name) => !name.endsWith('.vitals.json')).length, 20);
  assert.equal(names.includes('c-01.json'), false, 'the oldest crawl is deleted');
  assert.equal(names.includes('c-01.vitals.json'), false, 'and its measurement with it');
  assert.equal(names.includes('c-gone.vitals.json'), false, 'a measurement without its crawl is deleted');
  assert.equal(names.includes('c-02.vitals.json'), true);
  assert.equal(names.includes('c-21.json'), true);
});
