// robots.txt applies to sitemap requests too: the crawler, the sitemap check and the audit notes.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { buildContext, runChecks } from '../../plugin/server/src/checks/engine.js';
import { checks as seoChecks } from '../../plugin/server/src/checks/seo/index.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { SITE, makeCrawl } from '../helpers/factories.js';
import { startServer } from '../helpers/http-server.js';
import { jobFor, makeDeps, sampleCrawl, toolNamed } from '../tools/fakes.js';
import { fakeFetch } from '../net/fake-fetch.js';
import { crawl, html, removeTempDirs } from './harness.js';

/** @import { SitemapSummary } from '../../plugin/server/src/types.js' */

after(removeTempDirs);

/**
 * Run one SEO check through the real engine.
 * @param {string} id
 * @param {import('../../plugin/server/src/types.js').CrawlResult} crawlResult
 */
function runOne(id, crawlResult) {
  const check = seoChecks.find((def) => def.id === id);
  if (!check) throw new Error(`no check ${id}`);
  const { checks: stats, findings } = runChecks([check], buildContext(crawlResult, {}), { detectedAt: '2026-11-11T00:00:00.000Z' });
  return { stat: stats[0], findings };
}

const text = { 'content-type': 'text/plain' };
const urlset = (/** @type {string[]} */ locs) => ({
  headers: { 'content-type': 'application/xml' },
  body: `<urlset>${locs.map((l) => `<url><loc>${l}</loc></url>`).join('')}</urlset>`,
});

test('a Sitemap: line under a disallowed path is not requested', async () => {
  const server = await startServer({
    '/robots.txt': { headers: text, body: 'User-agent: *\nDisallow: /private/\nSitemap: {origin}/private/sitemap.xml\n' },
    '/': html([]),
    '/private/sitemap.xml': urlset(['{origin}/hidden']),
  });
  try {
    const { result } = await crawl({ url: `${server.origin}/`, allowLoopback: true });
    assert.deepEqual(result?.sitemap.files, [{ url: `${server.origin}/private/sitemap.xml`, status: 0, type: 'disallowed', count: 0, error: 'robots.txt does not allow this request or could not be read; not read' }]);
    assert.equal(result?.sitemap.loaded, true);
    assert.equal(server.requests.some((r) => r.url.startsWith('/private/')), false);
  } finally {
    await server.close();
  }
});

test('an allowed Sitemap: line is read', async () => {
  const server = await startServer({
    '/robots.txt': { headers: text, body: 'User-agent: *\nDisallow: /private/\nSitemap: {origin}/sitemap.xml\n' },
    '/': html([]),
    '/sitemap.xml': urlset(['{origin}/']),
  });
  try {
    const { result } = await crawl({ url: `${server.origin}/`, allowLoopback: true });
    assert.equal(result?.sitemap.files[0].type, 'urlset');
  } finally {
    await server.close();
  }
});

test('when robots.txt disallows /sitemap.xml, the guess is not requested and sitemaps count as not looked for', async () => {
  const server = await startServer({
    '/robots.txt': { headers: text, body: 'User-agent: *\nDisallow: /\nAllow: /$\n' },
    '/': html([]),
    '/sitemap.xml': urlset(['{origin}/']),
  });
  try {
    const { job, result } = await crawl({ url: `${server.origin}/`, allowLoopback: true });
    assert.equal(job?.status, 'done');
    assert.deepEqual(result?.sitemap, {
      loaded: false,
      files: [{ url: `${server.origin}/sitemap.xml`, status: 0, type: 'disallowed', count: 0, error: 'robots.txt does not allow this request or could not be read; not read' }],
      urls: [],
      truncated: false,
    });
    assert.equal(server.requests.some((r) => r.url === '/sitemap.xml'), false);
    const missing = runOne('seo.sitemap.missing', /** @type {import('../../plugin/server/src/types.js').CrawlResult} */ (result));
    assert.equal(missing.stat?.applicable, 0, 'seo.sitemap.missing stays silent');
  } finally {
    await server.close();
  }
});

