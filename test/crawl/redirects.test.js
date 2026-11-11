import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { LIMITS } from '../../server/src/config.js';
import { startServer } from '../helpers/http-server.js';
import { crawl, html, removeTempDirs } from './harness.js';

/** @import { PageRecord } from '../../server/src/types.js' */

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

/** @param {PageRecord[]|undefined} pages @param {string} origin */
const byPath = (pages, origin) => new Map((pages ?? []).map((p) => [p.url.replace(origin, ''), p]));
const ROBOTS = { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /private\n' };

test('every page is requested without automatic redirects and each hop is paced', async () => {
  await withSite({ '/': html(['/a']), '/a': { status: 301, redirect: '/b' }, '/b': { status: 302, redirect: '/c' }, '/c': html([]) }, async (origin, server) => {
    /** @type {any[]} */
    const options = [];
    const { safeFetch } = await import('../../server/src/net/safe-fetch.js');
    /** @type {typeof safeFetch} */
    const fetch = async (url, opts) => {
      options.push({ url, maxRedirects: opts?.maxRedirects });
      return safeFetch(url, opts);
    };
    const { result, sleeps } = await crawl({ url: `${origin}/`, allowLoopback: true }, { fetch });
    const pages = byPath(result?.pages, origin);
    assert.deepEqual([...pages.keys()], ['/', '/a', '/c'], 'hops in between get no record');
    assert.deepEqual(pages.get('/a')?.redirect_chain, [
      { url: `${origin}/a`, status: 301, location: `${origin}/b` },
      { url: `${origin}/b`, status: 302, location: `${origin}/c` },
    ]);
    assert.equal(pages.get('/a')?.final_url, `${origin}/c`);
    assert.equal(pages.get('/a')?.final_status, 200);
    assert.deepEqual(pages.get('/c')?.discovered_via, ['redirect']);
    assert.deepEqual(server.requests.map((r) => r.url), ['/robots.txt', '/', '/sitemap.xml', '/a', '/b', '/c']);
    assert.equal(sleeps.length, server.requests.length - 1, 'one wait before every request, hops included');
    for (const entry of options.filter((o) => !o.url.endsWith('robots.txt') && !o.url.endsWith('sitemap.xml'))) {
      assert.equal(entry.maxRedirects, 0, entry.url);
    }
  });
});

test('a redirect to a URL robots.txt disallows ends the chain without requesting it', async () => {
  await withSite({ '/robots.txt': ROBOTS, '/': html(['/go']), '/go': { status: 301, redirect: '/private/secret' }, '/private/secret': html([]) }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    const go = byPath(result?.pages, origin).get('/go');
    assert.equal(go?.fetch_error, 'robots_disallowed');
    assert.equal(go?.final_url, `${origin}/private/secret`);
    assert.equal(go?.final_status, 0);
    assert.deepEqual(result?.robots_blocked, [`${origin}/private/secret`]);
    assert.equal(server.requests.some((r) => r.url === '/private/secret'), false);
  });
});

test('a redirect to an allowed URL is followed', async () => {
  await withSite({ '/robots.txt': ROBOTS, '/': html(['/go']), '/go': { status: 301, redirect: '/public' }, '/public': html([]) }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(byPath(result?.pages, origin).get('/go')?.fetch_error, null);
    assert.ok(server.requests.some((r) => r.url === '/public'));
  });
});

test('a redirect to another site ends the chain without a request: final_external', async () => {
  const other = await startServer({ '/': html([]) });
  try {
    await withSite({ '/': html(['/out', '/far']), '/out': { status: 302, redirect: `${other.origin}/` }, '/far': { status: 301, redirect: 'https://elsewhere.test/page' } }, async (origin) => {
      const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
      const pages = byPath(result?.pages, origin);
      for (const [path, target] of [['/out', `${other.origin}/`], ['/far', 'https://elsewhere.test/page']]) {
        const record = pages.get(path);
        assert.equal(record?.final_external, true, path);
        assert.equal(record?.final_url, target, path);
        assert.equal(record?.final_status, 0, path);
        assert.equal(record?.fetch_error, null, path);
      }
      assert.equal(other.requests.length, 0, 'another port on the same host is another site');
      assert.equal(result?.pages.length, 3);
    });
  } finally {
    await other.close();
  }
});

