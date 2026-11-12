import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkExternalLinks } from '../../server/src/net/link-check.js';
import { createHostGates } from '../../server/src/net/polite.js';
import { startServer } from '../helpers/http-server.js';
import { fetchResult } from './fake-fetch.js';

/** @import { FetchResult } from '../../server/src/types.js' */

const noSleep = async () => {};

/**
 * A fake fetch whose answer depends on the URL and method. robots.txt answers
 * 404 (everything allowed) unless `robots` says otherwise; those requests are
 * kept apart in `robotsCalls`.
 * @param {(url: string, method: string) => Partial<FetchResult>} answer
 * @param {(url: string) => Partial<FetchResult> & {text?: string}} [robots]
 */
function scripted(answer, robots = () => ({ status: 404, text: 'none' })) {
  /** @type {{url: string, method: string, options: any}[]} */
  const calls = [];
  /** @type {string[]} */
  const robotsCalls = [];
  /** @param {string} url @param {any} options */
  const fetch = async (url, options) => {
    if (url.endsWith('/robots.txt')) {
      robotsCalls.push(url);
      return fetchResult(url, robots(url));
    }
    calls.push({ url, method: options.method, options });
    return fetchResult(url, answer(url, options.method));
  };
  return { fetch, calls, robotsCalls };
}

test('a status below 400 is ok and needs no GET', async () => {
  const { fetch, calls } = scripted(() => ({ status: 200 }));
  const results = await checkExternalLinks(['https://a.test/x'], { fetch, sleep: noSleep });
  assert.deepEqual(results.get('https://a.test/x'), { url: 'https://a.test/x', status: 200, outcome: 'ok', reason: null, final_url: 'https://a.test/x' });
  assert.deepEqual(calls.map((c) => c.method), ['HEAD']);
});

test('a failed HEAD is retried once with GET and a small maxBytes', async () => {
  const { fetch, calls } = scripted((_url, method) => ({ status: method === 'HEAD' ? 405 : 200 }));
  const results = await checkExternalLinks(['https://a.test/x'], { fetch, sleep: noSleep, fetchOptions: { allowLoopback: true } });
  assert.equal(results.get('https://a.test/x')?.outcome, 'ok');
  const options = calls.map((c) => c.options);
  assert.deepEqual(options.map((o) => o.method), ['HEAD', 'GET']);
  assert.ok(options[1].maxBytes <= 16 * 1024);
  assert.equal(options[1].allowLoopback, true);
});

test('404, 410 and a name that does not exist are broken', async () => {
  const { fetch } = scripted((url) => {
    if (url.endsWith('/404')) return { status: 404 };
    if (url.endsWith('/410')) return { status: 410 };
    return { status: 0, error: { code: 'dns_error', message: 'not found' } };
  });
  const results = await checkExternalLinks(['https://a.test/404', 'https://a.test/410', 'https://nxdomain.test/'], { fetch, sleep: noSleep });
  assert.deepEqual([...results.values()].map((r) => [r.outcome, r.reason]), [
    ['broken', 'status_404'], ['broken', 'status_410'], ['broken', 'dns_error'],
  ]);
  assert.equal(results.get('https://nxdomain.test/')?.final_url, null);
});

test('refusals, server errors, timeouts, TLS, connection and blocked-address failures are unverifiable', async () => {
  /** @type {Record<string, Partial<FetchResult>>} */
  const answers = {
    'https://a.test/401': { status: 401 },
    'https://a.test/403': { status: 403 },
    'https://a.test/429': { status: 429 },
    'https://a.test/500': { status: 500 },
    'https://a.test/503': { status: 503 },
    'https://b.test/': { status: 0, error: { code: 'timeout', message: '' } },
    'https://c.test/': { status: 0, error: { code: 'tls_error', message: '' } },
    'https://d.test/': { status: 0, error: { code: 'connection_error', message: '' } },
    'https://e.test/': { status: 0, error: { code: 'blocked_address', message: '' } },
    'https://f.test/': { status: 0, error: { code: 'dns_temporary', message: '' } },
  };
  const { fetch } = scripted((url) => answers[url]);
  const results = await checkExternalLinks(Object.keys(answers), { fetch, sleep: noSleep });
  for (const [url, result] of results) assert.equal(result.outcome, 'unverifiable', url);
  assert.equal(results.get('https://a.test/403')?.reason, 'status_403');
  assert.equal(results.get('https://b.test/')?.reason, 'timeout');
  assert.equal(results.get('https://f.test/')?.reason, 'dns_temporary');
});

