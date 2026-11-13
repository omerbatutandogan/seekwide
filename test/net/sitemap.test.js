import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';

import { loadSitemaps } from '../../plugin/server/src/net/sitemap.js';
import { scanSitemap } from '../../plugin/server/src/net/sitemap-scan.js';
import { startServer } from '../helpers/http-server.js';
import { fakeFetch } from './fake-fetch.js';

const S = 'https://site.test';

/** @param {string[]} locs */
const urlset = (locs) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`;
/** @param {string[]} locs */
const index = (locs) =>
  `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs.map((l) => `<sitemap><loc>${l}</loc></sitemap>`).join('')}</sitemapindex>`;

test('reads a urlset: normalized, de-duplicated page URLs in file order', async () => {
  const { fetch } = fakeFetch({
    [`${S}/sitemap.xml`]: { text: urlset([`${S}/b`, `${S}/a#top`, `${S}/b`, `HTTPS://SITE.TEST/c?utm_source=x`, 'not a url']) },
  });
  const result = await loadSitemaps([`${S}/sitemap.xml`], { fetch });
  assert.equal(result.loaded, true);
  assert.deepEqual(result.urls, [`${S}/b`, `${S}/a`, `${S}/c`]);
  assert.deepEqual(result.files, [{ url: `${S}/sitemap.xml`, status: 200, type: 'urlset', count: 5, error: null }]);
  assert.equal(result.truncated, false);
});

test('follows sitemap indexes breadth-first', async () => {
  const { fetch, calls } = fakeFetch({
    [`${S}/index.xml`]: { text: index([`${S}/nested-index.xml`, `${S}/pages.xml`]) },
    [`${S}/extra.xml`]: { text: urlset([`${S}/extra`]) },
    [`${S}/nested-index.xml`]: { text: index([`${S}/deep.xml`]) },
    [`${S}/pages.xml`]: { text: urlset([`${S}/p1`, `${S}/p2`]) },
    [`${S}/deep.xml`]: { text: urlset([`${S}/deep`, `${S}/p1`]) },
  });
  const result = await loadSitemaps([`${S}/index.xml`, `${S}/extra.xml`], { fetch });
  assert.deepEqual(calls.map((c) => c.url), [`${S}/index.xml`, `${S}/extra.xml`, `${S}/nested-index.xml`, `${S}/pages.xml`, `${S}/deep.xml`]);
  assert.deepEqual(result.urls, [`${S}/extra`, `${S}/p1`, `${S}/p2`, `${S}/deep`]);
  assert.deepEqual(result.files.map((f) => [f.type, f.count]), [['index', 2], ['urlset', 1], ['index', 1], ['urlset', 2], ['urlset', 2]]);
  assert.equal(result.truncated, false);
});

test('maxFiles stops reading and marks the result truncated', async () => {
  const { fetch, calls } = fakeFetch({
    [`${S}/index.xml`]: { text: index([`${S}/1.xml`, `${S}/2.xml`, `${S}/3.xml`]) },
    [`${S}/1.xml`]: { text: urlset([`${S}/one`]) },
    [`${S}/2.xml`]: { text: urlset([`${S}/two`]) },
  });
  const result = await loadSitemaps([`${S}/index.xml`], { fetch, maxFiles: 3 });
  assert.equal(calls.length, 3);
  assert.equal(result.files.length, 3);
  assert.deepEqual(result.urls, [`${S}/one`, `${S}/two`]);
  assert.equal(result.truncated, true);
});

test('maxUrls caps the URL list and marks the result truncated', async () => {
  const { fetch } = fakeFetch({ [`${S}/s.xml`]: { text: urlset([`${S}/1`, `${S}/2`, `${S}/3`]) } });
  const cut = await loadSitemaps([`${S}/s.xml`], { fetch, maxUrls: 2 });
  assert.deepEqual(cut.urls, [`${S}/1`, `${S}/2`]);
  assert.equal(cut.truncated, true);
  const exact = await loadSitemaps([`${S}/s.xml`], { fetch, maxUrls: 3 });
  assert.equal(exact.truncated, false);
});

test('reads gzip-compressed sitemaps by their magic bytes', async () => {
  const { fetch } = fakeFetch({ [`${S}/s.xml.gz`]: { body: zlib.gzipSync(urlset([`${S}/zipped`])) } });
  const result = await loadSitemaps([`${S}/s.xml.gz`], { fetch });
  assert.deepEqual(result.urls, [`${S}/zipped`]);
  assert.equal(result.files[0].type, 'urlset');
});