test('a redirect loop, too many redirects and a bad Location end the chain with a fetch_error', async () => {
  const length = LIMITS.maxRedirects + 2;
  const chain = Object.fromEntries(Array.from({ length }, (_, i) => [`/h${i}`, { status: 301, redirect: `/h${i + 1}` }]));
  await withSite({
    '/': html(['/l1', '/h0', '/ftp', '/nowhere']),
    '/l1': { status: 301, redirect: '/l2' },
    '/l2': { status: 301, redirect: '/l1' },
    ...chain,
    [`/h${length}`]: html([]),
    '/ftp': { status: 301, redirect: 'ftp://site.test/file' },
    '/nowhere': { status: 301 },
  }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true, maxPages: 50 });
    const pages = byPath(result?.pages, origin);
    assert.equal(pages.get('/l1')?.fetch_error, 'redirect_loop');
    assert.equal(pages.get('/l1')?.final_status, 0);
    assert.equal(pages.get('/h0')?.fetch_error, 'too_many_redirects');
    assert.equal(pages.get('/h0')?.redirect_chain.length, LIMITS.maxRedirects + 1);
    assert.equal(server.requests.some((r) => r.url === `/h${LIMITS.maxRedirects + 1}`), false, 'nothing past the limit is requested');
    assert.ok(server.requests.some((r) => r.url === `/h${LIMITS.maxRedirects}`), 'up to the limit is followed');
    assert.equal(pages.get('/ftp')?.fetch_error, 'invalid_url');
    assert.equal(pages.get('/nowhere')?.fetch_error, 'invalid_url');
    assert.equal(pages.get('/nowhere')?.final_status, 0);
    assert.equal(pages.has('/l2'), false);
  });
});

test('a request that fails at the end of a chain gives the redirect a fetch_error and the target no record', async () => {
  await withSite({ '/': html(['/old']), '/old': { status: 301, redirect: '/dead' }, '/dead': (/** @type {any} */ _req, /** @type {any} */ res) => res.socket.destroy() }, async (origin) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    const pages = byPath(result?.pages, origin);
    assert.equal(pages.get('/old')?.fetch_error, 'connection_error');
    assert.equal(pages.get('/old')?.final_status, 0);
    assert.equal(pages.has('/dead'), false);
  });
});

test('a chain that ends in an error status records that status at both ends', async () => {
  await withSite({ '/': html(['/old']), '/old': { status: 301, redirect: '/missing' } }, async (origin) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    const pages = byPath(result?.pages, origin);
    assert.equal(pages.get('/old')?.final_status, 404);
    assert.equal(pages.get('/old')?.fetch_error, null);
    assert.equal(pages.get('/missing')?.status, 404);
  });
});

test('a redirect to an already recorded page adds no second record', async () => {
  await withSite({ '/': html(['/old']), '/old': { status: 301, redirect: '/' } }, async (origin) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.deepEqual(result?.pages.map((p) => p.url.replace(origin, '')), ['/', '/old']);
    assert.equal(byPath(result?.pages, origin).get('/old')?.final_status, 200);
  });
});

test('a chain that ends in a bot challenge records final_status 0 and an unreadable target', async () => {
  const challenge = { status: 503, body: '<title>Just a moment...</title><a href="/trap">t</a>' };
  await withSite({ '/': html(['/old']), '/old': { status: 301, redirect: '/guarded' }, '/guarded': challenge, '/trap': html([]) }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    const pages = byPath(result?.pages, origin);
    assert.equal(pages.get('/old')?.final_status, 0);
    assert.equal(pages.get('/old')?.fetch_error, 'bot_challenge');
    assert.equal(pages.get('/guarded')?.status, 503);
    assert.equal(pages.get('/guarded')?.fetch_error, 'bot_challenge');
    assert.deepEqual(pages.get('/guarded')?.links, []);
    assert.equal(server.requests.some((r) => r.url === '/trap'), false);
  });
});

