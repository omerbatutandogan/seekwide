// One crawl per site at a time, and a few crawls at most: each crawl paces its
// own requests, so parallel crawls of one site would multiply its rate.

import assert from 'node:assert/strict';
import { after, it } from 'node:test';

import { createCrawlManager } from '../../server/src/crawl/manager.js';
import { removeTempDirs, tempDir } from './harness.js';

after(removeTempDirs);

/** A fetch that never answers until released, so jobs stay running. */
function holdingFetch() {
  /** @type {(() => void)[]} */
  const waiting = [];
  /** @type {any} */
  const fetch = (/** @type {string} */ url) => new Promise((resolve) => {
    waiting.push(() => resolve({ url, finalUrl: url, status: 404, headers: {}, headerLines: {}, redirectChain: [], body: null, truncated: false, bytes: 0, elapsedMs: 1, error: null }));
  });
  return { fetch, release: () => waiting.splice(0).forEach((go) => go()) };
}

it('refuses a second crawl of a site while one runs, and a fourth crawl at once; other sites start', async () => {
  const held = holdingFetch();
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const manager = createCrawlManager({ dataDir: await tempDir(), sleep: async () => {}, fetch: held.fetch, lookup });
  const first = await manager.start({ url: 'https://one.example/' });
  await assert.rejects(manager.start({ url: 'https://one.example/other' }), (error) => error instanceof TypeError && error.message.includes(`job ${first.id}`));
  await manager.start({ url: 'https://two.example/' });
  await manager.start({ url: 'https://three.example/' });
  await assert.rejects(manager.start({ url: 'https://four.example/' }), (error) => error instanceof TypeError && /3 crawls are running already/.test(error.message));
  for (let i = 0; i < 50; i += 1) {
    held.release();
    await new Promise((resolve) => setImmediate(resolve));
    if ((await manager.wait(first.id, 10))?.status !== 'running') break;
  }
  held.release();
  await manager.wait(first.id, 5000);
  assert.notEqual(manager.get(first.id)?.status, 'running');
  await manager.start({ url: 'https://one.example/again' });
  held.release();
});

it('crawls of one site started at the same moment get one job, while the local check is awaited', async () => {
  const held = holdingFetch();
  const lookup = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    return [{ address: '127.0.0.1', family: 4 }];
  };
  const manager = createCrawlManager({ dataDir: await tempDir(), sleep: async () => {}, fetch: held.fetch, lookup });
  const outcomes = await Promise.allSettled(Array.from({ length: 5 }, () => manager.start({ url: 'http://localhost:4173/', allowLoopback: true })));
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['fulfilled', 'rejected', 'rejected', 'rejected', 'rejected']);
  const refused = /** @type {PromiseRejectedResult} */ (outcomes.find((outcome) => outcome.status === 'rejected'));
  assert.equal(refused.reason.busy, true);
  held.release();
});

it('a crawl stops as truncated when its page records reach the size budget, and runs to its page limit below it', async () => {
  const { startServer } = await import('../helpers/http-server.js');
  const { safeFetch } = await import('../../server/src/net/safe-fetch.js');
  /** @type {Record<string, {body: string}>} */
  const routes = {};
  for (let i = 0; i < 8; i += 1) routes[`/p${i}`] = { body: `<!doctype html><html lang="en"><head><title>P${i}</title></head><body>${'<p>text</p>'.repeat(50)}<a href="/p${i + 1}">next</a></body></html>` };
  routes['/'] = routes['/p0'];
  const server = await startServer(routes);
  try {
    /** @param {number} [maxStoredChars] */
    const crawl = async (maxStoredChars) => {
      const manager = createCrawlManager({ dataDir: await tempDir(), sleep: async () => {}, fetch: safeFetch, ...(maxStoredChars === undefined ? {} : { maxStoredChars }) });
      const job = await manager.start({ url: `${server.origin}/`, allowLoopback: true, maxPages: 8 });
      await manager.wait(job.id, 30_000);
      return manager.result(job.id);
    };
    const small = await crawl(3_000);
    assert.equal(small?.truncated, true);
    assert.ok((small?.pages.length ?? 0) < 8 && (small?.pages.length ?? 0) > 0);
    const whole = await crawl();
    assert.equal(whole?.pages.length, 8);
  } finally {
    await server.close();
  }
});

it('the same site under another scheme, www or loopback name is still the same site', async () => {
  const held = holdingFetch();
  const lookup = async (/** @type {string} */ host) => [{ address: host === 'localhost' ? '127.0.0.1' : '93.184.216.34', family: 4 }];
  const manager = createCrawlManager({ dataDir: await tempDir(), sleep: async () => {}, fetch: held.fetch, lookup });
  await manager.start({ url: 'https://one.example/' });
  for (const url of ['http://one.example/', 'https://www.one.example/', 'https://one.example:8443/']) {
    await assert.rejects(manager.start({ url }), (error) => error instanceof TypeError && /already running/.test(error.message), url);
  }
  await manager.start({ url: 'http://localhost:4173/', allowLoopback: true });
  await assert.rejects(manager.start({ url: 'http://127.0.0.1:4173/', allowLoopback: true }), (error) => error instanceof TypeError && /already running/.test(error.message));
  await manager.start({ url: 'http://127.0.0.1:4174/', allowLoopback: true });
  held.release();
});
