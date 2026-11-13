import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { USER_AGENT } from '../../plugin/server/src/config.js';
import { safeFetch } from '../../plugin/server/src/net/safe-fetch.js';
import { startServer } from '../helpers/http-server.js';
import { crawl, html, removeTempDirs } from './harness.js';

after(removeTempDirs);

/**
 * @param {Record<string, any>} routes
 * @param {(origin: string, server: Awaited<ReturnType<typeof startServer>>) => Promise<void>} body
 */
async function withSite(routes, body) {
  const server = await startServer(routes);
  try {
    await body(server.origin, server);
  } finally {
    await server.close();
  }
}

const SMALL_SITE = { '/': html(['/a', '/b']), '/a': html([]), '/b': html([]) };

test('waits 1000 / ratePerSec between every two requests, robots and sitemap included', async () => {
  await withSite(SMALL_SITE, async (origin, server) => {
    const { sleeps } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.deepEqual(server.requests.map((r) => r.url), ['/robots.txt', '/', '/sitemap.xml', '/a', '/b']);
    assert.deepEqual(sleeps, [1000, 1000, 1000, 1000]);
  });
  await withSite(SMALL_SITE, async (origin) => {
    const { sleeps } = await crawl({ url: `${origin}/`, allowLoopback: true, ratePerSec: 2 });
    assert.deepEqual(sleeps, [500, 500, 500, 500]);
  });
  await withSite(SMALL_SITE, async (origin) => {
    const { sleeps } = await crawl({ url: `${origin}/`, allowLoopback: true, ratePerSec: 0.5 });
    assert.deepEqual(sleeps, [2000, 2000, 2000, 2000]);
  });
});

test('honors crawl-delay when it is longer than the rate, up to the cap', async () => {
  const withDelay = (/** @type {string} */ delay) => ({ ...SMALL_SITE, '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: `User-agent: *\nCrawl-delay: ${delay}\n` } });
  await withSite(withDelay('3'), async (origin) => {
    const { sleeps, result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(result?.robots.crawl_delay_sec, 3);
    assert.deepEqual(sleeps, [3000, 3000, 3000, 3000]);
  });
  await withSite(withDelay('60'), async (origin) => {
    const { sleeps } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.deepEqual(sleeps, [10_000, 10_000, 10_000, 10_000]);
  });
  await withSite(withDelay('0.2'), async (origin) => {
    const { sleeps } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.deepEqual(sleeps, [1000, 1000, 1000, 1000]);
  });
});

test('sends one request at a time', async () => {
  await withSite({ '/': html(['/a', '/b', '/c']), '/a': html(['/d']), '/b': html([]), '/c': html([]), '/d': html([]) }, async (origin) => {
    let active = 0;
    let maxActive = 0;
    /** @type {typeof safeFetch} */
    const fetch = async (url, options) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await safeFetch(url, options);
      } finally {
        active -= 1;
      }
    };
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true }, { fetch });
    assert.equal(result?.pages.length, 5);
    assert.equal(maxActive, 1);
  });
});

test('a bot challenge on the start page stops the crawl at once', async () => {
  const variants = [
    { status: 403, body: '<html><title>Just a moment...</title></html>' },
    { status: 503, headers: { 'cf-mitigated': 'challenge' }, body: 'x' },
    { status: 429, headers: { 'cf-mitigated': 'challenge' }, body: 'x' },
  ];
  for (const variant of variants) {
    await withSite({ '/': variant }, async (origin, server) => {
      const { job, result } = await crawl({ url: `${origin}/`, allowLoopback: true });
      assert.equal(job?.status, 'blocked');
      assert.deepEqual(result?.blocked, { reason: 'bot_challenge', url: `${origin}/`, status: variant.status });
      assert.equal(result?.pages.length, 1);
      assert.equal(result?.pages[0].fetch_error, 'bot_challenge');
      assert.equal(result?.pages[0].status, variant.status);
      assert.equal(result?.sitemap.loaded, false, 'sitemaps were never looked for');
      assert.deepEqual(server.requests.map((r) => r.url), ['/robots.txt', '/'], 'no retry, no sitemap, nothing else');
    });
  }
});

test('three challenged pages in a row stop the crawl; never retried, never with other headers', async () => {
  const challenge = { status: 403, body: '<script src="/cdn-cgi/challenge-platform/x.js"></script>' };
  await withSite({ '/': html(['/c1', '/c2', '/c3', '/c4']), '/c1': challenge, '/c2': challenge, '/c3': challenge, '/c4': html([]) }, async (origin, server) => {
    const { job, result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'blocked');
    assert.deepEqual(result?.blocked, { reason: 'bot_challenge', url: `${origin}/c3`, status: 403 });
    assert.deepEqual(server.requests.filter((r) => r.url.startsWith('/c')).map((r) => r.url), ['/c1', '/c2', '/c3']);
    assert.ok(server.requests.every((r) => r.headers['user-agent'] === USER_AGENT));
    const pageHeaders = server.requests
      .filter((r) => r.url === '/' || r.url.startsWith('/c'))
      .map((r) => JSON.stringify([r.headers['user-agent'], r.headers.accept, r.headers['accept-encoding']]));
    assert.equal(new Set(pageHeaders).size, 1);
  });
});

