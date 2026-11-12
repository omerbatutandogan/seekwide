// The polite request layer shared by the crawler and the image and link
// checks: process-wide host gates, a requester's own pacing, cancellation, the
// redirect follower and the shared robots.txt cache.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkImageFiles } from '../../server/src/net/image-check.js';
import { checkExternalLinks } from '../../server/src/net/link-check.js';
import { createHostGates, createPacer, followRedirects, sleep } from '../../server/src/net/polite.js';
import { createRobotsCache } from '../../server/src/net/robots-cache.js';
import { fakeFetch, fetchResult } from './fake-fetch.js';

/** A virtual clock that a fake sleep moves forward, so waits can be measured without waiting. */
function virtualTime() {
  let clock = 0;
  return {
    now: () => clock,
    /** @param {number} ms */
    sleep: async (ms) => {
      clock += ms;
    },
  };
}

test('two requesters of one host are spaced by the host delay; one requester only by its own pacing', async () => {
  const time = virtualTime();
  const hosts = createHostGates({ now: time.now });
  /** @type {{who: string, url: string, at: number}[]} */
  const sent = [];
  /** @param {string} who */
  const requester = (who) => {
    const paced = createPacer({ delayMs: () => 1000, sleep: time.sleep, hosts });
    return (/** @type {string} */ url) => paced(url, async () => {
      sent.push({ who, url, at: time.now() });
      return fetchResult(url);
    });
  };
  const a = requester('a');
  const b = requester('b');
  await Promise.all([a('https://x.test/1'), b('https://x.test/2'), a('https://x.test/3'), b('https://x.test/4'), a('https://y.test/1')]);
  const onX = sent.filter((request) => request.url.startsWith('https://x.test/')).map((request) => request.at);
  assert.equal(onX.length, 4);
  for (let i = 1; i < onX.length; i += 1) assert.ok(onX[i] - onX[i - 1] >= 1000, `x.test requests at ${onX.join(', ')}`);
  // Another host is not held up by x.test.
  assert.equal(sent.find((request) => request.url.startsWith('https://y.test/'))?.at, 0);

  // One requester alone: its own pacing, and no extra wait from the gate.
  /** @type {number[]} */
  const waits = [];
  const alone = createPacer({ delayMs: () => 500, sleep: async (ms) => { waits.push(ms); }, hosts: createHostGates() });
  for (const path of ['/1', '/2', '/3']) await alone(`https://z.test${path}`, async () => fetchResult(`https://z.test${path}`));
  assert.deepEqual(waits, [500, 500]);
});

test('parallel image checks of one site send one request per second to it between them', async () => {
  const time = virtualTime();
  const hosts = createHostGates({ now: time.now });
  /** @type {number[]} */
  const at = [];
  const { fetch } = fakeFetch({
    'https://site.test/robots.txt': { text: 'User-agent: *\nAllow: /\n' },
    ...Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`https://site.test/${i}.jpg`, { headers: { 'content-type': 'image/jpeg', 'content-length': '10' } }])),
  });
  /** @type {typeof fetch} */
  const stamped = async (url, options) => {
    at.push(time.now());
    return fetch(url, options);
  };
  const urls = Array.from({ length: 4 }, (_, i) => `https://site.test/${i}.jpg`);
  const robotsCache = createRobotsCache({ now: time.now });
  await Promise.all(Array.from({ length: 3 }, () => checkImageFiles(urls, { fetch: stamped, sleep: time.sleep, now: time.now, hosts, robotsCache, perHostDelayMs: 1000 })));
  // One robots.txt for all three checks (shared), then 3 x 4 HEAD requests.
  assert.equal(at.length, 13);
  for (let i = 1; i < at.length; i += 1) assert.ok(at[i] - at[i - 1] >= 1000, `requests at ${at.join(', ')}`);
});

test('the link check waits the crawl-delay of a host robots.txt between its requests to that host', async () => {
  /** @type {number[]} */
  const waits = [];
  const { fetch } = fakeFetch({
    'https://slow.test/robots.txt': { text: 'User-agent: *\nCrawl-delay: 4\n' },
    'https://slow.test/a': { status: 200 },
    'https://slow.test/b': { status: 200 },
  });
  await checkExternalLinks(['https://slow.test/a', 'https://slow.test/b'], {
    fetch, perHostDelayMs: 1000, sleep: async (ms) => { waits.push(ms); }, hosts: createHostGates(), robotsCache: createRobotsCache(),
  });
  assert.deepEqual(waits, [4000, 4000]);
});

test('no request starts after the signal fires, and the call rejects with its reason', async () => {
  const controller = new AbortController();
  let requests = 0;
  const { fetch } = fakeFetch({ 'https://a.test/robots.txt': { status: 404, text: '' } });
  /** @type {typeof fetch} */
  const counting = async (url, options) => {
    requests += 1;
    if (requests === 2) controller.abort(new Error('cancelled by the client'));
    return fetch(url, options);
  };
  const urls = ['https://a.test/1', 'https://a.test/2', 'https://a.test/3'];
  await assert.rejects(checkExternalLinks(urls, { fetch: counting, sleep: async () => {}, signal: controller.signal, hosts: createHostGates() }), /cancelled by the client/);
  assert.equal(requests, 2);
  await assert.rejects(sleep(10_000, controller.signal), /cancelled by the client/);
  const later = new AbortController();
  const waiting = sleep(10_000, later.signal);
  later.abort(new Error('stop'));
  await assert.rejects(waiting, /stop/);
});

