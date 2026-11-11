import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadRobots } from '../../server/src/net/robots.js';
import { startServer } from '../helpers/http-server.js';
import { fakeFetch } from './fake-fetch.js';

const ORIGIN = 'https://site.test';
const ROBOTS = `${ORIGIN}/robots.txt`;

/** @param {string} text @param {object} [extra] */
const withRobots = (text, extra = {}) => fakeFetch({ [ROBOTS]: { status: 200, text, ...extra } });

test('a 2xx robots.txt is parsed and its rules apply to the seekwide product token', async () => {
  const { fetch } = withRobots('User-agent: *\nDisallow: /private\n\nUser-agent: seekwide\nDisallow: /no-seekwide\n');
  const robots = await loadRobots(ORIGIN, { fetch });
  assert.equal(robots.summary.status, 'ok');
  assert.equal(robots.summary.http_status, 200);
  assert.equal(robots.summary.url, ROBOTS);
  assert.equal(robots.isAllowed(`${ORIGIN}/no-seekwide/page`), false);
  assert.equal(robots.isAllowed(`${ORIGIN}/private`), true, 'the * group does not apply when seekwide has its own group');
  assert.equal(robots.isAllowed(`${ORIGIN}/public`), true);
});

test('the * group applies when there is no seekwide group', async () => {
  const { fetch } = withRobots('User-agent: *\nDisallow: /private\nAllow: /private/open\n');
  const robots = await loadRobots(ORIGIN, { fetch });
  assert.equal(robots.isAllowed(`${ORIGIN}/private/x`), false);
  assert.equal(robots.isAllowed(`${ORIGIN}/private/open`), true);
  assert.equal(robots.isAllowed(`${ORIGIN}/`), true);
});

test('productToken selects another group', async () => {
  const { fetch } = withRobots('User-agent: otherbot\nDisallow: /\n');
  const robots = await loadRobots(ORIGIN, { fetch, productToken: 'otherbot' });
  assert.equal(robots.isAllowed(`${ORIGIN}/page`), false);
});

test('a URL on another origin is not governed by this file', async () => {
  const { fetch } = withRobots('User-agent: *\nDisallow: /\n');
  const robots = await loadRobots(ORIGIN, { fetch });
  assert.equal(robots.isAllowed(`${ORIGIN}/page`), false);
  assert.equal(robots.isAllowed('https://other.test/page'), true);
  assert.equal(robots.isAllowed('http://site.test/page'), true);
  assert.equal(robots.isAllowed('https://sub.site.test/page'), true);
});

test('a 4xx other than 429 means missing: everything is allowed', async () => {
  for (const status of [400, 401, 403, 404, 410]) {
    const { fetch } = fakeFetch({ [ROBOTS]: { status, text: 'nope' } });
    const robots = await loadRobots(ORIGIN, { fetch });
    assert.equal(robots.summary.status, 'missing', String(status));
    assert.equal(robots.summary.http_status, status);
    assert.equal(robots.isAllowed(`${ORIGIN}/anything`), true);
  }
});

test('429, 5xx and network errors mean unreachable: nothing on the origin is allowed', async () => {
  for (const status of [429, 500, 503]) {
    const { fetch } = fakeFetch({ [ROBOTS]: { status, text: 'later' } });
    const robots = await loadRobots(ORIGIN, { fetch });
    assert.equal(robots.summary.status, 'unreachable', String(status));
    assert.equal(robots.isAllowed(`${ORIGIN}/`), false);
    assert.equal(robots.isAllowed('https://other.test/'), true);
  }
  const { fetch } = fakeFetch({ [ROBOTS]: { status: 0, error: { code: 'timeout', message: 'slow' } } });
  const robots = await loadRobots(ORIGIN, { fetch });
  assert.equal(robots.summary.status, 'unreachable');
  assert.equal(robots.summary.http_status, 0);
  assert.equal(robots.isAllowed(`${ORIGIN}/`), false);
});

