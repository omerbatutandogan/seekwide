import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { startServer } from '../helpers/http-server.js';
import { fakeFetch } from '../net/fake-fetch.js';
import { crawl, html, removeTempDirs } from './harness.js';

/** @type {Awaited<ReturnType<typeof startServer>>} */
let site;

const ROUTES = {
  '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /private\nSitemap: {origin}/sitemap.xml\n' },
  '/sitemap.xml': {
    headers: { 'content-type': 'application/xml' },
    body: '<urlset><url><loc>{origin}/</loc></url><url><loc>{origin}/orphan</loc></url><url><loc>{origin}/blog/post-1</loc></url><url><loc>{origin}/private/listed</loc></url></urlset>',
  },
  '/': html([
    '/about', '/blog/', '/blog/post-3', '/blog/post-1', '/blog/post-2', '/docs/b', '/docs/a', '/shop/item-1',
    '/private/secret', '/logo.png', 'https://external.test/', '/old', '/about#team', '/?utm_source=x',
  ]),
  '/about': html(['/', '/team']),
  '/team': html([]),
  '/blog/': html(['/blog/post-4']),
  '/blog/post-1': html(['/']),
  '/blog/post-2': html(['/']),
  '/blog/post-3': html(['/']),
  '/blog/post-4': html(['/']),
  '/docs/a': html([]),
  '/docs/b': html([]),
  '/shop/item-1': html([]),
  '/old': { status: 301, redirect: '/new' },
  '/new': html([]),
  '/orphan': html(['/orphan-child']),
  '/orphan-child': html([]),
  '/private/secret': html([]),
  '/logo.png': { headers: { 'content-type': 'image/png' }, body: 'png' },
};

before(async () => {
  site = await startServer(ROUTES);
});

after(async () => {
  await site.close();
  await removeTempDirs();
});

const EXPECTED_ORDER = [
  '/', '/about', '/blog/', '/blog/post-1', '/docs/a', '/old', '/new', '/shop/item-1', '/blog/post-2', '/docs/b',
  '/blog/post-3', '/blog/post-4', '/team', '/orphan',
];

test('crawls breadth-first, sampling templates within each depth, then sitemap-only URLs', async () => {
  const { job, result } = await crawl({ url: `${site.origin}/`, maxPages: 50, allowLoopback: true });
  assert.equal(job?.status, 'done');
  assert.ok(result);
  assert.deepEqual(result.pages.map((p) => p.url.replace(site.origin, '')), EXPECTED_ORDER);
  const byPath = new Map(result.pages.map((p) => [p.url.replace(site.origin, ''), p]));
  assert.deepEqual(byPath.get('/')?.discovered_via, ['start']);
  assert.equal(byPath.get('/')?.depth, 0);
  assert.equal(byPath.get('/team')?.depth, 2);
  assert.deepEqual(byPath.get('/blog/post-1')?.discovered_via, ['link', 'sitemap']);
  assert.deepEqual(byPath.get('/about')?.discovered_via, ['link']);
  assert.deepEqual(byPath.get('/orphan')?.discovered_via, ['sitemap']);
  assert.equal(byPath.get('/orphan')?.depth, null);
  assert.equal(byPath.get('/old')?.status, 301);
  assert.deepEqual(byPath.get('/new')?.discovered_via, ['redirect']);
  assert.equal(result.truncated, false);
  assert.equal(result.blocked, null);
});

test('fetches only internal, HTML-looking, robots-allowed URLs and lists the disallowed ones', async () => {
  const before = site.requests.length;
  const { result } = await crawl({ url: `${site.origin}/`, maxPages: 50, allowLoopback: true });
  const requested = site.requests.slice(before).map((r) => r.url);
  assert.ok(result);
  assert.deepEqual(result.robots_blocked, [`${site.origin}/private/secret`, `${site.origin}/private/listed`]);
  for (const path of ['/private/secret', '/private/listed', '/logo.png', '/orphan-child']) {
    assert.equal(requested.includes(path), false, path);
  }
  assert.equal(requested.filter((p) => p === '/new').length, 1, 'a recorded redirect target is not fetched again');
  assert.equal(requested.filter((p) => p === '/').length, 1);
});