test('broken gzip data is invalid', async () => {
  const { fetch } = fakeFetch({ [`${S}/s.xml.gz`]: { body: Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]) } });
  const result = await loadSitemaps([`${S}/s.xml.gz`], { fetch });
  assert.equal(result.files[0].type, 'invalid');
  assert.match(String(result.files[0].error), /gzip/);
});

test('handles comments, CDATA, entities and namespace prefixes; ignores image:loc', async () => {
  const xml = `<?xml version="1.0"?>
<!-- a comment with <loc>https://site.test/commented</loc> -->
<!DOCTYPE urlset>
<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <sm:url>
    <sm:loc>https://site.test/a?x=1&amp;y=2</sm:loc>
    <image:image><image:loc>https://site.test/photo.jpg</image:loc></image:image>
  </sm:url>
  <sm:url><sm:loc><![CDATA[https://site.test/b?x=1&y=2]]></sm:loc></sm:url>
  <sm:url><sm:loc>  https://site.test/&#99;&#x64;  </sm:loc><sm:lastmod>2026-01-01</sm:lastmod></sm:url>
  <sm:url><loc>https://site.test/wrong-prefix</loc></sm:url>
</sm:urlset>`;
  const { fetch } = fakeFetch({ [`${S}/s.xml`]: { text: xml } });
  const result = await loadSitemaps([`${S}/s.xml`], { fetch });
  assert.deepEqual(result.urls, [`${S}/a?x=1&y=2`, `${S}/b?x=1&y=2`, `${S}/cd`]);
  assert.equal(result.files[0].count, 3);
});

test('unrecognized or malformed content is invalid with a short error', async () => {
  const cases = {
    html: '<!doctype html><html><body>Hello</body></html>',
    text: 'https://site.test/a\nhttps://site.test/b\n',
    rss: '<?xml version="1.0"?><rss version="2.0"><channel><item><link>https://site.test/a</link></item></channel></rss>',
    mismatched: '<urlset><url><loc>https://site.test/a</url></loc></urlset>',
    unclosed: '<urlset><url><loc>https://site.test/a</loc></url>',
    comment: '<urlset><!-- never ends',
    empty: '',
  };
  for (const [name, text] of Object.entries(cases)) {
    const { fetch } = fakeFetch({ [`${S}/s.xml`]: { text } });
    const result = await loadSitemaps([`${S}/s.xml`], { fetch });
    assert.equal(result.files[0].type, 'invalid', name);
    assert.equal(typeof result.files[0].error, 'string', name);
    assert.ok(String(result.files[0].error).length < 120, name);
    assert.deepEqual(result.urls, [], name);
  }
});

test('a non-200 answer or a network error is unreachable', async () => {
  const { fetch } = fakeFetch({
    [`${S}/500.xml`]: { status: 500, text: 'oops' },
    [`${S}/301.xml`]: { status: 301, text: '' },
    [`${S}/err.xml`]: { status: 0, error: { code: 'timeout', message: 'too slow' } },
  });
  const result = await loadSitemaps([`${S}/500.xml`, `${S}/301.xml`, `${S}/err.xml`, `${S}/404.xml`], { fetch });
  assert.deepEqual(result.files.map((f) => [f.type, f.status]), [['unreachable', 500], ['unreachable', 301], ['unreachable', 0], ['unreachable', 404]]);
  assert.match(String(result.files[2].error), /timeout/);
});

test('a /sitemap.xml guess that is not a 200 sitemap gives no files at all', async () => {
  /** @type {Record<string, any>} */
  const answers = {
    404: { status: 404, text: 'none' },
    410: { status: 410, text: 'gone' },
    403: { status: 403, text: 'forbidden' },
    500: { status: 500, text: 'oops' },
    html: { status: 200, headers: { 'content-type': 'text/html' }, text: '<!doctype html><html><body>Home</body></html>' },
    error: { status: 0, error: { code: 'timeout', message: 'slow' } },
  };
  for (const [name, answer] of Object.entries(answers)) {
    const { fetch } = fakeFetch({ [`${S}/sitemap.xml`]: answer });
    const result = await loadSitemaps([`${S}/sitemap.xml`], { fetch, probe: true, siteHost: 'site.test' });
    assert.deepEqual(result, { loaded: true, files: [], urls: [], truncated: false }, name);
  }
});