test('de-duplicates in the order given and checks only the first maxLinks; the map is in that order', async () => {
  const { fetch, calls } = scripted(() => ({ status: 200 }));
  const urls = ['https://c.test/', 'https://a.test/2', 'https://a.test/1', 'https://c.test/', 'https://b.test/'];
  const results = await checkExternalLinks(urls, { fetch, sleep: noSleep, maxLinks: 3 });
  assert.deepEqual([...results.keys()], ['https://c.test/', 'https://a.test/2', 'https://a.test/1']);
  assert.deepEqual(calls.map((c) => c.url).sort(), ['https://a.test/1', 'https://a.test/2', 'https://c.test/']);
});

test('requests to one host are sequential and perHostDelayMs apart, including the GET retry', async () => {
  /** @type {number[]} */
  const sleeps = [];
  const { fetch, calls } = scripted((url, method) => ({ status: url.endsWith('/bad') && method === 'HEAD' ? 405 : 200 }));
  await checkExternalLinks(['https://a.test/1', 'https://a.test/bad'], {
    fetch, perHostDelayMs: 750, sleep: async (ms) => { sleeps.push(ms); }, hosts: createHostGates(),
  });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), ['HEAD https://a.test/1', 'HEAD https://a.test/bad', 'GET https://a.test/bad']);
  assert.deepEqual(sleeps, [750, 750, 750], 'robots.txt, then each of the three requests, all paced');
});

test('different hosts run in parallel up to concurrency; one host never runs twice at once', async () => {
  const active = new Map();
  let maxTotal = 0;
  let maxPerHost = 0;
  /** @param {string} url */
  const fetch = async (url) => {
    const host = new URL(url).hostname;
    active.set(host, (active.get(host) ?? 0) + 1);
    const total = [...active.values()].reduce((a, b) => a + b, 0);
    maxTotal = Math.max(maxTotal, total);
    maxPerHost = Math.max(maxPerHost, active.get(host));
    await new Promise((resolve) => setImmediate(resolve));
    active.set(host, active.get(host) - 1);
    return fetchResult(url, { status: 200 });
  };
  const urls = ['a', 'b', 'c', 'd', 'e'].flatMap((h) => [`https://${h}.test/1`, `https://${h}.test/2`]);
  const results = await checkExternalLinks(urls, { fetch, sleep: noSleep, concurrency: 2 });
  assert.equal(results.size, 10);
  assert.equal(maxTotal, 2);
  assert.equal(maxPerHost, 1);
});

test('invalid options throw TypeError', async () => {
  await assert.rejects(checkExternalLinks(/** @type {any} */ ('x')), TypeError);
  await assert.rejects(checkExternalLinks([], { concurrency: 0 }), TypeError);
  await assert.rejects(checkExternalLinks([], { maxLinks: -1 }), TypeError);
  await assert.rejects(checkExternalLinks([], { perHostDelayMs: -5 }), TypeError);
});

test('works end to end with safeFetch against a local server', async () => {
  const server = await startServer({
    '/ok': { body: 'fine' },
    '/head-refused': (req, res) => {
      res.writeHead(req.method === 'HEAD' ? 405 : 200, { 'content-type': 'text/html' });
      res.end(req.method === 'HEAD' ? undefined : 'fine');
    },
    '/forbidden': { status: 403, body: 'no robots' },
  });
  try {
    const urls = ['/ok', '/missing', '/head-refused', '/forbidden'].map((p) => `${server.origin}${p}`);
    const results = await checkExternalLinks(urls, { fetchOptions: { allowLoopback: true }, sleep: noSleep });
    assert.deepEqual(Object.fromEntries([...results].map(([u, r]) => [u.replace(server.origin, ''), r.outcome])), {
      '/ok': 'ok', '/missing': 'broken', '/head-refused': 'ok', '/forbidden': 'unverifiable',
    });
    const methods = server.requests.map((r) => `${r.method} ${r.url}`);
    assert.deepEqual(methods, ['GET /robots.txt', 'HEAD /ok', 'HEAD /missing', 'GET /missing', 'HEAD /head-refused', 'GET /head-refused', 'HEAD /forbidden', 'GET /forbidden']);
  } finally {
    await server.close();
  }
});