test('truncated is false when only robots-blocked or already recorded URLs remain', async () => {
  await withSite({ '/robots.txt': ROBOTS, '/': html(['/a', '/private/x']), '/a': html([]) }, async (origin) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true, maxPages: 2 });
    assert.equal(result?.pages.length, 2);
    assert.equal(result?.truncated, false);
  });
  await withSite({ '/': html(['/a', '/b']), '/a': { status: 301, redirect: '/b' }, '/b': html([]) }, async (origin) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true, maxPages: 3 });
    assert.deepEqual(result?.pages.map((p) => p.url.replace(origin, '')), ['/', '/a', '/b']);
    assert.equal(result?.truncated, false);
  });
});

test('truncated is true when a fetchable URL remains', async () => {
  await withSite({ '/robots.txt': ROBOTS, '/': html(['/a', '/private/x', '/z']), '/a': html([]), '/z': html([]) }, async (origin) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true, maxPages: 2 });
    assert.equal(result?.truncated, true);
  });
  await withSite({ '/': html(['/old']), '/old': { status: 301, redirect: '/new' }, '/new': html([]) }, async (origin) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true, maxPages: 2 });
    assert.deepEqual(result?.pages.map((p) => p.url.replace(origin, '')), ['/', '/old']);
    assert.equal(result?.truncated, true, 'the redirect target did not fit');
  });
});

test('once the budget cuts off a fetched redirect target, truncated stays true', async () => {
  await withSite({
    '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /zz\n' },
    '/': html(['/r', '/zz/1']),
    '/r': { status: 301, redirect: '/t' },
    '/t': html([]),
  }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true, maxPages: 2 });
    assert.deepEqual(result?.pages.map((p) => p.url.replace(origin, '')), ['/', '/r']);
    assert.ok(server.requests.some((r) => r.url === '/t'), '/t was fetched and did not fit');
    assert.equal(result?.truncated, true);
  });
});

test('a redirect to something that is not a page is asked for with HEAD and gets no record', async () => {
  await withSite({
    '/': html(['/doc', '/page']),
    '/doc': { status: 301, redirect: '/files/report.pdf' },
    '/files/report.pdf': { headers: { 'content-type': 'application/pdf' }, body: 'x'.repeat(50_000) },
    '/page': { status: 301, redirect: '/landing' },
    '/landing': html([]),
  }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    const pages = byPath(result?.pages, origin);
    assert.equal(pages.get('/doc')?.final_status, 200);
    assert.equal(pages.get('/doc')?.final_url, `${origin}/files/report.pdf`);
    assert.equal(pages.has('/files/report.pdf'), false);
    const pdfRequests = server.requests.filter((r) => r.url === '/files/report.pdf');
    assert.deepEqual(pdfRequests.map((r) => r.method), ['HEAD']);
    assert.deepEqual(server.requests.filter((r) => r.url === '/landing').map((r) => r.method), ['GET']);
    assert.equal(pages.has('/landing'), true);
  });
});

test('a HEAD to a missing file still gives the redirect its final status', async () => {
  await withSite({ '/': html(['/doc']), '/doc': { status: 301, redirect: '/gone.pdf' } }, async (origin) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    const doc = byPath(result?.pages, origin).get('/doc');
    assert.equal(doc?.final_status, 404);
    assert.equal(byPath(result?.pages, origin).has('/gone.pdf'), false);
  });
});

test('a redirect to a page that is already recorded reuses its status without a request', async () => {
  await withSite({ '/': html(['/a', '/old']), '/a': html([]), '/old': { status: 301, redirect: '/a' } }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    const old = byPath(result?.pages, origin).get('/old');
    assert.equal(old?.final_status, 200);
    assert.equal(old?.fetch_error, null);
    assert.equal(server.requests.filter((r) => r.url === '/a').length, 1);
  });
  await withSite({ '/': html(['/b', '/old']), '/b': { status: 404, body: 'missing' }, '/old': { status: 301, redirect: '/b' } }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(byPath(result?.pages, origin).get('/old')?.final_status, 404);
    assert.equal(server.requests.filter((r) => r.url === '/b').length, 1);
  });
});

test('a redirect to a recorded page that refused the crawler carries its fetch_error and final_status 0', async () => {
  const challenge = { status: 403, body: 'Please solve the captcha' };
  await withSite({ '/': html(['/a', '/old']), '/a': challenge, '/old': { status: 301, redirect: '/a' } }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    const old = byPath(result?.pages, origin).get('/old');
    assert.equal(old?.fetch_error, 'bot_challenge');
    assert.equal(old?.final_status, 0);
    assert.equal(server.requests.filter((r) => r.url === '/a').length, 1);
  });
});