test('two challenged pages followed by a normal one do not stop the crawl', async () => {
  const challenge = { status: 403, body: 'Please complete the captcha' };
  await withSite({ '/': html(['/c1', '/c2', '/ok', '/z1']), '/c1': challenge, '/c2': challenge, '/ok': html([]), '/z1': challenge }, async (origin) => {
    const { job, result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'done');
    assert.equal(result?.blocked, null);
    assert.equal(result?.pages.length, 5);
  });
});

test('a plain 403 or 503 without challenge markers is recorded, not treated as a challenge', async () => {
  await withSite({ '/': { status: 403, body: 'Forbidden' } }, async (origin) => {
    const { job, result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'done');
    assert.equal(result?.pages[0].status, 403);
    assert.equal(result?.pages[0].fetch_error, null);
    assert.equal(result?.sitemap.loaded, true);
  });
});

test('a challenged page is recorded as unreadable: its status kept, no content, its links not followed', async () => {
  const challenge = { status: 503, body: '<html><title>Just a moment...</title><a href="/behind">x</a></html>' };
  await withSite({ '/': html(['/guarded', '/open']), '/guarded': challenge, '/open': html([]), '/behind': html([]) }, async (origin, server) => {
    const { job, result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'done');
    const guarded = result?.pages.find((p) => p.url.endsWith('/guarded'));
    assert.equal(guarded?.status, 503);
    assert.equal(guarded?.fetch_error, 'bot_challenge');
    assert.equal(guarded?.is_html, false);
    assert.deepEqual(guarded?.indexability, { indexable: false, reasons: ['fetch_error'] });
    assert.equal(result?.pages.find((p) => p.url.endsWith('/open'))?.fetch_error, null);
    assert.equal(server.requests.some((r) => r.url === '/behind'), false);
  });
});

/**
 * A route that answers 429 for the first `times` requests, then 200.
 * @param {number} times
 * @param {string|null} retryAfter
 */
function limitedRoute(times, retryAfter) {
  let count = 0;
  return (/** @type {any} */ _req, /** @type {any} */ res) => {
    count += 1;
    if (count <= times) {
      res.writeHead(429, retryAfter === null ? {} : { 'retry-after': retryAfter });
      res.end('slow down');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body>ok</body></html>');
  };
}

test('a 429 is retried once after Retry-After', async () => {
  await withSite({ '/': html(['/limited']), '/limited': limitedRoute(1, '7') }, async (origin, server) => {
    const { job, result, sleeps } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'done');
    assert.equal(result?.pages.find((p) => p.url.endsWith('/limited'))?.status, 200);
    assert.equal(result?.pages.find((p) => p.url.endsWith('/limited'))?.fetch_error, null);
    assert.equal(server.requests.filter((r) => r.url === '/limited').length, 2);
    assert.deepEqual(sleeps, [1000, 1000, 1000, 7000]);
  });
});

test('Retry-After is capped at 30 s, and a missing one means the normal delay', async () => {
  await withSite({ '/': html(['/limited']), '/limited': limitedRoute(1, '120') }, async (origin) => {
    const { sleeps } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(sleeps.at(-1), 30_000);
  });
  await withSite({ '/': html(['/limited']), '/limited': limitedRoute(1, null) }, async (origin) => {
    const { sleeps } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(sleeps.at(-1), 1000);
  });
});

test('a 429 that persists after the retry is recorded as 429', async () => {
  await withSite({ '/': html(['/limited']), '/limited': limitedRoute(2, '1') }, async (origin, server) => {
    const { job, result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'done');
    const limited = result?.pages.find((p) => p.url.endsWith('/limited'));
    assert.equal(limited?.status, 429);
    assert.equal(limited?.fetch_error, 'rate_limited');
    assert.equal(server.requests.filter((r) => r.url === '/limited').length, 2);
  });
});

test('three 429s in a row stop the crawl as rate_limited', async () => {
  const always = limitedRoute(Infinity, '1');
  await withSite({ '/': html(['/r1', '/r2', '/r3', '/r4']), '/r1': always, '/r2': always, '/r3': always, '/r4': html([]) }, async (origin, server) => {
    const { job, result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'blocked');
    assert.deepEqual(result?.blocked, { reason: 'rate_limited', url: `${origin}/r3`, status: 429 });
    assert.equal(server.requests.some((r) => r.url === '/r4'), false);
    assert.ok(server.requests.every((r) => r.headers['user-agent'] === USER_AGENT));
  });
});

test('two 429s followed by a success do not stop the crawl', async () => {
  const always = limitedRoute(Infinity, '1');
  await withSite({ '/': html(['/r1', '/r2', '/r3']), '/r1': always, '/r2': always, '/r3': html([]) }, async (origin) => {
    const { job } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'done');
  });
});

test('every redirect hop of a robots.txt request is its own paced request', async () => {
  await withSite({
    '/robots.txt': { status: 301, redirect: '/real-robots.txt' },
    '/real-robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /hidden\n' },
    '/': html(['/hidden', '/a']),
    '/a': html([]),
  }, async (origin, server) => {
    const { result, sleeps } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.deepEqual(server.requests.slice(0, 3).map((r) => r.url), ['/robots.txt', '/real-robots.txt', '/']);
    assert.equal(sleeps.length, server.requests.length - 1, 'a wait before every request, the robots.txt hop included');
    assert.equal(result?.robots.status, 'ok');
    assert.deepEqual(result?.robots_blocked, [`${origin}/hidden`], 'the redirected file\'s rules apply to the site');
  });
});
