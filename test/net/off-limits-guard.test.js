// No request ever reaches Google Play or a social platform, whatever path leads
// there: a robots.txt redirect, a redirect safeFetch follows itself, or a
// requester given its own fetch (review of batch 1, D1).

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { fetchAppFiles } from '../../plugin/server/src/net/app-files.js';
import { checkImageFiles } from '../../plugin/server/src/net/image-check.js';
import { checkExternalLinks } from '../../plugin/server/src/net/link-check.js';
import { createHostGates, guardFetch, offLimitsRefusal } from '../../plugin/server/src/net/polite.js';
import { createRobotsCache } from '../../plugin/server/src/net/robots-cache.js';
import { safeFetch } from '../../plugin/server/src/net/safe-fetch.js';
import { crawl, removeTempDirs } from '../crawl/harness.js';
import { startServer } from '../helpers/http-server.js';
import { fetchResult } from './fake-fetch.js';

after(removeTempDirs);

const isolated = () => ({ sleep: async () => {}, hosts: createHostGates(), robotsCache: createRobotsCache() });
const OFF_LIMITS = /facebook\.com|play\.google\.com|ytimg\.com/;

/** A fetch whose robots.txt redirects to an off-limits robots.txt, recording every URL it is asked for. */
function redirectingRobots(/** @type {string} */ to) {
  /** @type {string[]} */
  const sent = [];
  /** @param {string} url */
  const fetch = async (url) => {
    sent.push(url);
    if (url.endsWith('/robots.txt') && !OFF_LIMITS.test(url)) return fetchResult(url, { status: 301, headers: { location: to } });
    if (OFF_LIMITS.test(url)) return fetchResult(url, { text: 'User-agent: *\nAllow: /\n' });
    return fetchResult(url, { headers: { 'content-type': 'text/html' }, text: '<!doctype html><title>x</title><p>x</p>' });
  };
  return { fetch, sent };
}

for (const to of ['https://www.facebook.com/robots.txt', 'https://play.google.com/robots.txt']) {
  test(`a robots.txt that redirects to ${new URL(to).host} is not followed there by any collector`, async () => {
    const links = redirectingRobots(to);
    const linkResults = await checkExternalLinks(['https://a.test/page'], { fetch: links.fetch, ...isolated() });
    assert.deepEqual(links.sent, ['https://a.test/robots.txt']);
    assert.equal(linkResults.get('https://a.test/page')?.outcome, 'unverifiable', 'robots.txt could not be read');

    const images = redirectingRobots(to);
    await checkImageFiles(['https://b.test/x.png'], { fetch: images.fetch, ...isolated(), readBytes: 1024 });
    assert.deepEqual(images.sent, ['https://b.test/robots.txt']);

    const files = redirectingRobots(to);
    const read = await fetchAppFiles('https://c.test', { fetch: files.fetch, ...isolated() });
    assert.deepEqual(files.sent, ['https://c.test/robots.txt']);
    assert.equal(read.aasa.outcome, 'unverifiable');
  });

  test(`a crawl whose robots.txt redirects to ${new URL(to).host} stops, names where it led, and sends nothing there`, async () => {
    const site = redirectingRobots(to);
    const { job, result } = await crawl({ url: 'https://acme.example/' }, { fetch: site.fetch });
    assert.equal(job?.status, 'blocked');
    assert.deepEqual(result?.blocked, { reason: 'robots_unreachable', url: 'https://acme.example/robots.txt', status: 0, redirected_to: to });
    assert.ok(!site.sent.some((url) => OFF_LIMITS.test(url)), JSON.stringify(site.sent));
  });
}

test('safeFetch refuses an off-limits URL before any lookup, and an off-limits redirect it would follow itself', async () => {
  const direct = await safeFetch('https://play.google.com/store/apps/details?id=com.example');
  assert.deepEqual([direct.status, direct.error?.code, direct.error?.message], [0, 'blocked_address', 'Not requested: Seekwide never contacts Google Play']);
  const server = await startServer({ '/away': { status: 302, redirect: 'https://www.facebook.com/acme' } });
  try {
    const hop = await safeFetch(`${server.origin}/away`, { allowLoopback: true, maxRedirects: 5 });
    assert.equal(hop.error?.code, 'blocked_address');
    assert.match(hop.error?.message ?? '', /never contacts social platforms/);
    assert.deepEqual(hop.redirectChain.map((step) => step.location), ['https://www.facebook.com/acme']);
  } finally {
    await server.close();
  }
});

test('the guard answers for the fetch it wraps, is the same function for the same fetch, and passes other URLs through', async () => {
  /** @type {string[]} */
  const sent = [];
  /** @param {string} url */
  const inner = async (url) => {
    sent.push(url);
    return fetchResult(url);
  };
  const guarded = guardFetch(inner);
  assert.equal(guardFetch(inner), guarded, 'one wrapper per fetch, so the robots.txt cache keyed by it is still shared');
  assert.equal(guardFetch(guarded), guarded);
  assert.equal((await guarded('https://x.com/acme')).error?.code, 'blocked_address');
  assert.equal((await guarded('https://example.test/')).status, 200);
  assert.deepEqual(sent, ['https://example.test/']);
  assert.equal(offLimitsRefusal('https://example.test/'), null);
});