test('the redirect follower stops where the caller says and names each ending', async () => {
  const answers = {
    'https://a.test/1': fetchResult('https://a.test/1', { status: 301, headers: { location: '/2' } }),
    'https://a.test/2': fetchResult('https://a.test/2', { status: 302, headers: { location: 'https://a.test/1' } }),
    'https://a.test/3': fetchResult('https://a.test/3', { status: 301 }),
    'https://a.test/4': fetchResult('https://a.test/4', { status: 200 }),
    'https://a.test/5': fetchResult('https://a.test/5', { status: 301, headers: { location: '/6' } }),
    'https://a.test/6': fetchResult('https://a.test/6', { status: 301, headers: { location: '/7' } }),
  };
  /** @param {string} url */
  const request = async (url) => /** @type {Record<string, any>} */ (answers)[url] ?? fetchResult(url, { status: 404 });
  const loop = await followRedirects('https://a.test/1', { maxHops: 5, request });
  assert.deepEqual([loop.kind, loop.url, loop.hops.length], ['loop', 'https://a.test/2', 2]);
  assert.equal((await followRedirects('https://a.test/3', { maxHops: 5, request })).kind, 'invalid');
  // A loop is named before the limit, as every follower did.
  assert.equal((await followRedirects('https://a.test/1', { maxHops: 1, request })).kind, 'loop');
  const many = await followRedirects('https://a.test/5', { maxHops: 1, request });
  assert.deepEqual([many.kind, many.kind === 'too_many' && many.target], ['too_many', 'https://a.test/7']);
  const stopped = await followRedirects('https://a.test/1', { maxHops: 5, request, before: (url, hop) => (hop === 1 ? `stop at ${url}` : undefined) });
  assert.deepEqual(stopped.kind === 'stopped' && stopped.value, 'stop at https://a.test/2');
  assert.equal((await followRedirects('https://a.test/4', { maxHops: 5, request })).kind, 'response');
  assert.equal((await followRedirects('https://a.test/4', { maxHops: 5, request: async () => null })).kind, 'unsent');
});

test('robots.txt is shared for ten minutes between requesters of one transport, never for a local site', async () => {
  let clock = 0;
  const cache = createRobotsCache({ now: () => clock });
  const fetch = async () => fetchResult('https://a.test/robots.txt');
  let loads = 0;
  const load = async () => {
    loads += 1;
    return /** @type {any} */ ({ robots: { loads }, firstError: null, complete: true });
  };
  await cache.get({ origin: 'https://a.test', fetch, shared: true }, load);
  await cache.get({ origin: 'https://a.test', fetch, shared: true }, load);
  assert.equal(loads, 1);
  await cache.get({ origin: 'https://a.test', fetch: async () => fetchResult('https://a.test/robots.txt'), shared: true }, load);
  assert.equal(loads, 2, 'another transport reads its own');
  await cache.get({ origin: 'http://localhost:3000', fetch, shared: false }, load);
  await cache.get({ origin: 'http://localhost:3000', fetch, shared: false }, load);
  assert.equal(loads, 4, 'a local site is read every time');
  await cache.get({ origin: 'https://a.test', fetch, shared: true, fresh: true }, load);
  assert.equal(loads, 5, 'a crawl reads it again');
  clock += 10 * 60 * 1000;
  await cache.get({ origin: 'https://a.test', fetch, shared: true }, load);
  assert.equal(loads, 6, 'after ten minutes it is read again');
});

test('a read that was cut short or failed is not handed to another requester', async () => {
  const cache = createRobotsCache();
  const fetch = async () => fetchResult('https://a.test/robots.txt');
  const short = await cache.get({ origin: 'https://a.test', fetch, shared: true }, async () => /** @type {any} */ ({ robots: 'short', firstError: null, complete: false }));
  assert.equal(short.robots, 'short');
  const next = await cache.get({ origin: 'https://a.test', fetch, shared: true }, async () => /** @type {any} */ ({ robots: 'whole', firstError: null, complete: true }));
  assert.equal(next.robots, 'whole');
  // A read in progress that another requester's cancellation ends is read again by the one still waiting.
  /** @type {(reason: Error) => void} */
  let fail = () => {};
  const first = cache.get({ origin: 'https://b.test', fetch, shared: true }, () => new Promise((resolve, reject) => {
    fail = reject;
  }));
  const second = cache.get({ origin: 'https://b.test', fetch, shared: true }, async () => /** @type {any} */ ({ robots: 'own', firstError: null, complete: true }));
  fail(new Error('cancelled'));
  await assert.rejects(first, /cancelled/);
  assert.equal((await second).robots, 'own');
});

test('when the first reader of a shared robots.txt is cancelled, the requesters waiting for it read it once between them', async () => {
  const cache = createRobotsCache();
  const fetch = async () => fetchResult('https://a.test/robots.txt');
  let reads = 0;
  /** @type {(reason: Error) => void} */
  let fail = () => {};
  const first = cache.get({ origin: 'https://a.test', fetch, shared: true }, () => new Promise((resolve, reject) => {
    fail = reject;
  }));
  const load = async () => {
    reads += 1;
    return /** @type {any} */ ({ robots: 'again', firstError: null, complete: true });
  };
  const waiting = Array.from({ length: 5 }, () => cache.get({ origin: 'https://a.test', fetch, shared: true }, load));
  fail(new Error('cancelled'));
  await assert.rejects(first, /cancelled/);
  const reads5 = await Promise.all(waiting);
  assert.deepEqual(reads5.map((read) => read.robots), ['again', 'again', 'again', 'again', 'again']);
  assert.equal(reads, 1);
});
