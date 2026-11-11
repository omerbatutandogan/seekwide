import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makeCrawl, makePage, makeRedirect } from '../../helpers/factories.js';
import { audit } from './helpers.js';

const ROBOTS = makeCrawl().robots;
const ROBOTS_URL = `${SITE}/robots.txt`;

test('seo.robots.unreachable fails when robots.txt is unreachable', () => {
  const { findings, stat } = audit('seo.robots.unreachable', { robots: { ...ROBOTS, status: 'unreachable', http_status: 503 } });
  assert.equal(stat.failed, 1);
  assert.equal(findings[0].url, ROBOTS_URL);
  assert.equal(findings[0].selector, null);
  assert.deepEqual(findings[0].evidence.observed, { http_status: 503 });
});

test('seo.robots.unreachable passes for ok and missing robots.txt', () => {
  for (const status of /** @type {const} */ (['ok', 'missing'])) {
    const { stat } = audit('seo.robots.unreachable', { robots: { ...ROBOTS, status, http_status: status === 'ok' ? 200 : 404 } });
    assert.deepEqual([stat.applicable, stat.passed], [1, 1]);
  }
});

test('seo.robots.disallow_all fails for all crawlers or Googlebot', () => {
  const all = audit('seo.robots.disallow_all', { robots: { ...ROBOTS, disallows_all: true } });
  assert.equal(all.stat.failed, 1);
  assert.equal(all.findings[0].url, ROBOTS_URL);
  assert.match(all.findings[0].evidence.detail ?? '', /all crawlers/);

  const google = audit('seo.robots.disallow_all', { robots: { ...ROBOTS, disallows_all_googlebot: true } });
  assert.equal(google.stat.failed, 1);
  assert.match(google.findings[0].evidence.detail ?? '', /Googlebot/);
});

test('seo.robots.disallow_all passes an open robots.txt and has no unit unless robots.txt is ok', () => {
  assert.deepEqual(audit('seo.robots.disallow_all').stat.passed, 1);
  const missing = audit('seo.robots.disallow_all', { robots: { ...ROBOTS, status: 'missing', disallows_all: true } });
  assert.equal(missing.stat.applicable, 0);
});

test('seo.sitemap.missing fails with no sitemap files and passes with one', () => {
  const none = audit('seo.sitemap.missing');
  assert.equal(none.stat.failed, 1);
  assert.equal(none.findings[0].url, null);

  const files = [{ url: `${SITE}/sitemap.xml`, status: 200, type: /** @type {const} */ ('urlset'), count: 1, error: null }];
  const present = audit('seo.sitemap.missing', { sitemap: { loaded: true, files, urls: [`${SITE}/`], truncated: false } });
  assert.deepEqual([present.stat.applicable, present.stat.passed], [1, 1]);
});

test('seo.sitemap.missing has no unit when sitemaps were never looked for', () => {
  const blocked = { reason: /** @type {const} */ ('bot_challenge'), url: `${SITE}/`, status: 503 };
  const { stat, findings } = audit('seo.sitemap.missing', {
    blocked,
    pages: [],
    sitemap: { loaded: false, files: [], urls: [], truncated: false },
  });
  assert.equal(stat.status, 'run');
  assert.equal(stat.applicable, 0);
  assert.equal(findings.length, 0);
});

test('seo.sitemap.missing still fails a blocked crawl that looked for sitemaps and found none', () => {
  const blocked = { reason: /** @type {const} */ ('bot_challenge'), url: `${SITE}/deep`, status: 403 };
  const { stat, findings } = audit('seo.sitemap.missing', { blocked, pages: [makePage()] });
  assert.deepEqual([stat.applicable, stat.failed], [1, 1]);
  assert.equal(findings[0].url, null);
});

test('seo.sitemap.file_error has one unit per file on the site and fails unreachable and invalid files', () => {
  const files = [
    { url: `${SITE}/a.xml`, status: 200, type: /** @type {const} */ ('urlset'), count: 3, error: null },
    { url: `${SITE}/b.xml`, status: 200, type: /** @type {const} */ ('index'), count: 1, error: null },
    { url: `${SITE}/c.xml`, status: 404, type: /** @type {const} */ ('unreachable'), count: 0, error: null },
    { url: `${SITE}/d.xml`, status: 200, type: /** @type {const} */ ('invalid'), count: 0, error: 'Not a sitemap' },
    { url: 'https://cdn.other.test/sitemap.xml', status: 0, type: /** @type {const} */ ('external'), count: 0, error: 'On another host; not read' },
  ];
  const { stat, failed, findings } = audit('seo.sitemap.file_error', { sitemap: { loaded: true, files, urls: [], truncated: false } });
  assert.equal(stat.applicable, 4);
  assert.deepEqual(failed.sort(), [`${SITE}/c.xml`, `${SITE}/d.xml`]);
  assert.match(findings.find((f) => f.url === `${SITE}/d.xml`)?.evidence.detail ?? '', /Not a sitemap/);
});

test('seo.indexing.homepage_noindex fails when the start page is noindex, following redirects', () => {
  const home = makePage({ url: `${SITE}/en/`, meta_robots: ['noindex'], indexability: { indexable: false, reasons: ['noindex_meta'] } });
  const redirect = makeRedirect(`${SITE}/`, `${SITE}/en/`);
  const { findings, stat } = audit('seo.indexing.homepage_noindex', { pages: [redirect, home] });
  assert.equal(stat.failed, 1);
  assert.equal(findings[0].url, `${SITE}/en/`);
  assert.deepEqual(findings[0].evidence.observed, { meta_robots: ['noindex'], x_robots: [] });
});

test('seo.indexing.homepage_noindex passes an indexable start page', () => {
  const { stat } = audit('seo.indexing.homepage_noindex', { pages: [makePage()] });
  assert.deepEqual([stat.applicable, stat.passed], [1, 1]);
});

test('seo.indexing.homepage_noindex has no unit when the start page is missing or not an HTML 200', () => {
  assert.equal(audit('seo.indexing.homepage_noindex').stat.applicable, 0);
  const error = makePage({ status: 500, indexability: { indexable: false, reasons: ['status_500', 'noindex_meta'] } });
  assert.equal(audit('seo.indexing.homepage_noindex', { pages: [error] }).stat.applicable, 0);
});

test('seo.https.site_not_https fails an http origin and passes an https one', () => {
  const plain = audit('seo.https.site_not_https', { site_origin: 'http://example.test', http_probe: null });
  assert.equal(plain.stat.failed, 1);
  assert.equal(plain.findings[0].url, 'http://example.test');
  assert.equal(audit('seo.https.site_not_https').stat.passed, 1);
});

test('seo.https.not_enforced fails when the http probe does not end on https', () => {
  const probe = { url: 'http://example.test/', status: 200, final_url: 'http://example.test/', enforced: false };
  const { findings, stat } = audit('seo.https.not_enforced', { http_probe: probe });
  assert.equal(stat.failed, 1);
  assert.equal(findings[0].url, 'http://example.test/');
  assert.deepEqual(findings[0].evidence.observed, { status: 200, final_url: 'http://example.test/' });
});

test('seo.https.not_enforced passes an enforced redirect and has no unit without a probe or https', () => {
  assert.equal(audit('seo.https.not_enforced').stat.passed, 1);
  assert.equal(audit('seo.https.not_enforced', { http_probe: null }).stat.applicable, 0);
  const probe = { url: 'http://example.test/', status: 200, final_url: 'http://example.test/', enforced: false };
  assert.equal(audit('seo.https.not_enforced', { site_origin: 'http://example.test', http_probe: probe }).stat.applicable, 0);
});
