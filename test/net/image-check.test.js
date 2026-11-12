import assert from 'node:assert/strict';
import { test } from 'node:test';

import { USER_AGENT } from '../../server/src/config.js';
import { IMAGE_ACCEPT, checkImageFiles, fileSize } from '../../server/src/net/image-check.js';
import { startServer } from '../helpers/http-server.js';
import { fakeFetch, fetchResult } from './fake-fetch.js';

const A = 'https://a.test';
const noSleep = async () => {};
const ROBOTS_OPEN = { text: 'User-agent: *\nAllow: /\n' };

/** @param {string} type @param {number} length */
const image = (type, length) => ({ headers: { 'content-type': type, 'content-length': String(length) } });

test('robots.txt is read first, then one HEAD that accepts AVIF and WebP gives the type and size', async () => {
  const { fetch, calls } = fakeFetch({ [`${A}/robots.txt`]: ROBOTS_OPEN, [`${A}/a.jpg`]: image('image/jpeg; charset=binary', 48_000) });
  const results = await checkImageFiles([`${A}/a.jpg`], { fetch, sleep: noSleep });
  assert.deepEqual(calls.map((call) => [call.url, call.options.method]), [[`${A}/robots.txt`, 'GET'], [`${A}/a.jpg`, 'HEAD']]);
  assert.equal(calls[1].options.headers.accept, IMAGE_ACCEPT);
  assert.equal(calls[1].options.maxRedirects, 0);
  assert.deepEqual(results.get(`${A}/a.jpg`), {
    url: `${A}/a.jpg`, outcome: 'ok', status: 200, reason: null, final_url: null, content_type: 'image/jpeg', bytes: 48_000, vary: null,
    modern_accepted: true, google: 'allowed', google_agent: null, google_host: null,
  });
});

test('a HEAD without a size is followed by one GET for the first byte, which reads at most 1 KiB', async () => {
  /** @type {any[]} */
  const calls = [];
  /** @type {typeof import('../../server/src/net/safe-fetch.js').safeFetch} */
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/robots.txt')) return fetchResult(url, { status: 404 });
    if (options.method === 'HEAD') return fetchResult(url, { headers: { 'content-type': 'image/png' } });
    return fetchResult(url, { status: 206, headers: { 'content-type': 'image/png', 'content-range': 'bytes 0-0/123456' } });
  };
  const result = (await checkImageFiles([`${A}/b.png`], { fetch, sleep: noSleep })).get(`${A}/b.png`);
  const get = calls.find((call) => call.options.method === 'GET' && call.url.endsWith('.png'));
  assert.equal(get.options.headers.range, 'bytes=0-0');
  assert.ok(get.options.maxBytes <= 1024);
  assert.deepEqual([result?.outcome, result?.bytes, result?.content_type], ['ok', 123_456, 'image/png']);
  assert.equal(calls.length, 3, 'robots.txt, the HEAD and one GET');
});

test('a HEAD the server refuses is retried once with the ranged GET; a GET that does worse keeps the HEAD answer', async () => {
  /** @type {typeof import('../../server/src/net/safe-fetch.js').safeFetch} */
  const fetch = async (url, options = {}) => {
    if (url.endsWith('/robots.txt')) return fetchResult(url, { status: 404 });
    if (url.endsWith('/head-405.webp')) return options.method === 'HEAD' ? fetchResult(url, { status: 405 }) : fetchResult(url, { status: 200, headers: { 'content-type': 'image/webp', 'content-length': '900' } });
    return options.method === 'HEAD' ? fetchResult(url, { headers: { 'content-type': 'image/gif' } }) : fetchResult(url, { status: 500 });
  };
  const results = await checkImageFiles([`${A}/head-405.webp`, `${A}/no-size.gif`], { fetch, sleep: noSleep });
  assert.deepEqual([results.get(`${A}/head-405.webp`)?.outcome, results.get(`${A}/head-405.webp`)?.bytes], ['ok', 900]);
  assert.deepEqual([results.get(`${A}/no-size.gif`)?.outcome, results.get(`${A}/no-size.gif`)?.bytes, results.get(`${A}/no-size.gif`)?.status], ['ok', null, 200]);
});

