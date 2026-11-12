import assert from 'node:assert/strict';
import { chmod, mkdir, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { after, test } from 'node:test';

import { USER_AGENT } from '../../server/src/config.js';
import { createCrawlManager } from '../../server/src/crawl/manager.js';
import { startServer } from '../helpers/http-server.js';
import { fakeFetch } from '../net/fake-fetch.js';
import { fakeExtract } from './fake-records.js';
import { NOW, crawl, html, removeTempDirs, tempDir, testManager } from './harness.js';

/** Whether this platform has POSIX file modes. Windows reports 0o666 whatever chmod was asked for. */
const POSIX_MODES = process.platform !== 'win32';
const MODES_SKIP = POSIX_MODES ? false : 'Windows has no POSIX file modes; there the ACL of the data folder decides who can read the cache';

after(removeTempDirs);

const S = 'https://site.test';
const PAGE = { headers: { 'content-type': 'text/html' }, text: '<a href="/a">a</a>' };

test('start validates its input and throws TypeError with a helpful message', async () => {
  const { manager } = await testManager({ fetch: fakeFetch({}).fetch });
  await assert.rejects(manager.start(/** @type {any} */ (null)), TypeError);
  await assert.rejects(manager.start({ url: 'ftp://site.test/' }), /not an http or https URL/);
  await assert.rejects(manager.start({ url: 'site.test' }), TypeError);
  await assert.rejects(manager.start(/** @type {any} */ ({ url: 42 })), TypeError);
  await assert.rejects(manager.start({ url: S, maxPages: 0 }), /maxPages/);
  await assert.rejects(manager.start({ url: S, maxPages: 501 }), /maxPages/);
  await assert.rejects(manager.start({ url: S, maxPages: 2.5 }), /maxPages/);
  await assert.rejects(manager.start({ url: S, ratePerSec: 0 }), /ratePerSec/);
  await assert.rejects(manager.start({ url: S, ratePerSec: 3 }), /ratePerSec/);
  await assert.rejects(manager.start(/** @type {any} */ ({ url: S, includeSubdomains: 'yes' })), TypeError);
  await assert.rejects(manager.start(/** @type {any} */ ({ url: S, allowLoopback: 1 })), TypeError);
});

test('start returns a running snapshot at once and the defaults are applied', async () => {
  const { fetch } = fakeFetch({ [`${S}/`]: PAGE });
  const { manager } = await testManager({ fetch });
  const job = await manager.start({ url: 'https://SITE.test/#top' });
  assert.equal(job.status, 'running');
  assert.equal(job.start_url, `${S}/`);
  assert.equal(job.max_pages, 25);
  assert.equal(job.started_at, NOW.toISOString());
  assert.equal(job.finished_at, null);
  const done = await manager.wait(job.id, 10_000);
  assert.equal(done?.status, 'done');
  const result = await manager.result(job.id);
  assert.deepEqual(result?.options, { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: false });
  assert.equal(result?.user_agent, USER_AGENT);
  assert.equal(result?.schema_version, 1);
  assert.equal(result?.started_at, NOW.toISOString());
  assert.equal(result?.finished_at, NOW.toISOString());
  assert.equal(done?.pages_crawled, result?.pages.length);
});

test('default job ids look like c-20261111T140322Z-a1b2c3', async () => {
  const { fetch } = fakeFetch({});
  const manager = createCrawlManager({ dataDir: await tempDir(), fetch, extract: fakeExtract, now: () => NOW, sleep: async () => {} });
  const job = await manager.start({ url: S });
  assert.match(job.id, /^c-20261111T140322Z-[0-9a-f]{6}$/);
  await manager.wait(job.id, 10_000);
});

test('an unsafe id from idFactory is refused', async () => {
  const { manager } = await testManager({ fetch: fakeFetch({}).fetch, idFactory: () => '../escape' });
  await assert.rejects(manager.start({ url: S }), /not a safe file name/);
});

test('get and wait return copies; unknown ids give null', async () => {
  const { fetch } = fakeFetch({ [`${S}/`]: PAGE });
  const { manager } = await testManager({ fetch });
  const job = await manager.start({ url: S });
  const copy = manager.get(job.id);
  assert.ok(copy);
  copy.status = 'failed';
  assert.notEqual(manager.get(job.id)?.status, 'failed');
  const waited = await manager.wait(job.id, 10_000);
  assert.ok(waited);
  waited.pages_crawled = 999;
  assert.notEqual(manager.get(job.id)?.pages_crawled, 999);
  assert.equal(manager.get('c-unknown'), null);
  assert.equal(await manager.wait('c-unknown', 10), null);
  await assert.rejects(manager.wait(job.id, -1), TypeError);
});

test('wait returns the running job when the timeout passes first, and result is null until the job ends', async () => {
  /** @type {() => void} */
  let release = () => {};
  const gate = new Promise((resolve) => { release = () => resolve(undefined); });
  const inner = fakeFetch({ [`${S}/`]: PAGE });
  /** @type {any} */
  const fetch = async (/** @type {string} */ url, /** @type {any} */ options) => {
    await gate;
    return inner.fetch(url, options);
  };
  const { manager } = await testManager({ fetch });
  const job = await manager.start({ url: S });
  const early = await manager.wait(job.id, 20);
  assert.equal(early?.status, 'running');
  assert.equal(await manager.result(job.id), null);
  release();
  const done = await manager.wait(job.id, 10_000);
  assert.equal(done?.status, 'done');
  assert.ok(await manager.result(job.id));
});

test('a start URL that cannot be fetched fails the job with a clear message', async () => {
  const site = await startServer({
    '/': (_req, res) => res.socket?.destroy(),
    '/away': { redirect: 'http://10.0.0.1/' },
  });
  try {
    const refused = await crawl({ url: `${site.origin}/`, allowLoopback: true });
    assert.equal(refused.job?.status, 'failed');
    assert.match(String(refused.job?.error), /Could not fetch .*connection_error/);
    assert.equal(refused.result, null);
    const redirected = await crawl({ url: `${site.origin}/away`, allowLoopback: true });
    assert.equal(redirected.job?.status, 'failed');
    assert.match(String(redirected.job?.error), /redirects to http:\/\/10\.0\.0\.1\/, which is another origin/);
  } finally {
    await site.close();
  }

  const unresolvable = fakeFetch({ [`${S}/robots.txt`]: { status: 0, error: { code: 'dns_error', message: 'Could not resolve site.test' } } });
  const dns = await crawl({ url: S }, { fetch: unresolvable.fetch });
  assert.equal(dns.job?.status, 'failed');
  assert.match(String(dns.job?.error), /dns_error/);
  assert.equal(unresolvable.calls.length, 1);

  const local = await startServer({ '/': html([]) });
  try {
    const blocked = await crawl({ url: `${local.origin}/` });
    assert.equal(blocked.job?.status, 'failed');
    assert.match(String(blocked.job?.error), /blocked_address/);
    assert.match(String(blocked.job?.error), /localhost/);
    assert.equal(local.requests.length, 0, 'nothing is sent to loopback without allowLoopback');
  } finally {
    await local.close();
  }
});

test('an extractor crash fails the job instead of leaving it running', async () => {
  const { fetch } = fakeFetch({ [`${S}/`]: PAGE });
  const { job } = await crawl({ url: S }, {
    fetch,
    extract: {
      ...fakeExtract,
      extractPage: () => {
        throw new Error('extractor exploded');
      },
    },
  });
  assert.equal(job?.status, 'failed');
  assert.match(String(job?.error), /internal error: extractor exploded/);
});

test('results are written to <dataDir>/crawls/<id>.json and can be read by another manager', async () => {
  const { fetch } = fakeFetch({ [`${S}/`]: PAGE, [`${S}/a`]: PAGE });
  const dataDir = await tempDir();
  const first = await crawl({ url: S }, { fetch, dataDir });
  assert.ok(first.job && first.result);
  const onDisk = JSON.parse(await readFile(path.join(dataDir, 'crawls', `${first.job.id}.json`), 'utf8'));
  assert.deepEqual(onDisk, first.result);
  const other = createCrawlManager({ dataDir });
  assert.deepEqual(await other.result(first.job.id), first.result);
  assert.equal(await other.result('c-missing'), null);
  assert.equal(await other.result('../../etc/passwd'), null);
});

test('blocked crawls have stored results too', async () => {
  const { fetch } = fakeFetch({ [`${S}/robots.txt`]: { status: 500, text: 'down' } });
  const blocked = await crawl({ url: S }, { fetch });
  assert.equal(blocked.job?.status, 'blocked');
  assert.equal(blocked.job?.blocked?.reason, 'robots_unreachable');
  assert.ok(blocked.result);
});

test('a site that refuses connections, including for robots.txt, is blocked as robots_unreachable', async () => {
  const closed = await startServer({});
  const url = `${closed.origin}/`;
  await closed.close();
  const { job, result } = await crawl({ url, allowLoopback: true });
  assert.equal(job?.status, 'blocked');
  assert.deepEqual(result?.blocked, { reason: 'robots_unreachable', url: `${closed.origin}/robots.txt`, status: 0 });
});

test('the last five results stay in memory; older ones come from disk', async () => {
  const { fetch } = fakeFetch({ [`${S}/`]: PAGE });
  const dataDir = await tempDir();
  const { manager } = await testManager({ fetch, dataDir });
  const ids = [];
  for (let i = 0; i < 6; i += 1) {
    const job = await manager.start({ url: S });
    await manager.wait(job.id, 10_000);
    ids.push(job.id);
  }
  await rm(path.join(dataDir, 'crawls'), { recursive: true, force: true });
  assert.equal(await manager.result(ids[0]), null);
  for (const id of ids.slice(1)) assert.equal((await manager.result(id))?.id, id);
});

test('progress is visible while the crawl runs', async () => {
  /** @type {() => void} */
  let release = () => {};
  const gate = new Promise((resolve) => { release = () => resolve(undefined); });
  const inner = fakeFetch({ [`${S}/`]: { headers: { 'content-type': 'text/html' }, text: '<a href="/a">a</a><a href="/b">b</a>' } });
  /** @type {any} */
  const fetch = async (/** @type {string} */ url, /** @type {any} */ options) => {
    if (url === `${S}/a`) await gate;
    return inner.fetch(url, options);
  };
  const { manager } = await testManager({ fetch });
  const job = await manager.start({ url: S });
  for (let i = 0; i < 50 && manager.get(job.id)?.pages_crawled === 0; i += 1) await new Promise((r) => setImmediate(r));
  const snapshot = manager.get(job.id);
  assert.equal(snapshot?.status, 'running');
  assert.equal(snapshot?.pages_crawled, 1);
  assert.equal(snapshot?.pages_queued, 2);
  release();
  assert.equal((await manager.wait(job.id, 10_000))?.status, 'done');
});

test('allowLoopback is refused for a host that is not only loopback', async () => {
  const { manager } = await testManager({ fetch: fakeFetch({}).fetch, lookup: async () => [{ address: '93.184.216.34', family: 4 }] });
  await assert.rejects(manager.start({ url: 'https://example.test/', allowLoopback: true }), (error) => {
    assert.ok(error instanceof TypeError);
    assert.match(error.message, /not a loopback address/);
    return true;
  });
  await assert.rejects(manager.start({ url: 'http://8.8.8.8/', allowLoopback: true }), TypeError);
  const mixed = await testManager({ fetch: fakeFetch({}).fetch, lookup: async () => [{ address: '127.0.0.1', family: 4 }, { address: '10.0.0.5', family: 4 }] });
  await assert.rejects(mixed.manager.start({ url: 'http://dev.test/', allowLoopback: true }), /10\.0\.0\.5/);
  const failing = await testManager({ fetch: fakeFetch({}).fetch, lookup: async () => { throw Object.assign(new Error('nope'), { code: 'ENOTFOUND' }); } });
  await assert.rejects(failing.manager.start({ url: 'http://missing.test/', allowLoopback: true }), TypeError);
});

test('allowLoopback is honoured for a host that is only loopback, by IP or by name', async () => {
  const local = await startServer({ '/': html([]) });
  try {
    const byIp = await crawl({ url: `${local.origin}/`, allowLoopback: true });
    assert.equal(byIp.job?.status, 'done');
    const byName = await crawl({ url: `http://localhost:${local.port}/`, allowLoopback: true }, {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }],
    });
    assert.equal(byName.job?.status, 'done');
  } finally {
    await local.close();
  }
  const { manager } = await testManager({ fetch: fakeFetch({}).fetch, lookup: async () => { throw new Error('not called for a public site'); } });
  const job = await manager.start({ url: S });
  assert.equal(job.status, 'running');
  await manager.wait(job.id, 10_000);
});