test('a /sitemap.xml guess that redirects to the home page gives no files', async () => {
  const { fetch } = fakeFetch({
    [`${S}/sitemap.xml`]: { status: 301, headers: { location: '/' } },
    [`${S}/`]: { status: 200, headers: { 'content-type': 'text/html' }, text: '<html><body>Home</body></html>' },
  });
  const result = await loadSitemaps([`${S}/sitemap.xml`], { fetch, probe: true, siteHost: 'site.test' });
  assert.deepEqual(result, { loaded: true, files: [], urls: [], truncated: false });
});

test('a /sitemap.xml guess that answers 200 with a sitemap counts as a file', async () => {
  const { fetch } = fakeFetch({ [`${S}/sitemap.xml`]: { text: urlset([`${S}/a`]) } });
  const result = await loadSitemaps([`${S}/sitemap.xml`], { fetch, probe: true, siteHost: 'site.test' });
  assert.equal(result.files.length, 1);
  assert.deepEqual(result.urls, [`${S}/a`]);
});

test('a listed sitemap that is not a 200 is still reported as unreachable', async () => {
  const notProbe = await loadSitemaps([`${S}/missing.xml`], { fetch: fakeFetch({}).fetch });
  assert.equal(notProbe.files[0].type, 'unreachable');
  assert.equal(notProbe.files[0].status, 404);
  assert.equal(notProbe.loaded, true);
});

test('a sitemap on another host is listed as external and never requested', async () => {
  const { fetch, calls } = fakeFetch({ [`${S}/s.xml`]: { text: urlset([`${S}/a`]) } });
  const result = await loadSitemaps(['https://cdn.other.test/s.xml', `${S}/s.xml`], { fetch, siteHost: 'site.test' });
  assert.deepEqual(result.files[0], { url: 'https://cdn.other.test/s.xml', status: 0, type: 'external', count: 0, error: 'On another host; not read' });
  assert.equal(result.files[1].type, 'urlset');
  assert.deepEqual(calls.map((c) => c.url), [`${S}/s.xml`]);
});

test('index children on another host are external; on-site children are read', async () => {
  const { fetch, calls } = fakeFetch({
    [`${S}/index.xml`]: { text: index(['https://other.test/a.xml', `${S}/b.xml`]) },
    [`${S}/b.xml`]: { text: urlset([`${S}/b`]) },
  });
  const result = await loadSitemaps([`${S}/index.xml`], { fetch, siteHost: 'site.test' });
  assert.deepEqual(result.files.map((f) => [f.url, f.type]), [[`${S}/index.xml`, 'index'], ['https://other.test/a.xml', 'external'], [`${S}/b.xml`, 'urlset']]);
  assert.equal(calls.some((c) => c.url.startsWith('https://other.test')), false);
});

test('a sitemap that redirects off the site is external and the target is not requested', async () => {
  const { fetch, calls } = fakeFetch({ [`${S}/s.xml`]: { status: 302, headers: { location: 'https://other.test/s.xml' } } });
  const result = await loadSitemaps([`${S}/s.xml`], { fetch, siteHost: 'site.test' });
  assert.deepEqual(result.files, [{ url: `${S}/s.xml`, status: 0, type: 'external', count: 0, error: 'On another host; not read' }]);
  assert.deepEqual(calls.map((c) => c.url), [`${S}/s.xml`]);
});

test('on-site redirects are followed hop by hop, each a separate request without automatic redirects', async () => {
  const { fetch, calls } = fakeFetch({
    [`${S}/s.xml`]: { status: 301, headers: { location: '/new.xml' } },
    [`${S}/new.xml`]: { text: urlset([`${S}/a`]) },
  });
  const result = await loadSitemaps([`${S}/s.xml`], { fetch, siteHost: 'site.test' });
  assert.deepEqual(result.urls, [`${S}/a`]);
  assert.deepEqual(result.files.map((f) => [f.url, f.type]), [[`${S}/s.xml`, 'urlset']]);
  assert.deepEqual(calls.map((c) => [c.url, c.options.maxRedirects]), [[`${S}/s.xml`, 0], [`${S}/new.xml`, 0]]);
});

test('a sitemap redirect loop is unreachable', async () => {
  const { fetch } = fakeFetch({
    [`${S}/a.xml`]: { status: 301, headers: { location: '/b.xml' } },
    [`${S}/b.xml`]: { status: 301, headers: { location: '/a.xml' } },
  });
  const result = await loadSitemaps([`${S}/a.xml`], { fetch, siteHost: 'site.test' });
  assert.equal(result.files[0].type, 'unreachable');
  assert.match(String(result.files[0].error), /redirect_loop/);
});