test('404, 410 and a host name that does not exist are broken; refusals and server errors cannot be verified', async () => {
  const { fetch } = fakeFetch({
    [`${A}/robots.txt`]: ROBOTS_OPEN,
    [`${A}/gone.jpg`]: { status: 410 },
    [`${A}/refused.jpg`]: { status: 403 },
    [`${A}/error.jpg`]: { status: 503 },
    'https://nx.test/robots.txt': { status: 0, error: { code: 'dns_error', message: 'nx' } },
  });
  const results = await checkImageFiles([`${A}/missing.jpg`, `${A}/gone.jpg`, `${A}/refused.jpg`, `${A}/error.jpg`, 'https://nx.test/a.jpg'], { fetch, sleep: noSleep });
  assert.deepEqual([...results.values()].map((r) => [r.outcome, r.reason]), [
    ['broken', 'status_404'], ['broken', 'status_410'], ['unverifiable', 'status_403'], ['unverifiable', 'status_503'], ['broken', 'dns_error'],
  ]);
  assert.equal(results.get('https://nx.test/a.jpg')?.google, null, 'without a robots.txt nothing is known about Google');
});

test('robots.txt that disallows the crawler keeps the image from being requested; what it says to Google is still read', async () => {
  const { fetch, calls } = fakeFetch({
    [`${A}/robots.txt`]: { text: 'User-agent: seekwide\nDisallow: /private/\n\nUser-agent: Googlebot\nDisallow: /cdn/\n\nUser-agent: Googlebot-Image\nDisallow: /photos/\n' },
    [`${A}/cdn/a.jpg`]: image('image/jpeg', 10),
    [`${A}/photos/b.jpg`]: image('image/jpeg', 10),
  });
  const results = await checkImageFiles([`${A}/private/x.jpg`, `${A}/cdn/a.jpg`, `${A}/photos/b.jpg`], { fetch, sleep: noSleep });
  assert.ok(!calls.some((call) => call.url.includes('/private/')));
  assert.deepEqual([results.get(`${A}/private/x.jpg`)?.outcome, results.get(`${A}/private/x.jpg`)?.google], ['disallowed', 'allowed']);
  assert.deepEqual([results.get(`${A}/cdn/a.jpg`)?.google, results.get(`${A}/cdn/a.jpg`)?.google_agent, results.get(`${A}/cdn/a.jpg`)?.google_host], ['disallowed', 'Googlebot', 'a.test']);
  assert.deepEqual([results.get(`${A}/photos/b.jpg`)?.google, results.get(`${A}/photos/b.jpg`)?.google_agent], ['disallowed', 'Googlebot-Image']);
  assert.equal(results.get(`${A}/photos/b.jpg`)?.outcome, 'ok');
});

test('a robots.txt that cannot be read makes the image unverifiable without a request', async () => {
  const { fetch, calls } = fakeFetch({ [`${A}/robots.txt`]: { status: 503 } });
  const result = (await checkImageFiles([`${A}/a.jpg`], { fetch, sleep: noSleep })).get(`${A}/a.jpg`);
  assert.deepEqual([result?.outcome, result?.google], ['unverifiable', null]);
  assert.deepEqual(calls.map((call) => call.url), [`${A}/robots.txt`]);
});