test('two crawls of the same site fetch the same pages in the same order', async () => {
  const first = await crawl({ url: `${site.origin}/`, maxPages: 50, allowLoopback: true });
  const firstRequests = site.requests.length;
  const second = await crawl({ url: `${site.origin}/`, maxPages: 50, allowLoopback: true });
  const requestsOf = (/** @type {number} */ from, /** @type {number} */ to) => site.requests.slice(from, to).map((r) => r.url);
  assert.ok(first.result && second.result);
  assert.deepEqual(second.result.pages, first.result.pages);
  assert.deepEqual(second.result.robots_blocked, first.result.robots_blocked);
  const n = site.requests.length - firstRequests;
  assert.deepEqual(requestsOf(firstRequests, site.requests.length), requestsOf(firstRequests - n, firstRequests));
});

test('a small page budget still reaches every section of the site', async () => {
  const sections = ['blog', 'docs', 'shop'];
  /** @type {Record<string, any>} */
  const routes = {
    '/': html([...sections.flatMap((s) => Array.from({ length: 10 }, (_, i) => `/${s}/p${String(i).padStart(2, '0')}`)), '/about']),
  };
  const local = await startServer(routes);
  try {
    const { result } = await crawl({ url: `${local.origin}/`, maxPages: 5, allowLoopback: true });
    assert.ok(result);
    assert.deepEqual(result.pages.map((p) => p.url.replace(local.origin, '')), ['/', '/about', '/blog/p00', '/docs/p00', '/shop/p00']);
    assert.equal(result.truncated, true);
  } finally {
    await local.close();
  }
});

test('truncated is false when the budget is exactly enough', async () => {
  const local = await startServer({ '/': html(['/a', '/b']), '/a': html([]), '/b': html([]) });
  try {
    const { result } = await crawl({ url: `${local.origin}/`, maxPages: 3, allowLoopback: true });
    assert.equal(result?.pages.length, 3);
    assert.equal(result?.truncated, false);
    const cut = await crawl({ url: `${local.origin}/`, maxPages: 2, allowLoopback: true });
    assert.equal(cut.result?.pages.length, 2);
    assert.equal(cut.result?.truncated, true);
  } finally {
    await local.close();
  }
});

test('every record counts toward the budget, including redirect records', async () => {
  const local = await startServer({ '/': html(['/old', '/z']), '/old': { status: 301, redirect: '/new' }, '/new': html([]), '/z': html([]) });
  try {
    const { result } = await crawl({ url: `${local.origin}/`, maxPages: 2, allowLoopback: true });
    assert.deepEqual(result?.pages.map((p) => p.url.replace(local.origin, '')), ['/', '/old']);
    assert.equal(result?.truncated, true);
  } finally {
    await local.close();
  }
});