test('crawl delay for the product token is reported', async () => {
  const { fetch } = withRobots('User-agent: *\nCrawl-delay: 4\n');
  assert.equal((await loadRobots(ORIGIN, { fetch })).summary.crawl_delay_sec, 4);
  const none = withRobots('User-agent: *\nDisallow:\n');
  assert.equal((await loadRobots(ORIGIN, { fetch: none.fetch })).summary.crawl_delay_sec, null);
});

test('disallows_all is true only when / and a probe path are both disallowed for an agent without its own group', async () => {
  const all = withRobots('User-agent: *\nDisallow: /\n');
  const allSummary = (await loadRobots(ORIGIN, { fetch: all.fetch })).summary;
  assert.equal(allSummary.disallows_all, true);
  assert.equal(allSummary.disallows_all_googlebot, true);

  const homeOnly = withRobots('User-agent: *\nDisallow: /$\n');
  assert.equal((await loadRobots(ORIGIN, { fetch: homeOnly.fetch })).summary.disallows_all, false);

  const ownGroup = withRobots('User-agent: seekwide\nDisallow: /\n');
  assert.equal((await loadRobots(ORIGIN, { fetch: ownGroup.fetch })).summary.disallows_all, false);
});

test('disallows_all_googlebot follows the Googlebot group', async () => {
  const google = withRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow:\n');
  const summary = (await loadRobots(ORIGIN, { fetch: google.fetch })).summary;
  assert.equal(summary.disallows_all_googlebot, true);
  assert.equal(summary.disallows_all, false);

  const allowed = withRobots('User-agent: Googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /\n');
  const second = (await loadRobots(ORIGIN, { fetch: allowed.fetch })).summary;
  assert.equal(second.disallows_all_googlebot, false);
  assert.equal(second.disallows_all, true);
});

test('sitemaps are normalized and de-duplicated in file order', async () => {
  const { fetch } = withRobots([
    'Sitemap: https://site.test/b.xml',
    'Sitemap: HTTPS://SITE.TEST/a.xml#frag',
    'Sitemap: https://site.test/b.xml',
    'Sitemap: ftp://site.test/c.xml',
    'Sitemap: https://site.test/a.xml?utm_source=x',
  ].join('\n'));
  const { summary } = await loadRobots(ORIGIN, { fetch });
  assert.deepEqual(summary.sitemaps, ['https://site.test/b.xml', 'https://site.test/a.xml']);
});

test('reads at most 500 KiB and passes fetch options through', async () => {
  const { fetch, calls } = withRobots('User-agent: *\nDisallow: /x\n');
  await loadRobots(`${ORIGIN}/some/page?q=1`, { fetch, fetchOptions: { allowLoopback: true, maxBytes: 10_000_000 } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, ROBOTS);
  assert.equal(calls[0].options.maxBytes, 500 * 1024);
  assert.equal(calls[0].options.allowLoopback, true);
});

test('rules after the first 500 KiB are ignored', async () => {
  const padding = `# ${'x'.repeat(600 * 1024)}\n`;
  const server = await startServer({
    '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: `User-agent: *\nDisallow: /early\n${padding}Disallow: /late\n` },
  });
  try {
    const robots = await loadRobots(server.origin, { fetchOptions: { allowLoopback: true } });
    assert.equal(robots.summary.status, 'ok');
    assert.equal(robots.isAllowed(`${server.origin}/early`), false);
    assert.equal(robots.isAllowed(`${server.origin}/late`), true);
  } finally {
    await server.close();
  }
});

test('works end to end with safeFetch against a local server', async () => {
  const server = await startServer({ '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /admin\nSitemap: {origin}/sitemap.xml\n' } });
  try {
    const robots = await loadRobots(server.origin, { fetchOptions: { allowLoopback: true } });
    assert.equal(robots.summary.status, 'ok');
    assert.deepEqual(robots.summary.sitemaps, [`${server.origin}/sitemap.xml`]);
    assert.equal(robots.isAllowed(`${server.origin}/admin/users`), false);
    assert.equal(robots.isAllowed(`${server.origin}/blog`), true);
  } finally {
    await server.close();
  }
});