test('seo.sitemap.file_error leaves disallowed files out and still judges the others', () => {
  /** @type {SitemapSummary} */
  const sitemap = {
    loaded: true,
    urls: [],
    truncated: false,
    files: [
      { url: `${SITE}/private/s.xml`, status: 0, type: 'disallowed', count: 0, error: 'robots.txt does not allow this request or could not be read; not read' },
      { url: `${SITE}/broken.xml`, status: 500, type: 'unreachable', count: 0, error: 'HTTP status 500' },
      { url: `${SITE}/ok.xml`, status: 200, type: 'urlset', count: 2, error: null },
    ],
  };
  const { stat, findings } = runOne('seo.sitemap.file_error', makeCrawl({ sitemap }));
  assert.equal(stat?.applicable, 2);
  assert.deepEqual(findings.map((f) => f.url), [`${SITE}/broken.xml`]);
});

/** @param {Parameters<typeof sampleCrawl>[0]} overrides */
async function notesFor(overrides) {
  const crawlResult = sampleCrawl(overrides);
  const fake = makeDeps({ jobs: [jobFor(crawlResult)], results: [crawlResult] });
  // The shared tool fakes are typed loosely; cast to the real dependency type.
  const tools = createTools(/** @type {Parameters<typeof createTools>[0]} */ (/** @type {unknown} */ (fake.deps)));
  const result = /** @type {{notes: string[]}} */ (await toolNamed(tools, 'audit_run').handler({ job_id: 'c-1' }));
  return result.notes;
}

test('the audit notes how many sitemap files robots.txt kept the crawler from reading', async () => {
  const file = { status: 0, type: /** @type {const} */ ('disallowed'), count: 0, error: 'robots.txt does not allow this request or could not be read; not read' };
  const two = await notesFor({ sitemap: { loaded: true, urls: [], truncated: false, files: [{ url: `${SITE}/p/a.xml`, ...file }, { url: `${SITE}/p/b.xml`, ...file }] } });
  assert.ok(two.includes('2 sitemap files were not read because robots.txt does not allow the crawler to request them, or could not be read.'));
  const one = await notesFor({ sitemap: { loaded: true, urls: [], truncated: false, files: [{ url: `${SITE}/p/a.xml`, ...file }] } });
  assert.ok(one.includes('1 sitemap file was not read because robots.txt does not allow the crawler to request it, or could not be read.'));
  const none = await notesFor({});
  assert.equal(none.some((note) => /sitemap/.test(note)), false);
});

const NOT_LOOKED_NOTE = 'No sitemap could be read: robots.txt lists none, and it does not allow the crawler to read /sitemap.xml (or robots.txt itself could not be read).';

test('the audit notes when the /sitemap.xml guess may not be read, also when the crawl was blocked later', async () => {
  const refusedGuess = {
    loaded: false,
    files: [{ url: `${SITE}/sitemap.xml`, status: 0, type: /** @type {const} */ ('disallowed'), count: 0, error: 'robots.txt does not allow this request or could not be read; not read' }],
    urls: [],
    truncated: false,
  };
  const quiet = await notesFor({ sitemap: refusedGuess });
  assert.ok(quiet.includes(NOT_LOOKED_NOTE));
  assert.equal(quiet.some((note) => /sitemap files? (was|were) not read/.test(note)), false, 'the count note is only for sitemaps that were looked for');
  const blockedLater = await notesFor({ sitemap: refusedGuess, blocked: { reason: 'rate_limited', url: `${SITE}/x`, status: 429 } });
  assert.ok(blockedLater.includes(NOT_LOOKED_NOTE));
});