test('redirects are followed by hand, each step after its own robots.txt, and Google must be allowed at every step', async () => {
  const { fetch, calls } = fakeFetch({
    [`${A}/robots.txt`]: ROBOTS_OPEN,
    [`${A}/old.jpg`]: { status: 301, headers: { location: 'https://cdn.test/new.jpg' } },
    'https://cdn.test/robots.txt': { text: 'User-agent: Googlebot-Image\nDisallow: /\n' },
    'https://cdn.test/new.jpg': image('image/avif', 70_000),
    [`${A}/loop.jpg`]: { status: 302, headers: { location: `${A}/loop.jpg` } },
  });
  const results = await checkImageFiles([`${A}/old.jpg`, `${A}/loop.jpg`], { fetch, sleep: noSleep });
  const moved = results.get(`${A}/old.jpg`);
  assert.deepEqual([moved?.outcome, moved?.final_url, moved?.content_type, moved?.google, moved?.google_host], ['ok', 'https://cdn.test/new.jpg', 'image/avif', 'disallowed', 'cdn.test']);
  assert.ok(calls.findIndex((call) => call.url === 'https://cdn.test/robots.txt') < calls.findIndex((call) => call.url === 'https://cdn.test/new.jpg'));
  assert.deepEqual([results.get(`${A}/loop.jpg`)?.outcome, results.get(`${A}/loop.jpg`)?.reason, results.get(`${A}/loop.jpg`)?.google], ['unverifiable', 'redirect_loop', null]);
});

test('with onlyOrigin nothing on another origin is requested: no image, no robots.txt, no redirect step', async () => {
  const local = 'http://localhost:4000';
  const { fetch, calls } = fakeFetch({
    [`${local}/robots.txt`]: ROBOTS_OPEN,
    [`${local}/a.jpg`]: image('image/jpeg', 10),
    [`${local}/away.jpg`]: { status: 302, headers: { location: 'https://cdn.test/away.jpg' } },
  });
  const results = await checkImageFiles([`${local}/a.jpg`, 'https://cdn.test/b.jpg', `${local}/away.jpg`], { fetch, sleep: noSleep, onlyOrigin: local });
  assert.ok(calls.every((call) => call.url.startsWith(local)), JSON.stringify(calls.map((call) => call.url)));
  assert.deepEqual([...results.values()].map((r) => r.outcome), ['ok', 'unverifiable', 'unverifiable']);
  assert.equal(results.get('https://cdn.test/b.jpg')?.google, null);
});

test('with onlyOrigin a robots.txt that redirects away is not followed, so the images of that origin are unverifiable', async () => {
  const local = 'http://localhost:4000';
  const { fetch, calls } = fakeFetch({ [`${local}/robots.txt`]: { status: 301, headers: { location: 'https://elsewhere.test/robots.txt' } } });
  const result = (await checkImageFiles([`${local}/a.jpg`], { fetch, sleep: noSleep, onlyOrigin: local })).get(`${local}/a.jpg`);
  assert.equal(result?.outcome, 'unverifiable');
  assert.deepEqual(calls.map((call) => call.url), [`${local}/robots.txt`]);
});

test('requests to one host are paced, at least the crawl-delay of its robots.txt apart (capped), hosts in parallel', async () => {
  /** @type {number[]} */
  const waits = [];
  const sleep = async (/** @type {number} */ ms) => {
    waits.push(ms);
  };
  const { fetch } = fakeFetch({
    [`${A}/robots.txt`]: { text: 'User-agent: *\nCrawl-delay: 60\n' },
    [`${A}/1.jpg`]: image('image/jpeg', 10),
    [`${A}/2.jpg`]: image('image/jpeg', 10),
    'https://b.test/robots.txt': ROBOTS_OPEN,
    'https://b.test/1.jpg': image('image/jpeg', 10),
  });
  await checkImageFiles([`${A}/1.jpg`, `${A}/2.jpg`, 'https://b.test/1.jpg'], { fetch, sleep, perHostDelayMs: 500 });
  // a.test: robots.txt, then 1.jpg and 2.jpg each 10 s (the cap) after the one before; b.test: its image 500 ms after its robots.txt.
  assert.deepEqual(waits.sort((x, y) => x - y), [500, 10_000, 10_000]);
});