test('an invalid origin throws TypeError', async () => {
  await assert.rejects(loadRobots('not a url'), TypeError);
  await assert.rejects(loadRobots(/** @type {any} */ (null)), TypeError);
});

test('a byte order mark at the start of the file does not hide the first rule', async () => {
  const { fetch } = withRobots('\uFEFFUser-agent: *\nDisallow: /x\n');
  const robots = await loadRobots(ORIGIN, { fetch });
  assert.equal(robots.isAllowed(`${ORIGIN}/x`), false);
});

/** @param {string} to */
const moved = (to) => ({ status: 301, headers: { location: to }, text: '' });

test('redirects are followed by hand, one request per hop, and the rules apply to the origin asked for', async () => {
  const { fetch, calls } = fakeFetch({
    [ROBOTS]: moved('/files/robots.txt'),
    [`${ORIGIN}/files/robots.txt`]: moved('https://cdn.other.test/robots.txt'),
    'https://cdn.other.test/robots.txt': { status: 200, text: 'User-agent: *\nDisallow: /secret\n' },
  });
  const robots = await loadRobots(ORIGIN, { fetch });
  assert.equal(robots.summary.status, 'ok');
  assert.equal(robots.summary.url, ROBOTS);
  assert.equal(robots.isAllowed(`${ORIGIN}/secret`), false);
  assert.equal(robots.isAllowed('https://cdn.other.test/secret'), true, 'another origin is not governed by this file');
  assert.deepEqual(calls.map((c) => c.url), [ROBOTS, `${ORIGIN}/files/robots.txt`, 'https://cdn.other.test/robots.txt']);
  assert.ok(calls.every((c) => c.options.maxRedirects === 0));
});

test('five redirects are followed; a sixth, or a loop, means missing', async () => {
  /** @param {number} count */
  const chainOf = (count) => {
    /** @type {Record<string, any>} */
    const table = {};
    for (let i = 0; i < count; i += 1) table[i === 0 ? ROBOTS : `${ORIGIN}/r${i}`] = moved(`${ORIGIN}/r${i + 1}`);
    table[`${ORIGIN}/r${count}`] = { status: 200, text: 'User-agent: *\nDisallow: /\n' };
    return fakeFetch(table);
  };
  const five = chainOf(5);
  const ok = await loadRobots(ORIGIN, { fetch: five.fetch });
  assert.equal(ok.summary.status, 'ok');
  assert.equal(ok.isAllowed(`${ORIGIN}/x`), false);

  const six = chainOf(6);
  const tooMany = await loadRobots(ORIGIN, { fetch: six.fetch });
  assert.equal(tooMany.summary.status, 'missing');
  assert.equal(tooMany.summary.http_status, 301);
  assert.equal(tooMany.isAllowed(`${ORIGIN}/x`), true);
  assert.equal(six.calls.length, 6, 'the sixth target is not requested');

  const loop = fakeFetch({ [ROBOTS]: moved('/a'), [`${ORIGIN}/a`]: moved('/robots.txt') });
  const looped = await loadRobots(ORIGIN, { fetch: loop.fetch });
  assert.equal(looped.summary.status, 'missing');
  assert.equal(loop.calls.length, 2);
});

test('a redirect without a valid http(s) Location is unreachable', async () => {
  for (const answer of [{ status: 301, text: '' }, moved('ftp://site.test/robots.txt')]) {
    const { fetch } = fakeFetch({ [ROBOTS]: answer });
    const robots = await loadRobots(ORIGIN, { fetch });
    assert.equal(robots.summary.status, 'unreachable');
    assert.equal(robots.summary.http_status, 301);
    assert.equal(robots.isAllowed(`${ORIGIN}/`), false);
  }
});