test('without allowLoopback a loopback link is unverifiable, never fetched', async () => {
  const server = await startServer({ '/ok': { body: 'fine' } });
  try {
    const results = await checkExternalLinks([`${server.origin}/ok`], { sleep: noSleep });
    assert.equal(results.get(`${server.origin}/ok`)?.outcome, 'unverifiable');
    assert.equal(results.get(`${server.origin}/ok`)?.reason, 'robots.txt could not be read');
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
  }
});

test('robots.txt is read once per origin, before the first request to it', async () => {
  const { fetch, calls, robotsCalls } = scripted(() => ({ status: 200 }));
  await checkExternalLinks(['https://a.test/1', 'https://a.test/2', 'http://a.test/3', 'https://b.test/'], { fetch, sleep: noSleep, concurrency: 1 });
  assert.deepEqual(robotsCalls, ['https://a.test/robots.txt', 'http://a.test/robots.txt', 'https://b.test/robots.txt']);
  assert.equal(calls.length, 4);
});

test('a URL disallowed by the host robots.txt is unverifiable and never requested; allowed URLs are checked', async () => {
  const { fetch, calls } = scripted(() => ({ status: 200 }), () => ({ status: 200, text: 'User-agent: *\nDisallow: /private\n' }));
  const results = await checkExternalLinks(['https://a.test/private/x', 'https://a.test/public'], { fetch, sleep: noSleep });
  assert.deepEqual(results.get('https://a.test/private/x'), { url: 'https://a.test/private/x', status: 0, outcome: 'unverifiable', reason: 'Disallowed by robots.txt', final_url: null });
  assert.equal(results.get('https://a.test/public')?.outcome, 'ok');
  assert.deepEqual(calls.map((c) => c.url), ['https://a.test/public']);
});

test('an unreadable robots.txt makes that host unverifiable; a missing one allows everything', async () => {
  const down = scripted(() => ({ status: 404 }), () => ({ status: 503, text: 'down' }));
  const unreadable = await checkExternalLinks(['https://a.test/x'], { fetch: down.fetch, sleep: noSleep });
  assert.equal(unreadable.get('https://a.test/x')?.outcome, 'unverifiable');
  assert.equal(unreadable.get('https://a.test/x')?.reason, 'robots.txt could not be read');
  assert.equal(down.calls.length, 0);

  const missing = scripted(() => ({ status: 404 }));
  const checked = await checkExternalLinks(['https://a.test/x'], { fetch: missing.fetch, sleep: noSleep });
  assert.equal(checked.get('https://a.test/x')?.outcome, 'broken');
});

test('a host whose name does not exist is broken; a temporary DNS failure on robots.txt is unverifiable', async () => {
  const missing = scripted(() => ({ status: 200 }), () => ({ status: 0, error: { code: 'dns_error', message: 'no such host' } }));
  const gone = await checkExternalLinks(['https://gone.test/x'], { fetch: missing.fetch, sleep: noSleep });
  assert.deepEqual(gone.get('https://gone.test/x'), { url: 'https://gone.test/x', status: 0, outcome: 'broken', reason: 'dns_error', final_url: null });

  const flaky = scripted(() => ({ status: 200 }), () => ({ status: 0, error: { code: 'dns_temporary', message: 'try later' } }));
  const later = await checkExternalLinks(['https://flaky.test/x'], { fetch: flaky.fetch, sleep: noSleep });
  assert.equal(later.get('https://flaky.test/x')?.outcome, 'unverifiable');
});

/**
 * A fake fetch for redirect chains: `table` maps a URL to its answer; robots.txt
 * answers come from `robots` (404 by default). Every call is recorded.
 * @param {Record<string, Partial<FetchResult>>} table
 * @param {Record<string, Partial<FetchResult> & {text?: string}>} [robots]
 */
