// A crawl deleted from the cache is reported as deleted, not as an unknown job
// (validation of 2026-11-12, bug B2). After the 21st crawl in one data folder,
// page_get on the first one said the job id was wrong.

import assert from 'node:assert/strict';
import { readFile, utimes } from 'node:fs/promises';
import path from 'node:path';
import { after, test } from 'node:test';

import { createCrawlManager } from '../../plugin/server/src/crawl/manager.js';
import { FILES_KEPT, createCrawlStore } from '../../plugin/server/src/crawl/store.js';
import { crawlTools } from '../../plugin/server/src/tools/crawl.js';
import { makeCrawl } from '../helpers/factories.js';
import { removeTempDirs, tempDir } from './harness.js';

after(removeTempDirs);

/**
 * Save `count` crawls into a data folder, each file a minute newer than the one before.
 * @param {string} dataDir @param {number} count
 */
async function saveCrawls(dataDir, count) {
  const store = createCrawlStore(path.join(dataDir, 'crawls'));
  for (let i = 0; i < count; i += 1) {
    const id = `c-${String(i).padStart(2, '0')}`;
    await store.save(makeCrawl({ id }));
    const when = new Date(Date.UTC(2026, 10, 12, 0, i));
    await utimes(path.join(dataDir, 'crawls', `${id}.json`), when, when).catch(() => {});
  }
  return store;
}

test('the store remembers which crawls it deleted, and only those', async () => {
  const dataDir = await tempDir();
  const store = await saveCrawls(dataDir, FILES_KEPT + 2);
  // The last save pruned the oldest files; another save prunes by the times set above.
  await store.save(makeCrawl({ id: 'c-latest' }));
  assert.equal(await store.load('c-00'), null);
  assert.equal(await store.wasPruned('c-00'), true);
  assert.equal(await store.wasPruned('c-latest'), false, 'kept');
  assert.equal(await store.wasPruned('c-never'), false, 'never existed');
  const remembered = (await readFile(path.join(dataDir, 'crawls', 'pruned-ids.txt'), 'utf8')).trim().split('\n');
  assert.equal(new Set(remembered).size, remembered.length, 'each id once');
});

test('page_get and crawl_status on a deleted crawl say it was removed from the cache; an unknown id is still unknown', async () => {
  const dataDir = await tempDir();
  await saveCrawls(dataDir, FILES_KEPT + 1);
  const manager = createCrawlManager({ dataDir, sleep: async () => {} });
  const tools = Object.fromEntries(crawlTools({ crawlManager: manager }).map((tool) => [tool.name, tool]));
  const prunedId = 'c-00';
  assert.equal(await manager.wasPruned(prunedId), true);
  for (const [name, args] of [['page_get', { job_id: prunedId, url: 'https://example.test/' }], ['crawl_status', { job_id: prunedId }]]) {
    await assert.rejects(tools[name].handler(args), /was removed from the cache: Seekwide keeps only the 20 newest crawls\. Crawl the site again/, name);
  }
  await assert.rejects(tools.page_get.handler({ job_id: 'c-unknown', url: 'https://example.test/' }), /No crawl job "c-unknown" was found/);
});
