// Which page addresses may go to Google: never one with a query string, never
// a host that only works on this machine or a local network, whatever the
// crawl file says about the site.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { measureVitals } from '../../server/src/vitals/measure.js';
import { isPublicHost as mayLeaveMachine } from '../../server/src/util/site-identity.js';
import { selectVitalsPages } from '../../server/src/vitals/select.js';
import { SITE, makeCrawl, makeField, makeLab, makePage } from '../helpers/factories.js';

const PUBLIC = { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: false };

test('a page whose address has a query string is never chosen, one without is', () => {
  const crawl = makeCrawl({
    pages: [makePage({ url: `${SITE}/`, depth: 0 }), makePage({ url: `${SITE}/account?token=SECRET`, depth: 1 }), makePage({ url: `${SITE}/unsubscribe?u=42&sig=abc`, depth: 1 }), makePage({ url: `${SITE}/about`, depth: 1 })],
  });
  const urls = selectVitalsPages(crawl, 10).map((page) => page.url);
  assert.deepEqual(urls.sort(), [`${SITE}/`, `${SITE}/about`]);
});

test('local names, a trailing dot and single-label names never leave the machine; public names do', () => {
  for (const url of ['http://localhost.:3000/', 'http://app.localhost./', 'http://printer.local/', 'http://db.internal/', 'http://nas.lan/', 'http://box.localdomain/', 'http://router.home.arpa/', 'http://intranet/', 'http://10.1.1.1/', 'http://[fd00::1]/', 'not a url']) {
    assert.equal(mayLeaveMachine(url), false, url);
  }
  for (const url of ['https://example.com/', 'https://www.example.com./', 'http://8.8.8.8/']) assert.equal(mayLeaveMachine(url), true, url);
});

test('a crawl file that names local pages under a public origin sends none of them', async () => {
  /** @type {string[]} */
  const sent = [];
  const crawl = makeCrawl({ options: PUBLIC, pages: [makePage({ url: 'http://localhost:3000/', depth: 0 }), makePage({ url: 'http://10.1.1.1/', depth: 1 }), makePage({ url: `${SITE}/about`, depth: 1 })] });
  await measureVitals(crawl, {
    apiKey: 'AIzaTestKey-123_abc',
    runPagespeed: async (url) => { sent.push(url); return { ok: true, lab: makeLab() }; },
    queryCrux: async (target) => { sent.push(String(target.url ?? target.origin)); return { ok: true, record: makeField() }; },
  });
  assert.equal(sent.some((url) => url.includes('localhost') || url.includes('10.1.1.1')), false, sent.join(' '));
  assert.ok(sent.includes(`${SITE}/about`));
});