function chainFetch(table, robots = {}) {
  /** @type {{url: string, method: string, maxRedirects: number}[]} */
  const calls = [];
  /** @param {string} url @param {any} options */
  const fetch = async (url, options) => {
    calls.push({ url, method: options.method, maxRedirects: options.maxRedirects });
    if (url.endsWith('/robots.txt')) return fetchResult(url, robots[url] ?? { status: 404, text: 'none' });
    return fetchResult(url, table[url] ?? { status: 404 });
  };
  return { fetch, calls };
}
/** @param {string} to */
const moved = (to) => ({ status: 301, headers: { location: to } });

test('redirects are followed by hand, one request per hop, reading each new origin robots.txt once', async () => {
  const { fetch, calls } = chainFetch({
    'https://a.test/x': moved('https://b.test/y'),
    'https://b.test/y': moved('/z'),
    'https://b.test/z': { status: 200 },
  });
  const results = await checkExternalLinks(['https://a.test/x'], { fetch, sleep: noSleep });
  assert.deepEqual(results.get('https://a.test/x'), { url: 'https://a.test/x', status: 200, outcome: 'ok', reason: null, final_url: 'https://b.test/z' });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url}`), [
    'GET https://a.test/robots.txt', 'HEAD https://a.test/x', 'GET https://b.test/robots.txt', 'HEAD https://b.test/y', 'HEAD https://b.test/z',
  ]);
  assert.ok(calls.filter((c) => !c.url.endsWith('robots.txt')).every((c) => c.maxRedirects === 0));
});

test('a hop that robots.txt disallows makes the link unverifiable and is not requested', async () => {
  const { fetch, calls } = chainFetch(
    { 'https://a.test/x': moved('https://b.test/private/y') },
    { 'https://b.test/robots.txt': { status: 200, text: 'User-agent: *\nDisallow: /private\n' } },
  );
  const results = await checkExternalLinks(['https://a.test/x'], { fetch, sleep: noSleep });
  assert.equal(results.get('https://a.test/x')?.outcome, 'unverifiable');
  assert.equal(results.get('https://a.test/x')?.reason, 'Disallowed by robots.txt');
  assert.equal(calls.some((c) => c.url === 'https://b.test/private/y'), false);
});

test('a hop whose robots.txt cannot be read makes the link unverifiable', async () => {
  const { fetch, calls } = chainFetch(
    { 'https://a.test/x': moved('https://b.test/y') },
    { 'https://b.test/robots.txt': { status: 500, text: 'down' } },
  );
  const results = await checkExternalLinks(['https://a.test/x'], { fetch, sleep: noSleep });
  assert.equal(results.get('https://a.test/x')?.reason, 'robots.txt could not be read');
  assert.equal(calls.some((c) => c.url === 'https://b.test/y'), false);
});

test('follows at most 5 redirects; a sixth is unverifiable and not requested', async () => {
  /** @param {number} count */
  const chainOf = (count) => {
    /** @type {Record<string, Partial<FetchResult>>} */
    const table = {};
    for (let i = 0; i < count; i += 1) table[`https://a.test/${i}`] = moved(`https://a.test/${i + 1}`);
    table[`https://a.test/${count}`] = { status: 200 };
    return chainFetch(table);
  };
  const five = chainOf(5);
  const ok = await checkExternalLinks(['https://a.test/0'], { fetch: five.fetch, sleep: noSleep });
  assert.equal(ok.get('https://a.test/0')?.outcome, 'ok');
  assert.equal(ok.get('https://a.test/0')?.final_url, 'https://a.test/5');

  const six = chainOf(6);
  const tooMany = await checkExternalLinks(['https://a.test/0'], { fetch: six.fetch, sleep: noSleep });
  assert.equal(tooMany.get('https://a.test/0')?.outcome, 'unverifiable');
  assert.equal(tooMany.get('https://a.test/0')?.reason, 'too_many_redirects');
  assert.equal(six.calls.some((c) => c.url === 'https://a.test/6'), false);

  const two = chainOf(3);
  const capped = await checkExternalLinks(['https://a.test/0'], { fetch: two.fetch, sleep: noSleep, fetchOptions: { maxRedirects: 2 } });
  assert.equal(capped.get('https://a.test/0')?.reason, 'too_many_redirects');
});