test('no request starts after the deadline; the rest is not checked', async () => {
  let clock = 0;
  const { fetch, calls } = fakeFetch({ [`${A}/robots.txt`]: ROBOTS_OPEN, [`${A}/1.jpg`]: image('image/jpeg', 10), [`${A}/2.jpg`]: image('image/jpeg', 10) });
  const results = await checkImageFiles([`${A}/1.jpg`, `${A}/2.jpg`, `${A}/3.jpg`], {
    fetch, now: () => clock, deadlineMs: 5000, sleep: async (ms) => {
      clock += ms * 3;
    }, perHostDelayMs: 1000,
  });
  assert.deepEqual([...results.values()].map((r) => r.outcome), ['ok', 'not_checked', 'not_checked']);
  assert.deepEqual(calls.map((call) => call.url), [`${A}/robots.txt`, `${A}/1.jpg`]);
  assert.equal(results.get(`${A}/2.jpg`)?.google, null);
});

test('URLs are de-duplicated in order, at most maxImages are checked, and the options are validated', async () => {
  const { fetch } = fakeFetch({ [`${A}/robots.txt`]: ROBOTS_OPEN });
  const results = await checkImageFiles([`${A}/b.jpg`, `${A}/a.jpg`, `${A}/b.jpg`, `${A}/c.jpg`], { fetch, sleep: noSleep, maxImages: 2 });
  assert.deepEqual([...results.keys()], [`${A}/b.jpg`, `${A}/a.jpg`]);
  await assert.rejects(checkImageFiles([], { maxImages: -1 }), TypeError);
  await assert.rejects(checkImageFiles([], { concurrency: 0 }), TypeError);
  await assert.rejects(checkImageFiles([], { deadlineMs: Number.NaN }), TypeError);
  await assert.rejects(checkImageFiles(/** @type {any} */ ('x')), TypeError);
});

test('fileSize reads the total of a range, the length of a 200, and nothing from a HEAD that says 0', () => {
  assert.equal(fileSize(fetchResult('u', { status: 206, headers: { 'content-range': 'bytes 0-0/5000' } }), 'GET'), 5000);
  assert.equal(fileSize(fetchResult('u', { status: 206, headers: { 'content-range': 'bytes 0-0/*' } }), 'GET'), null);
  assert.equal(fileSize(fetchResult('u', { headers: { 'content-length': '0' } }), 'HEAD'), null);
  assert.equal(fileSize(fetchResult('u', { headers: { 'content-length': '0' } }), 'GET'), 0);
  assert.equal(fileSize(fetchResult('u', { headers: { 'content-length': '12abc' } }), 'HEAD'), null);
});

test('against a real server: the crawler names itself, asks for one byte, and never downloads a whole image', async () => {
  let written = 0;
  let closed = false;
  const server = await startServer({
    '/robots.txt': { body: 'User-agent: *\nAllow: /\n', headers: { 'content-type': 'text/plain' } },
    // HEAD gives no size, and the GET ignores the range and sends 50 MB.
    '/big.jpg': (req, res) => {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      res.on('close', () => {
        closed = true;
      });
      const chunk = Buffer.alloc(64 * 1024);
      const pump = () => {
        while (!closed && written < 50 * 1024 * 1024) {
          written += chunk.length;
          if (!res.write(chunk)) {
            res.once('drain', pump);
            return;
          }
        }
        if (!closed) res.end();
      };
      pump();
    },
  });
  try {
    const results = await checkImageFiles([`${server.origin}/big.jpg`], { sleep: noSleep, fetchOptions: { allowLoopback: true } });
    assert.equal(results.get(`${server.origin}/big.jpg`)?.outcome, 'ok');
    const requests = server.requests.filter((request) => request.url === '/big.jpg');
    assert.deepEqual(requests.map((request) => request.method), ['HEAD', 'GET']);
    for (const request of requests) {
      assert.equal(request.headers['user-agent'], USER_AGENT);
      assert.equal(request.headers.accept, IMAGE_ACCEPT);
    }
    assert.equal(requests[1].headers.range, 'bytes=0-0');
    assert.ok(written < 50 * 1024 * 1024, `the server wrote ${written} bytes before the crawler hung up`);
  } finally {
    await server.close();
  }
});