test('a body cut at the download limit keeps the URLs read so far and is marked truncated', async () => {
  const full = urlset([`${S}/a`, `${S}/b`]);
  const cutAt = full.indexOf('<url><loc>https://site.test/b');
  const { fetch } = fakeFetch({ [`${S}/s.xml`]: { text: full.slice(0, cutAt + 12), truncated: true } });
  const result = await loadSitemaps([`${S}/s.xml`], { fetch });
  assert.deepEqual(result.urls, [`${S}/a`]);
  assert.equal(result.files[0].type, 'urlset');
  assert.equal(result.truncated, true);
});

test('invalid arguments throw TypeError', async () => {
  await assert.rejects(loadSitemaps(/** @type {any} */ ('x')), TypeError);
  await assert.rejects(loadSitemaps([], { maxFiles: 0 }), TypeError);
  await assert.rejects(loadSitemaps([], { maxUrls: 1.5 }), TypeError);
});

test('scanSitemap reports the document type and locs', () => {
  assert.deepEqual(scanSitemap(index(['https://x.test/1.xml'])), { type: 'index', locs: ['https://x.test/1.xml'], error: null });
  assert.equal(scanSitemap('<feed></feed>').type, null);
});

test('works end to end with safeFetch against a local server', async () => {
  const server = await startServer({
    '/sitemap.xml': { headers: { 'content-type': 'application/xml' }, body: '<sitemapindex><sitemap><loc>{origin}/pages.xml.gz</loc></sitemap></sitemapindex>' },
    '/pages.xml.gz': (_req, res, { origin }) => {
      res.writeHead(200, { 'content-type': 'application/gzip' });
      res.end(zlib.gzipSync(urlset([`${origin}/one`, `${origin}/two`])));
    },
  });
  try {
    const result = await loadSitemaps([`${server.origin}/sitemap.xml`], { fetchOptions: { allowLoopback: true } });
    assert.deepEqual(result.urls, [`${server.origin}/one`, `${server.origin}/two`]);
    assert.equal(server.requests[0].headers.accept, 'application/xml,text/xml;q=0.9,*/*;q=0.5');
  } finally {
    await server.close();
  }
});

const DISALLOWED = { status: 0, type: 'disallowed', count: 0, error: 'robots.txt does not allow this request or could not be read; not read' };
/** @param {string} prefix */
const allowAllBut = (prefix) => (/** @type {string} */ url) => !url.startsWith(prefix);

test('a listed file that isAllowed refuses is not requested and does not count toward maxFiles', async () => {
  const { fetch, calls } = fakeFetch({ [`${S}/ok.xml`]: { text: urlset([`${S}/a`]) } });
  const result = await loadSitemaps([`${S}/private/s.xml`, `${S}/ok.xml`], { fetch, siteHost: 'site.test', maxFiles: 1, isAllowed: allowAllBut(`${S}/private`) });
  assert.deepEqual(result.files, [{ url: `${S}/private/s.xml`, ...DISALLOWED }, { url: `${S}/ok.xml`, status: 200, type: 'urlset', count: 1, error: null }]);
  assert.deepEqual(result.urls, [`${S}/a`]);
  assert.equal(result.truncated, false);
  assert.deepEqual(calls.map((c) => c.url), [`${S}/ok.xml`]);
});

test('isAllowed is asked for index children and may answer with a promise', async () => {
  const { fetch, calls } = fakeFetch({
    [`${S}/index.xml`]: { text: index([`${S}/private/a.xml`, `${S}/b.xml`]) },
    [`${S}/b.xml`]: { text: urlset([`${S}/b`]) },
  });
  /** @type {string[]} */
  const asked = [];
  const isAllowed = async (/** @type {string} */ url) => {
    asked.push(url);
    return !url.includes('/private/');
  };
  const result = await loadSitemaps([`${S}/index.xml`], { fetch, siteHost: 'site.test', isAllowed });
  assert.deepEqual(result.files.map((f) => [f.url, f.type]), [[`${S}/index.xml`, 'index'], [`${S}/private/a.xml`, 'disallowed'], [`${S}/b.xml`, 'urlset']]);
  assert.deepEqual(asked, [`${S}/index.xml`, `${S}/private/a.xml`, `${S}/b.xml`]);
  assert.equal(calls.some((c) => c.url.includes('/private/')), false);
});