test('a local crawl passes its own origin as allowLoopback, never true', async () => {
  const local = await startServer({ '/': html([]) });
  try {
    const { safeFetch } = await import('../../server/src/net/safe-fetch.js');
    /** @type {unknown[]} */
    const seen = [];
    /** @type {typeof safeFetch} */
    const fetch = async (url, options) => {
      seen.push(options?.allowLoopback);
      return safeFetch(url, options);
    };
    await crawl({ url: `${local.origin}/`, allowLoopback: true }, { fetch });
    assert.ok(seen.length > 0);
    assert.ok(seen.every((value) => value === local.origin));
    const publicSite = fakeFetch({ [`${S}/`]: PAGE });
    await crawl({ url: S }, { fetch: publicSite.fetch });
    assert.ok(publicSite.calls.every((c) => c.options.allowLoopback === false));
  } finally {
    await local.close();
  }
});

test('a local site cannot lead the crawler to another local port', async () => {
  const other = await startServer({ '/': html([]), '/secret': html([]) });
  const local = await startServer({
    '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: `Sitemap: ${other.origin}/sitemap.xml\n` },
    '/': html([`${other.origin}/secret`, '/hop']),
    '/hop': { status: 302, redirect: `${other.origin}/` },
  });
  try {
    const { job, result } = await crawl({ url: `${local.origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'done');
    assert.equal(other.requests.length, 0);
    assert.equal(result?.sitemap.files[0].type, 'external');
    assert.equal(result?.pages.find((p) => p.url.endsWith('/hop'))?.final_external, true);
  } finally {
    await local.close();
    await other.close();
  }
});

test('a local start URL that redirects to another origin fails with a clear message', async () => {
  const other = await startServer({ '/': html([]) });
  const local = await startServer({ '/': { status: 301, redirect: `${other.origin}/` } });
  try {
    const { job } = await crawl({ url: `${local.origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'failed');
    assert.match(String(job?.error), /another origin/);
    assert.equal(other.requests.length, 0);
  } finally {
    await local.close();
    await other.close();
  }
});

test('the crawl directory is private and its files are readable only by the user', { skip: MODES_SKIP }, async () => {
  const { fetch } = fakeFetch({ [`${S}/`]: PAGE });
  const dataDir = await tempDir();
  const { job } = await crawl({ url: S }, { fetch, dataDir });
  const dir = path.join(dataDir, 'crawls');
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(dir, `${job?.id}.json`))).mode & 0o777, 0o600);
});