test('a /sitemap.xml guess that leads to another host is noted, and seo.sitemap.missing stays silent', async () => {
  const externalGuess = {
    loaded: false,
    files: [{ url: `${SITE}/sitemap.xml`, status: 0, type: /** @type {const} */ ('external'), count: 0, error: 'On another host; not read' }],
    urls: [],
    truncated: false,
  };
  const notes = await notesFor({ sitemap: externalGuess });
  assert.ok(notes.includes('No sitemap could be read: robots.txt lists none, and /sitemap.xml redirects to another host, which the crawler does not read.'));
  assert.equal(notes.includes(NOT_LOOKED_NOTE), false);
  const silent = runOne('seo.sitemap.missing', makeCrawl({ sitemap: externalGuess }));
  assert.equal(silent.stat?.applicable, 0);
  assert.deepEqual(silent.findings, []);
  const looked = runOne('seo.sitemap.missing', makeCrawl({ sitemap: { loaded: true, files: [], urls: [], truncated: false } }));
  assert.deepEqual(looked.findings.map((f) => f.check_id), ['seo.sitemap.missing'], 'a guess that was looked for and found nothing is still reported');
});

test('no "could not be read" note when the crawl stopped before sitemaps', async () => {
  const stoppedEarly = await notesFor({ sitemap: { loaded: false, files: [], urls: [], truncated: false }, blocked: { reason: 'bot_challenge', url: `${SITE}/`, status: 403 } });
  assert.equal(stoppedEarly.some((note) => note.startsWith('No sitemap could be read')), false);
});

test('a /sitemap.xml guess that redirects to a disallowed path is not read and counts as not looked for', async () => {
  const server = await startServer({
    '/robots.txt': { headers: text, body: 'User-agent: *\nDisallow: /private/\n' },
    '/': html([]),
    '/sitemap.xml': { status: 301, redirect: '/private/sitemap.xml' },
    '/private/sitemap.xml': urlset(['{origin}/']),
  });
  try {
    const { result } = await crawl({ url: `${server.origin}/`, allowLoopback: true });
    assert.equal(result?.sitemap.loaded, false);
    assert.deepEqual(result?.sitemap.files.map((f) => [f.url, f.type]), [[`${server.origin}/sitemap.xml`, 'disallowed']]);
    assert.equal(server.requests.some((r) => r.url.startsWith('/private/')), false);
    const missing = runOne('seo.sitemap.missing', /** @type {import('../../plugin/server/src/types.js').CrawlResult} */ (result));
    assert.equal(missing.stat?.applicable, 0, 'seo.sitemap.missing stays silent');
  } finally {
    await server.close();
  }
});

test('a sitemap on a subdomain whose robots.txt cannot be read is not read, and its words say so', async () => {
  const S = 'https://site.test';
  const table = {
    [`${S}/robots.txt`]: { headers: { 'content-type': 'text/plain' }, text: 'Sitemap: https://blog.site.test/sitemap.xml\n' },
    [`${S}/`]: { headers: { 'content-type': 'text/html' }, text: '' },
    'https://blog.site.test/sitemap.xml': { headers: { 'content-type': 'application/xml' }, text: '<urlset><url><loc>https://blog.site.test/a</loc></url></urlset>' },
  };
  const down = fakeFetch({ ...table, 'https://blog.site.test/robots.txt': { status: 503, text: 'down' } });
  const refused = await crawl({ url: `${S}/`, includeSubdomains: true }, { fetch: down.fetch });
  assert.deepEqual(refused.result?.sitemap.files, [{
    url: 'https://blog.site.test/sitemap.xml', status: 0, type: 'disallowed', count: 0,
    error: 'robots.txt does not allow this request or could not be read; not read',
  }]);
  assert.equal(down.calls.some((c) => c.url === 'https://blog.site.test/sitemap.xml'), false);

  const fine = fakeFetch(table);
  const read = await crawl({ url: `${S}/`, includeSubdomains: true }, { fetch: fine.fetch });
  assert.equal(read.result?.sitemap.files[0].type, 'urlset');
});
