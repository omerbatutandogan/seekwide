import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { USER_AGENT } from '../../plugin/server/src/config.js';
import { fetchLlmsTxt, readLlmsTxt } from '../../plugin/server/src/net/llms-txt.js';
import { createHostGates } from '../../plugin/server/src/net/polite.js';
import { createRobotsCache } from '../../plugin/server/src/net/robots-cache.js';
import { safeFetch } from '../../plugin/server/src/net/safe-fetch.js';
import { startServer } from '../helpers/http-server.js';

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {Awaited<ReturnType<typeof startServer>>} */
let blocked;

before(async () => {
  server = await startServer({
    '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' },
    '/llms.txt': { headers: { 'content-type': 'text/markdown' }, body: '﻿# Example\n\n> Summary\n\n- [Docs]({origin}/docs): docs\n- [API]({origin}/api)\n' },
    '/a/llms.txt': { status: 301, redirect: '{origin}/' },
    '/': { headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>Home</title>' },
  });
  blocked = await startServer({ '/robots.txt': { body: 'User-agent: *\nDisallow: /llms.txt\n' } });
});

after(async () => {
  await server.close();
  await blocked.close();
});

/** @param {string} origin @param {Record<string, unknown>} [extra] */
const read = (origin, extra = {}) => fetchLlmsTxt(origin, {
  sleep: async () => {}, hosts: createHostGates(), robotsCache: createRobotsCache(), fetchOptions: { allowLoopback: origin }, ...extra,
});

test('readLlmsTxt finds the H1, whether it comes first, and counts Markdown links', () => {
  assert.deepEqual(readLlmsTxt('# Site\n\n- [a](b)\n- [c](d)'), { h1: 'Site', h1First: true, links: 2 });
  assert.deepEqual(readLlmsTxt('intro\n# Site'), { h1: 'Site', h1First: false, links: 0 });
  assert.deepEqual(readLlmsTxt('## Only H2\n#NoSpace'), { h1: null, h1First: false, links: 0 });
});

test('a served file: one GET after robots.txt, with the crawler\'s user agent; only its H1 and link count are kept', async () => {
  const result = await read(server.origin);
  assert.deepEqual({ ...result, bytes: 0 }, {
    url: `${server.origin}/llms.txt`, outcome: 'found', status: 200, reason: null, final_url: null, content_type: 'text/markdown', h1: 'Example', links: 2, bytes: 0, truncated: false,
  });
  assert.deepEqual(server.requests.map((request) => request.url), ['/robots.txt', '/llms.txt']);
  assert.ok(server.requests.every((request) => request.headers['user-agent'] === USER_AGENT));
});

test('a robots.txt rule keeps it from being requested at all', async () => {
  const result = await read(blocked.origin);
  assert.deepEqual([result.outcome, result.reason], ['disallowed', 'Disallowed by robots.txt']);
  assert.deepEqual(blocked.requests.map((request) => request.url), ['/robots.txt']);
});

test('a missing file, an HTML page, a redirect to the start page and a redirect off the site are not a file', async () => {
  const missing = await startServer({ '/robots.txt': { status: 404 } });
  const page = await startServer({ '/llms.txt': { headers: { 'content-type': 'text/html' }, body: '<!doctype html><title>Not found</title>' } });
  const home = await startServer({ '/llms.txt': { status: 302, redirect: '{origin}/' }, '/': { headers: { 'content-type': 'text/html' }, body: '<!doctype html><p>Home</p>' } });
  const away = await startServer({ '/llms.txt': { status: 302, redirect: 'https://elsewhere.example/llms.txt' } });
  try {
    assert.deepEqual([(await read(missing.origin)).outcome, (await read(missing.origin)).reason], ['not_found', 'status_404']);
    assert.deepEqual([(await read(page.origin)).outcome, (await read(page.origin)).reason], ['not_found', 'html_page']);
    const toHome = await read(home.origin, { startUrl: `${home.origin}/` });
    assert.deepEqual([toHome.outcome, toHome.reason, toHome.status], ['not_found', 'redirects_to_start', 302]);
    const off = await read(away.origin);
    assert.deepEqual([off.outcome, off.reason], ['unverifiable', 'Redirects off the site, so not followed']);
    assert.ok(!away.requests.some((request) => request.url !== '/robots.txt' && request.url !== '/llms.txt'));
  } finally {
    await Promise.all([missing.close(), page.close(), home.close(), away.close()]);
  }
});

test('only the first part of a long file is read', async () => {
  const long = await startServer({ '/llms.txt': { headers: { 'content-type': 'text/plain' }, body: `# Big\n${'- [x](y)\n'.repeat(5000)}` } });
  try {
    const result = await read(long.origin, { maxBytes: 1024 });
    assert.deepEqual([result.outcome, result.h1, result.truncated, result.bytes <= 1024], ['found', 'Big', true, true]);
  } finally {
    await long.close();
  }
});

test('the default safeFetch refuses loopback unless the origin was allowed', async () => {
  const result = await fetchLlmsTxt(server.origin, { sleep: async () => {}, hosts: createHostGates(), robotsCache: createRobotsCache(), fetch: safeFetch });
  assert.equal(result.outcome, 'unverifiable');
});
