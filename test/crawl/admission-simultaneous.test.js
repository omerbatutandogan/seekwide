// Crawl admission when starts arrive together (validation of 2026-11-12, bug
// B1). Parallel tool calls start crawls in the same moment; the third of
// three was refused with "3 crawls are running already" while two existed,
// because a job that was stored but not yet returned counted twice.

import assert from 'node:assert/strict';
import { after, it } from 'node:test';

import { createCrawlManager } from '../../server/src/crawl/manager.js';
import { removeTempDirs, tempDir } from './harness.js';

after(removeTempDirs);

/** A fetch that never answers, so every crawl stays running. */
const never = /** @type {any} */ (() => new Promise(() => {}));

it('three starts on three hosts at once all start, and a fourth is refused', async () => {
  const manager = createCrawlManager({ dataDir: await tempDir(), sleep: async () => {}, fetch: never });
  const outcomes = await Promise.allSettled(['a', 'b', 'c', 'd'].map((name) => manager.start({ url: `https://${name}.example/` })));
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ['fulfilled', 'fulfilled', 'fulfilled', 'rejected']);
  const refused = /** @type {PromiseRejectedResult} */ (outcomes[3]);
  assert.match(refused.reason.message, /3 crawls are running already/);
});

it('a site that is starting and one that is registered still count as two, and a second start of a site is still refused', async () => {
  const local = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return [{ address: '127.0.0.1', family: 4 }];
  };
  const manager = createCrawlManager({ dataDir: await tempDir(), sleep: async () => {}, fetch: never, lookup: local });
  const outcomes = await Promise.allSettled([
    manager.start({ url: 'http://localhost:4173/', allowLoopback: true }),
    manager.start({ url: 'https://a.example/' }),
    manager.start({ url: 'https://a.example/again' }),
    manager.start({ url: 'https://b.example/' }),
    manager.start({ url: 'https://c.example/' }),
  ]);
  assert.deepEqual(outcomes.map((outcome) => outcome.status), ['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'rejected']);
  assert.match(/** @type {PromiseRejectedResult} */ (outcomes[2]).reason.message, /already running/);
  assert.match(/** @type {PromiseRejectedResult} */ (outcomes[4]).reason.message, /3 crawls are running already/);
});
