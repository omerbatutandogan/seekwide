// A robots.txt that redirects to an address the crawl may not request: the
// crawl stops, as for any robots.txt that cannot be read, and says where the
// redirect led.

import assert from 'node:assert/strict';
import { after, it } from 'node:test';

import { createCrawlManager } from '../../server/src/crawl/manager.js';
import { safeFetch } from '../../server/src/net/safe-fetch.js';
import { blockedRedirect } from '../../server/src/report/facts.js';
import { startServer } from '../helpers/http-server.js';
import { removeTempDirs, tempDir } from './harness.js';

after(removeTempDirs);

const PAGE = { body: '<!doctype html><html lang="en"><head><title>Home</title></head><body><h1>Home</h1></body></html>' };

/** @param {string} startUrl */
async function crawl(startUrl) {
  const manager = createCrawlManager({ dataDir: await tempDir(), sleep: async () => {}, fetch: safeFetch });
  const job = await manager.start({ url: startUrl, allowLoopback: true });
  return manager.wait(job.id, 30_000);
}

it('a local robots.txt that redirects to another local port names that address, which gets no request', async () => {
  const other = await startServer({ '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' } });
  const local = await startServer({ '/': PAGE, '/robots.txt': { status: 302, redirect: `${other.origin}/robots.txt` } });
  try {
    const done = await crawl(`${local.origin}/`);
    assert.deepEqual(done?.blocked, { reason: 'robots_unreachable', url: `${local.origin}/robots.txt`, status: 0, redirected_to: `${other.origin}/robots.txt` });
    assert.equal(other.requests.length, 0);
    assert.match(blockedRedirect(/** @type {any} */ (done?.blocked)), new RegExp(`robots\\.txt redirects to ${other.origin.replace(/[.]/g, '\\.')}/robots\\.txt`));
  } finally {
    await Promise.all([local.close(), other.close()]);
  }
});

it('a local robots.txt that redirects on its own address is read there, and nothing is named', async () => {
  const local = await startServer({
    '/': PAGE,
    '/robots.txt': { status: 301, redirect: '/rules.txt' },
    '/rules.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' },
  });
  try {
    const done = await crawl(`${local.origin}/`);
    assert.equal(done?.status, 'done');
    assert.equal(done?.blocked, null);
  } finally {
    await local.close();
  }
});

it('a robots.txt that cannot be read for another reason names no redirect', () => {
  assert.equal(blockedRedirect({}), '');
});
