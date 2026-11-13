// URLs that end in .js, .json, .xml or .txt can be pages ("/wiki/Next.js").
// The crawler asks with HEAD and crawls the ones that answer HTML; the others
// get no record, as before.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { asksFirst } from '../../plugin/server/src/crawl/chain.js';
import { startServer } from '../helpers/http-server.js';
import { crawl, html, removeTempDirs } from './harness.js';

after(removeTempDirs);

test('a page whose URL ends in .js is crawled when HEAD says it is HTML; a script, JSON or text file is not', async () => {
  const server = await startServer({
    '/': html(['/wiki/Next.js', '/learn/node.js', '/app.js', '/data.json', '/notes.txt', '/feed.xml']),
    '/wiki/Next.js': html(['/wiki/React']),
    '/wiki/React': html([]),
    '/learn/node.js': { status: 301, headers: { location: '/learn/node' } },
    '/learn/node': html([]),
    '/app.js': { headers: { 'content-type': 'text/javascript' }, body: 'console.log(1)' },
    '/data.json': { headers: { 'content-type': 'application/json' }, body: '{}' },
    '/notes.txt': { status: 404, headers: { 'content-type': 'text/html' }, body: '<p>missing</p>' },
    '/feed.xml': { headers: { 'content-type': 'application/rss+xml' }, body: '<rss/>' },
  });
  try {
    const { result } = await crawl({ url: `${server.origin}/`, allowLoopback: true });
    const recorded = (result?.pages ?? []).map((page) => page.url.replace(server.origin, ''));
    assert.deepEqual(recorded.sort(), ['/', '/learn/node', '/learn/node.js', '/wiki/Next.js', '/wiki/React'].sort());
    const requests = server.requests.map((request) => `${request.method} ${request.url}`);
    // Files are asked about with HEAD only; their bodies are never fetched.
    for (const file of ['/app.js', '/data.json', '/feed.xml']) {
      assert.ok(requests.includes(`HEAD ${file}`), file);
      assert.ok(!requests.includes(`GET ${file}`), file);
    }
    assert.ok(requests.includes('HEAD /wiki/Next.js') && requests.includes('GET /wiki/Next.js'));
    // A HEAD that fails is retried with a GET of at most 16 KB, as for any file; a 404 is not a page.
    assert.ok(requests.includes('GET /notes.txt'));
  } finally {
    await server.close();
  }
});

test('only .js, .json, .xml and .txt are asked about first', () => {
  for (const url of ['https://x.test/wiki/Next.js', 'https://x.test/a.JSON', 'https://x.test/feed.xml', 'https://x.test/llms.txt']) assert.equal(asksFirst(url), true, url);
  for (const url of ['https://x.test/', 'https://x.test/a.pdf', 'https://x.test/page.html', 'https://x.test/blog/c.json-guide', 'not a url']) assert.equal(asksFirst(url), false, url);
});

test('at most 50 such URLs are asked about in one crawl', async () => {
  const files = Array.from({ length: 60 }, (_, i) => `/f${i}.json`);
  /** @type {Record<string, unknown>} */
  const routes = { '/': html(files) };
  for (const file of files) routes[file] = { headers: { 'content-type': 'application/json' }, body: '{}' };
  const server = await startServer(routes);
  try {
    await crawl({ url: `${server.origin}/`, allowLoopback: true, maxPages: 100 });
    assert.equal(server.requests.filter((request) => request.url.endsWith('.json')).length, 50);
  } finally {
    await server.close();
  }
});