test('a redirect loop or a bad Location is unverifiable', async () => {
  const loop = chainFetch({ 'https://a.test/1': moved('/2'), 'https://a.test/2': moved('/1') });
  const looped = await checkExternalLinks(['https://a.test/1'], { fetch: loop.fetch, sleep: noSleep });
  assert.equal(looped.get('https://a.test/1')?.reason, 'redirect_loop');
  const bad = chainFetch({ 'https://a.test/1': moved('ftp://a.test/file') });
  const invalid = await checkExternalLinks(['https://a.test/1'], { fetch: bad.fetch, sleep: noSleep });
  assert.equal(invalid.get('https://a.test/1')?.reason, 'invalid_url');
});

test('a redirect to a missing page is broken, with the final URL', async () => {
  const { fetch } = chainFetch({ 'https://a.test/x': moved('https://a.test/gone') });
  const results = await checkExternalLinks(['https://a.test/x'], { fetch, sleep: noSleep });
  assert.equal(results.get('https://a.test/x')?.outcome, 'broken');
  assert.equal(results.get('https://a.test/x')?.final_url, 'https://a.test/gone');
});

test('a hop to another host waits for that host like its own requests', async () => {
  /** @type {number[]} */
  const sleeps = [];
  const { fetch } = chainFetch({ 'https://a.test/x': moved('https://b.test/y'), 'https://b.test/y': { status: 200 }, 'https://b.test/own': { status: 200 } });
  await checkExternalLinks(['https://a.test/x', 'https://b.test/own'], { fetch, perHostDelayMs: 300, concurrency: 1, sleep: async (ms) => { sleeps.push(ms); }, hosts: createHostGates() });
  // a.test: robots, HEAD x. b.test: robots, HEAD y, HEAD own. One wait before every request to a host after its first.
  assert.deepEqual(sleeps, [300, 300, 300]);
});

test('a redirect without Location is unverifiable, not ok', async () => {
  const { fetch } = chainFetch({ 'https://a.test/x': { status: 301 } });
  const results = await checkExternalLinks(['https://a.test/x'], { fetch, sleep: noSleep });
  assert.deepEqual(results.get('https://a.test/x'), { url: 'https://a.test/x', status: 301, outcome: 'unverifiable', reason: 'invalid_url', final_url: null });
});

test('robots.txt redirects are separate requests, paced per host, never overlapping on one host', async () => {
  const active = new Map();
  let overlap = false;
  /** @type {{url: string, maxRedirects: number}[]} */
  const calls = [];
  /** @type {Record<string, Partial<FetchResult> & {text?: string}>} */
  const table = {
    'https://b.test/robots.txt': { status: 301, headers: { location: 'https://c.test/robots.txt' } },
    'https://c.test/robots.txt': { status: 200, text: 'User-agent: *\nAllow: /\n' },
    'https://b.test/x': { status: 200 },
    'https://c.test/y': { status: 200 },
  };
  /** @param {string} url @param {any} options */
  const fetch = async (url, options) => {
    const host = new URL(url).hostname;
    if ((active.get(host) ?? 0) > 0) overlap = true;
    active.set(host, (active.get(host) ?? 0) + 1);
    calls.push({ url, maxRedirects: options.maxRedirects });
    await new Promise((resolve) => setTimeout(resolve, 5));
    active.set(host, active.get(host) - 1);
    return fetchResult(url, table[url] ?? { status: 404 });
  };
  /** @type {number[]} */
  const sleeps = [];
  const results = await checkExternalLinks(['https://b.test/x', 'https://c.test/y'], { fetch, concurrency: 2, perHostDelayMs: 100, sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(results.get('https://b.test/x')?.outcome, 'ok');
  assert.equal(overlap, false, 'c.test never has two requests in flight');
  assert.ok(calls.every((c) => c.maxRedirects === 0));
  assert.equal(calls.filter((c) => c.url === 'https://c.test/robots.txt').length, 2, 'once as b.test hop, once for c.test itself');
  assert.ok(sleeps.length >= 3, 'later requests to b.test and c.test waited');
});