test('only the 20 newest crawl files are kept', async () => {
  const { fetch } = fakeFetch({ [`${S}/`]: PAGE });
  const dataDir = await tempDir();
  let n = 0;
  const { manager } = await testManager({ fetch, dataDir, idFactory: () => `c-keep-${String((n += 1)).padStart(3, '0')}` });
  for (let i = 0; i < 19; i += 1) {
    const job = await manager.start({ url: S });
    await manager.wait(job.id, 10_000);
  }
  assert.equal((await readdir(path.join(dataDir, 'crawls'))).length, 19);
  for (let i = 0; i < 3; i += 1) {
    const job = await manager.start({ url: S });
    await manager.wait(job.id, 10_000);
  }
  const files = (await readdir(path.join(dataDir, 'crawls'))).sort();
  assert.equal(files.length, 20);
  assert.equal(files.at(-1), 'c-keep-022.json');
  assert.equal(files.includes('c-keep-001.json'), false);
});

test('crawl files written before the permission fix are made private when the directory is opened', { skip: MODES_SKIP }, async () => {
  const dataDir = await tempDir();
  const dir = path.join(dataDir, 'crawls');
  await mkdir(dir, { recursive: true });
  await chmod(dir, 0o755);
  const old = path.join(dir, 'c-old.json');
  await writeFile(old, '{}', { mode: 0o644 });
  await chmod(old, 0o644);
  assert.equal((await stat(old)).mode & 0o777, 0o644);

  const reader = createCrawlManager({ dataDir });
  await reader.result('c-old');
  assert.equal((await stat(old)).mode & 0o777, 0o600, 'reading opens the directory');
  assert.equal((await stat(dir)).mode & 0o777, 0o700);

  const later = path.join(dir, 'c-later.json');
  await writeFile(later, '{}', { mode: 0o644 });
  await chmod(later, 0o644);
  const { fetch } = fakeFetch({ [`${S}/`]: PAGE });
  await crawl({ url: S }, { fetch, dataDir });
  assert.equal((await stat(later)).mode & 0o777, 0o600, 'writing opens the directory');
});