test('a redirect to a URL whose record is itself a redirect is requested again, so the chain stays complete', async () => {
  await withSite({ '/': html(['/b', '/z']), '/b': { status: 301, redirect: '/c' }, '/z': { status: 301, redirect: '/b' }, '/c': html([]) }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    const z = byPath(result?.pages, origin).get('/z');
    assert.deepEqual(z?.redirect_chain, [
      { url: `${origin}/z`, status: 301, location: `${origin}/b` },
      { url: `${origin}/b`, status: 301, location: `${origin}/c` },
    ]);
    assert.equal(z?.final_url, `${origin}/c`);
    assert.equal(z?.final_status, 200);
    assert.equal(server.requests.filter((r) => r.url === '/b').length, 2, 'the recorded redirect is requested again');
    assert.equal(server.requests.filter((r) => r.url === '/c').length, 1, 'the recorded page at the end is reused');
  });
});

/**
 * A file route whose HEAD and GET answers differ.
 * @param {number} headStatus
 * @param {number} getStatus
 */
function fileRoute(headStatus, getStatus) {
  return (/** @type {any} */ req, /** @type {any} */ res) => {
    const status = req.method === 'HEAD' ? headStatus : getStatus;
    res.writeHead(status, { 'content-type': 'application/pdf' });
    res.end(req.method === 'HEAD' ? undefined : 'x'.repeat(100_000));
  };
}

test('when a HEAD for a file is refused, one GET limited to 16 KB gives the real answer', async () => {
  await withSite({ '/': html(['/get']), '/get': { status: 302, redirect: '/files/doc.pdf' }, '/files/doc.pdf': fileRoute(405, 200) }, async (origin, server) => {
    const { safeFetch } = await import('../../server/src/net/safe-fetch.js');
    /** @type {{url: string, method: string|undefined, maxBytes: number|undefined}[]} */
    const seen = [];
    /** @type {typeof safeFetch} */
    const fetch = async (url, options) => {
      seen.push({ url, method: options?.method, maxBytes: options?.maxBytes });
      return safeFetch(url, options);
    };
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true }, { fetch });
    const get = byPath(result?.pages, origin).get('/get');
    assert.equal(get?.final_status, 200);
    assert.equal(get?.fetch_error, null);
    assert.equal(byPath(result?.pages, origin).has('/files/doc.pdf'), false, 'still no content record');
    assert.deepEqual(server.requests.filter((r) => r.url === '/files/doc.pdf').map((r) => r.method), ['HEAD', 'GET']);
    assert.deepEqual(seen.filter((s) => s.url.endsWith('.pdf')).map((s) => [s.method, s.maxBytes]), [['HEAD', undefined], ['GET', 16 * 1024]]);
  });
});

test('a file that is missing for HEAD and GET alike keeps its error status', async () => {
  await withSite({ '/': html(['/get']), '/get': { status: 302, redirect: '/files/doc.pdf' }, '/files/doc.pdf': fileRoute(404, 404) }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    assert.equal(byPath(result?.pages, origin).get('/get')?.final_status, 404);
    assert.deepEqual(server.requests.filter((r) => r.url === '/files/doc.pdf').map((r) => r.method), ['HEAD', 'GET']);
  });
});

test('a HEAD answered with a refusal is not retried with GET', async () => {
  const limited = (/** @type {any} */ _req, /** @type {any} */ res) => {
    res.writeHead(429, { 'retry-after': '1' });
    res.end();
  };
  await withSite({ '/': html(['/get']), '/get': { status: 302, redirect: '/files/doc.pdf' }, '/files/doc.pdf': limited }, async (origin, server) => {
    const { result } = await crawl({ url: `${origin}/`, allowLoopback: true });
    const get = byPath(result?.pages, origin).get('/get');
    assert.equal(get?.fetch_error, 'rate_limited');
    assert.equal(get?.final_status, 0);
    assert.deepEqual(server.requests.filter((r) => r.url === '/files/doc.pdf').map((r) => r.method), ['HEAD', 'HEAD'], 'only the one 429 retry, never a GET');
  });
});