test('robots.txt that cannot be read stops the crawl before the start page', async () => {
  const local = await startServer({ '/robots.txt': { status: 503, body: 'down' }, '/': html([]) });
  try {
    const { job, result } = await crawl({ url: `${local.origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'blocked');
    assert.deepEqual(result?.blocked, { reason: 'robots_unreachable', url: `${local.origin}/robots.txt`, status: 503 });
    assert.deepEqual(result?.pages, []);
    assert.deepEqual(local.requests.map((r) => r.url), ['/robots.txt']);
  } finally {
    await local.close();
  }
});

test('a disallowed start URL stops the crawl without fetching it', async () => {
  const local = await startServer({ '/robots.txt': { body: 'User-agent: *\nDisallow: /\n', headers: { 'content-type': 'text/plain' } }, '/': html([]) });
  try {
    const { job, result } = await crawl({ url: `${local.origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'blocked');
    assert.equal(result?.blocked?.reason, 'robots_disallow');
    assert.equal(result?.robots.disallows_all, true);
    assert.deepEqual(local.requests.map((r) => r.url), ['/robots.txt']);
  } finally {
    await local.close();
  }
});

test('when the start URL redirects to another origin, that origin becomes the site and its robots.txt is read before it is requested', async () => {
  const text = { 'content-type': 'text/plain' };
  const page = (/** @type {string} */ body) => ({ headers: { 'content-type': 'text/html' }, text: body });
  const { fetch, calls } = fakeFetch({
    'https://old.test/robots.txt': { status: 404, text: 'none' },
    'https://old.test/': { status: 301, headers: { location: 'https://new.test/' } },
    'https://new.test/robots.txt': { headers: text, text: 'User-agent: *\nDisallow: /hidden\n' },
    'https://new.test/': page('<a href="/page">p</a><a href="/hidden">h</a><a href="https://old.test/x">o</a>'),
    'https://new.test/page': page(''),
  });
  const { job, result } = await crawl({ url: 'https://old.test/' }, { fetch });
  assert.equal(job?.status, 'done');
  assert.equal(result?.site_origin, 'https://new.test');
  assert.equal(result?.site_host, 'new.test');
  assert.equal(result?.robots.url, 'https://new.test/robots.txt');
  assert.deepEqual(result?.pages.map((p) => p.url), ['https://old.test/', 'https://new.test/', 'https://new.test/page']);
  assert.deepEqual(result?.robots_blocked, ['https://new.test/hidden']);
  const urls = calls.map((c) => c.url);
  assert.deepEqual(urls.slice(0, 4), ['https://old.test/robots.txt', 'https://old.test/', 'https://new.test/robots.txt', 'https://new.test/']);
  assert.equal(urls.includes('https://old.test/x'), false, 'the old origin is another site now');
});

test('a start redirect to an origin whose robots.txt disallows the target stops the crawl before requesting it', async () => {
  const { fetch, calls } = fakeFetch({
    'https://old.test/': { status: 301, headers: { location: 'https://new.test/' } },
    'https://new.test/robots.txt': { headers: { 'content-type': 'text/plain' }, text: 'User-agent: *\nDisallow: /\n' },
  });
  const { job, result } = await crawl({ url: 'https://old.test/' }, { fetch });
  assert.equal(job?.status, 'blocked');
  assert.deepEqual(result?.blocked, { reason: 'robots_disallow', url: 'https://new.test/', status: 0 });
  assert.equal(calls.some((c) => c.url === 'https://new.test/'), false);
  assert.equal(result?.sitemap.loaded, false);
});

test('a start redirect to an origin whose robots.txt cannot be read stops the crawl', async () => {
  const { fetch } = fakeFetch({
    'https://old.test/': { status: 301, headers: { location: 'https://new.test/' } },
    'https://new.test/robots.txt': { status: 503, text: 'down' },
  });
  const { job, result } = await crawl({ url: 'https://old.test/' }, { fetch });
  assert.equal(job?.status, 'blocked');
  assert.equal(result?.blocked?.reason, 'robots_unreachable');
});

test('sitemaps come from robots.txt, or from a /sitemap.xml guess', async () => {
  const { result } = await crawl({ url: `${site.origin}/`, maxPages: 1, allowLoopback: true });
  assert.deepEqual(result?.sitemap.files.map((f) => f.url), [`${site.origin}/sitemap.xml`]);
  assert.equal(result?.sitemap.urls.length, 4);
  assert.equal(result?.sitemap.loaded, true);

  const bare = await startServer({ '/': html([]) });
  try {
    const probed = await crawl({ url: `${bare.origin}/`, allowLoopback: true });
    assert.deepEqual(probed.result?.sitemap, { loaded: true, files: [], urls: [], truncated: false });
    assert.ok(bare.requests.some((r) => r.url === '/sitemap.xml'));
  } finally {
    await bare.close();
  }
});

test('a /sitemap.xml guess that redirects to the home page means no sitemap files', async () => {
  const local = await startServer({ '/': html([]), '/sitemap.xml': { status: 301, redirect: '/' } });
  try {
    const { result } = await crawl({ url: `${local.origin}/`, allowLoopback: true });
    assert.deepEqual(result?.sitemap, { loaded: true, files: [], urls: [], truncated: false });
  } finally {
    await local.close();
  }
});

test('a Sitemap: line on another host is listed as external and never requested', async () => {
  const S = 'https://site.test';
  const { fetch, calls } = fakeFetch({
    [`${S}/robots.txt`]: { headers: { 'content-type': 'text/plain' }, text: 'Sitemap: https://cdn.other.test/sitemap.xml\n' },
    [`${S}/`]: { headers: { 'content-type': 'text/html' }, text: '' },
  });
  const { result } = await crawl({ url: `${S}/` }, { fetch });
  assert.deepEqual(result?.sitemap.files, [{ url: 'https://cdn.other.test/sitemap.xml', status: 0, type: 'external', count: 0, error: 'On another host; not read' }]);
  assert.equal(calls.some((c) => c.url.includes('other.test')), false);
});

test('an https site gets an http probe, followed by hand; an http site does not', async () => {
  const S = 'https://site.test';
  const page = { headers: { 'content-type': 'text/html' }, text: '<a href="/a">a</a>' };
  const enforced = fakeFetch({
    [`${S}/`]: page,
    [`${S}/a`]: page,
    'http://site.test/': { status: 301, headers: { location: `${S}/` } },
  });
  const { result } = await crawl({ url: `${S}/` }, { fetch: enforced.fetch });
  assert.deepEqual(result?.http_probe, { url: 'http://site.test/', status: 301, final_url: `${S}/`, enforced: true });
  assert.deepEqual(enforced.calls.map((c) => c.url), [`${S}/robots.txt`, `${S}/`, `${S}/sitemap.xml`, 'http://site.test/robots.txt', 'http://site.test/', `${S}/a`]);
  assert.ok(enforced.calls.every((c) => c.url.endsWith('robots.txt') || c.options.maxRedirects === 0));

  const viaWww = fakeFetch({
    [`${S}/`]: page,
    'http://site.test/': { status: 301, headers: { location: 'http://www.site.test/' } },
    'http://www.site.test/': { status: 301, headers: { location: 'https://www.site.test/' } },
  });
  const twoHops = await crawl({ url: `${S}/` }, { fetch: viaWww.fetch });
  assert.deepEqual(twoHops.result?.http_probe, { url: 'http://site.test/', status: 301, final_url: 'https://www.site.test/', enforced: true });

  const open = fakeFetch({ [`${S}/`]: page, 'http://site.test/': { status: 200, text: 'plain' } });
  const plain = await crawl({ url: `${S}/` }, { fetch: open.fetch });
  assert.deepEqual(plain.result?.http_probe, { url: 'http://site.test/', status: 200, final_url: 'http://site.test/', enforced: false });

  const failing = fakeFetch({ [`${S}/`]: page, 'http://site.test/': { status: 0, error: { code: 'connection_error', message: 'refused' } } });
  const failed = await crawl({ url: `${S}/` }, { fetch: failing.fetch });
  assert.equal(failed.result?.http_probe, null);

  const httpOnly = fakeFetch({ 'http://site.test/': page });
  const http = await crawl({ url: 'http://site.test/' }, { fetch: httpOnly.fetch });
  assert.equal(http.result?.http_probe, null);
  assert.equal(httpOnly.calls.filter((c) => c.url === 'http://site.test/').length, 1);
});

test('subdomains are crawled only with includeSubdomains, under their own robots.txt', async () => {
  const S = 'https://site.test';
  const table = {
    [`${S}/`]: { headers: { 'content-type': 'text/html' }, text: '<a href="https://blog.site.test/post">p</a><a href="https://shop.site.test/x">x</a>' },
    'https://blog.site.test/post': { headers: { 'content-type': 'text/html' }, text: 'post' },
    'https://shop.site.test/robots.txt': { status: 500, text: 'down' },
  };
  const without = fakeFetch(table);
  const narrow = await crawl({ url: `${S}/` }, { fetch: without.fetch });
  assert.deepEqual(narrow.result?.pages.map((p) => p.url), [`${S}/`]);
  assert.equal(without.calls.some((c) => c.url.includes('blog.site.test')), false);

  const withSubs = fakeFetch(table);
  const wide = await crawl({ url: `${S}/`, includeSubdomains: true }, { fetch: withSubs.fetch });
  assert.deepEqual(wide.result?.pages.map((p) => p.url), [`${S}/`, 'https://blog.site.test/post']);
  assert.deepEqual(wide.result?.robots_blocked, ['https://shop.site.test/x']);
  const urls = withSubs.calls.map((c) => c.url);
  assert.ok(urls.indexOf('https://blog.site.test/robots.txt') < urls.indexOf('https://blog.site.test/post'));
  assert.equal(urls.includes('https://shop.site.test/x'), false);
  assert.equal(wide.result?.options.include_subdomains, true);
});

test('the http probe obeys robots.txt for the first request and every hop', async () => {
  const S = 'https://site.test';
  const page = { headers: { 'content-type': 'text/html' }, text: '' };
  const robots = (/** @type {string} */ rules) => ({ headers: { 'content-type': 'text/plain' }, text: rules });

  const refused = fakeFetch({ [`${S}/`]: page, 'http://site.test/robots.txt': robots('User-agent: *\nDisallow: /\n') });
  const noProbe = await crawl({ url: `${S}/` }, { fetch: refused.fetch });
  assert.equal(noProbe.result?.http_probe, null);
  assert.equal(refused.calls.some((c) => c.url === 'http://site.test/'), false);

  const unreadable = fakeFetch({ [`${S}/`]: page, 'http://site.test/robots.txt': { status: 503, text: 'down' } });
  const unread = await crawl({ url: `${S}/` }, { fetch: unreadable.fetch });
  assert.equal(unread.result?.http_probe, null);
  assert.equal(unreadable.calls.some((c) => c.url === 'http://site.test/'), false);

  const hopRefused = fakeFetch({
    [`${S}/`]: page,
    'http://site.test/': { status: 301, headers: { location: 'http://www.site.test/' } },
    'http://www.site.test/robots.txt': robots('User-agent: *\nDisallow: /\n'),
  });
  const stopped = await crawl({ url: `${S}/` }, { fetch: hopRefused.fetch });
  assert.equal(stopped.result?.http_probe, null);
  assert.equal(hopRefused.calls.some((c) => c.url === 'http://www.site.test/'), false);

  const allowed = fakeFetch({
    [`${S}/`]: page,
    'http://site.test/robots.txt': robots('User-agent: *\nDisallow: /private\n'),
    'http://site.test/': { status: 301, headers: { location: `${S}/` } },
  });
  const probed = await crawl({ url: `${S}/` }, { fetch: allowed.fetch });
  assert.equal(probed.result?.http_probe?.enforced, true);
});

test('there is no http probe for a site on a non-default port', async () => {
  const S = 'https://site.test:8443';
  const page = { headers: { 'content-type': 'text/html' }, text: '' };
  const onPort = fakeFetch({ [`${S}/`]: page });
  const { result } = await crawl({ url: `${S}/` }, { fetch: onPort.fetch });
  assert.equal(result?.site_host, 'site.test:8443');
  assert.equal(result?.http_probe, null);
  assert.equal(onPort.calls.some((c) => c.url.startsWith('http://')), false);

  const standard = fakeFetch({ 'https://site.test/': page });
  const probed = await crawl({ url: 'https://site.test/' }, { fetch: standard.fetch });
  assert.ok(standard.calls.some((c) => c.url === 'http://site.test/'));
  assert.notEqual(probed.result?.http_probe, null);
});

test('an http probe answered with a refusal is null; other error statuses are answers', async () => {
  const S = 'https://site.test';
  const page = { headers: { 'content-type': 'text/html' }, text: '' };
  /** @type {[string, any, any][]} */
  const cases = [
    ['429', { status: 429, headers: { 'retry-after': '1' }, text: '' }, null],
    ['challenge', { status: 403, headers: { 'cf-mitigated': 'challenge', 'content-type': 'text/html' }, text: '<title>Just a moment...</title>' }, null],
    ['503', { status: 503, text: 'maintenance' }, { url: 'http://site.test/', status: 503, final_url: 'http://site.test/', enforced: false }],
    ['404', { status: 404, text: 'none' }, { url: 'http://site.test/', status: 404, final_url: 'http://site.test/', enforced: false }],
  ];
  for (const [name, answer, expected] of cases) {
    const { fetch } = fakeFetch({ [`${S}/`]: page, 'http://site.test/': answer });
    const { result } = await crawl({ url: `${S}/` }, { fetch });
    assert.deepEqual(result?.http_probe, expected, name);
  }
});

test('an http probe that loops stops at the first repeated URL', async () => {
  const S = 'https://site.test';
  const page = { headers: { 'content-type': 'text/html' }, text: '' };
  const { fetch, calls } = fakeFetch({
    [`${S}/`]: page,
    'http://site.test/': { status: 301, headers: { location: 'http://site.test/a' } },
    'http://site.test/a': { status: 301, headers: { location: 'http://site.test/' } },
  });
  const { result } = await crawl({ url: `${S}/` }, { fetch });
  assert.deepEqual(result?.http_probe, { url: 'http://site.test/', status: 301, final_url: 'http://site.test/', enforced: false });
  assert.equal(calls.filter((c) => c.url.startsWith('http://site.test/') && !c.url.endsWith('robots.txt')).length, 2);
});

test('a redirect to a subdomain whose robots.txt cannot be read is not followed', async () => {
  const S = 'https://site.test';
  const page = (/** @type {string} */ body) => ({ headers: { 'content-type': 'text/html' }, text: body });
  const table = {
    [`${S}/`]: page('<a href="/go">go</a>'),
    [`${S}/go`]: { status: 301, headers: { location: 'https://blog.site.test/x' } },
    'https://blog.site.test/x': page(''),
  };
  const down = fakeFetch({ ...table, 'https://blog.site.test/robots.txt': { status: 503, text: 'down' } });
  const refused = await crawl({ url: `${S}/`, includeSubdomains: true }, { fetch: down.fetch });
  const go = refused.result?.pages.find((p) => p.url === `${S}/go`);
  assert.equal(go?.fetch_error, 'robots_disallowed');
  assert.equal(down.calls.some((c) => c.url === 'https://blog.site.test/x'), false);

  const fine = fakeFetch(table);
  const followed = await crawl({ url: `${S}/`, includeSubdomains: true }, { fetch: fine.fetch });
  assert.equal(followed.result?.pages.find((p) => p.url === `${S}/go`)?.final_status, 200);
});