test('every regular file in the crawl directory becomes private when it is opened, whatever its name', { skip: MODES_SKIP }, async () => {
  const dataDir = await tempDir();
  const dir = path.join(dataDir, 'crawls');
  await mkdir(dir, { recursive: true });
  const leftovers = ['c-old.json.1234.tmp', 'notes.txt'];
  for (const name of leftovers) {
    await writeFile(path.join(dir, name), '{"pages": []}');
    await chmod(path.join(dir, name), 0o644);
  }
  await createCrawlManager({ dataDir }).result('c-missing');
  for (const name of leftovers) assert.equal((await stat(path.join(dir, name))).mode & 0o777, 0o600, name);
});

test('the cache keeps a recent .tmp file and deletes one older than a day', async () => {
  const dataDir = await tempDir();
  const dir = path.join(dataDir, 'crawls');
  await mkdir(dir, { recursive: true });
  const stale = path.join(dir, 'c-a.json.1.tmp');
  const fresh = path.join(dir, 'c-b.json.2.tmp');
  await writeFile(stale, '{}');
  await writeFile(fresh, '{}');
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(stale, twoDaysAgo, twoDaysAgo);
  const { fetch } = fakeFetch({ [`${S}/`]: PAGE });
  await crawl({ url: S }, { fetch, dataDir });
  const names = await readdir(dir);
  assert.equal(names.includes('c-a.json.1.tmp'), false);
  assert.equal(names.includes('c-b.json.2.tmp'), true);
});