test('a redirect to a disallowed URL gives a disallowed file, and the hop is not requested', async () => {
  const { fetch, calls } = fakeFetch({ [`${S}/s.xml`]: { status: 301, headers: { location: '/private/s.xml' } } });
  const result = await loadSitemaps([`${S}/s.xml`], { fetch, siteHost: 'site.test', isAllowed: allowAllBut(`${S}/private`) });
  assert.deepEqual(result.files, [{ url: `${S}/s.xml`, ...DISALLOWED }]);
  assert.deepEqual(calls.map((c) => c.url), [`${S}/s.xml`]);
});

test('a guess that isAllowed refuses is not requested and the sitemaps count as not looked for', async () => {
  const { fetch, calls } = fakeFetch({ [`${S}/sitemap.xml`]: { text: urlset([`${S}/a`]) } });
  const refused = await loadSitemaps([`${S}/sitemap.xml`], { fetch, probe: true, siteHost: 'site.test', isAllowed: () => false });
  assert.deepEqual(refused, { loaded: false, files: [{ url: `${S}/sitemap.xml`, ...DISALLOWED }], urls: [], truncated: false });
  assert.equal(calls.length, 0);

  const allowed = await loadSitemaps([`${S}/sitemap.xml`], { fetch, probe: true, siteHost: 'site.test', isAllowed: () => true });
  assert.equal(allowed.loaded, true);
  assert.deepEqual(allowed.urls, [`${S}/a`]);
});

test('a guess whose redirect leads to a refused URL counts as not looked for, with one disallowed file', async () => {
  const { fetch, calls } = fakeFetch({ [`${S}/sitemap.xml`]: { status: 301, headers: { location: '/private/map.xml' } } });
  const result = await loadSitemaps([`${S}/sitemap.xml`], { fetch, probe: true, siteHost: 'site.test', isAllowed: allowAllBut(`${S}/private`) });
  assert.deepEqual(result, { loaded: false, files: [{ url: `${S}/sitemap.xml`, ...DISALLOWED }], urls: [], truncated: false });
  assert.deepEqual(calls.map((c) => c.url), [`${S}/sitemap.xml`], 'the refused target is not requested');
});

test('a guess that redirects to another host counts as not looked for, with one external file', async () => {
  const { fetch, calls } = fakeFetch({ [`${S}/sitemap.xml`]: { status: 301, headers: { location: 'https://other.test/sitemap.xml' } } });
  const result = await loadSitemaps([`${S}/sitemap.xml`], { fetch, probe: true, siteHost: 'site.test' });
  assert.deepEqual(result, {
    loaded: false,
    files: [{ url: `${S}/sitemap.xml`, status: 0, type: 'external', count: 0, error: 'On another host; not read' }],
    urls: [],
    truncated: false,
  });
  assert.deepEqual(calls.map((c) => c.url), [`${S}/sitemap.xml`], 'the other host is not requested');
});

test('a guess that answers 404 was looked for and means there are no files', async () => {
  const { fetch } = fakeFetch({ [`${S}/sitemap.xml`]: { status: 404 } });
  const result = await loadSitemaps([`${S}/sitemap.xml`], { fetch, probe: true, siteHost: 'site.test' });
  assert.deepEqual(result, { loaded: true, files: [], urls: [], truncated: false });
});

test('a guess whose redirect leads to an allowed sitemap is read', async () => {
  const { fetch } = fakeFetch({
    [`${S}/sitemap.xml`]: { status: 301, headers: { location: '/maps/map.xml' } },
    [`${S}/maps/map.xml`]: { text: urlset([`${S}/a`]) },
  });
  const result = await loadSitemaps([`${S}/sitemap.xml`], { fetch, probe: true, siteHost: 'site.test', isAllowed: allowAllBut(`${S}/private`) });
  assert.equal(result.loaded, true);
  assert.deepEqual(result.urls, [`${S}/a`]);
});

test('a listed file whose redirect is refused was requested, so it counts toward maxFiles', async () => {
  const { fetch, calls } = fakeFetch({
    [`${S}/a.xml`]: { status: 301, headers: { location: '/private/a.xml' } },
    [`${S}/b.xml`]: { text: urlset([`${S}/b`]) },
  });
  const result = await loadSitemaps([`${S}/a.xml`, `${S}/b.xml`], { fetch, siteHost: 'site.test', maxFiles: 1, isAllowed: allowAllBut(`${S}/private`) });
  assert.deepEqual(result.files, [{ url: `${S}/a.xml`, ...DISALLOWED }]);
  assert.equal(result.truncated, true);
  assert.deepEqual(calls.map((c) => c.url), [`${S}/a.xml`]);
});
