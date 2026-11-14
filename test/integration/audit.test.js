// End to end: crawl the fixture site with the real crawler and extractor, run
// every shipped check, and compare the findings with what the fixture was built
// to produce. This is where the separately written modules meet.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { siteRoutes } from '../../fixtures/site/routes.js';
import { buildContext, runChecks } from '../../plugin/server/src/checks/engine.js';
import { allChecks } from '../../plugin/server/src/checks/registry.js';
import { PRODUCT_TOKEN } from '../../plugin/server/src/config.js';
import { createCrawlManager } from '../../plugin/server/src/crawl/manager.js';
import { makeVitals } from '../helpers/factories.js';
import { startServer } from '../helpers/http-server.js';

/** @import { AuditResult, CrawlResult } from '../../plugin/server/src/types.js' */

const NOW = '2026-01-02T03:04:05.000Z';

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {string} */
let dataDir;
/** @type {CrawlResult} */
let crawl;
/** @type {AuditResult} */
let audit;

/**
 * Crawl the fixture site without waiting between requests.
 * @param {number} maxPages
 * @returns {Promise<CrawlResult>}
 */
async function crawlFixture(maxPages) {
  const manager = createCrawlManager({ dataDir, sleep: async () => {} });
  const job = await manager.start({ url: `${server.origin}/`, maxPages, allowLoopback: true });
  const finished = await manager.wait(job.id, 30_000);
  assert.ok(finished, 'the job should exist');
  assert.equal(finished.status, 'done', finished.error ?? 'the crawl should finish');
  const result = await manager.result(job.id);
  assert.ok(result, 'a finished crawl has a result');
  return result;
}

/** @param {CrawlResult} result */
function auditCrawl(result) {
  return runChecks(allChecks(), buildContext(result), { detectedAt: NOW });
}

/** @param {string} pathname */
const url = (pathname) => `${server.origin}${pathname}`;

before(async () => {
  server = await startServer(siteRoutes);
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'seekwide-it-'));
  crawl = await crawlFixture(60);
  audit = auditCrawl(crawl);
});

after(async () => {
  await server.close();
  await rm(dataDir, { recursive: true, force: true });
});

test('the crawl covers the whole fixture site and respects robots.txt', () => {
  assert.equal(crawl.truncated, false);
  assert.equal(crawl.blocked, null);
  assert.equal(crawl.robots.status, 'ok');
  assert.equal(crawl.sitemap.urls.length, 10);
  assert.equal(crawl.site_origin, server.origin);
  assert.equal(crawl.http_probe, null, 'the fixture site is plain http, so there is nothing to probe');

  const crawled = crawl.pages.map((page) => page.url);
  for (const pathname of ['/', '/about', '/contact', '/blog/', '/blog/post-4', '/new-page', '/orphan', '/gone', '/missing', '/chain-1']) {
    assert.ok(crawled.includes(url(pathname)), `${pathname} should be crawled`);
  }
  // /chain-2 is only ever a hop inside /chain-1's redirect chain; nothing links to it, so it has no record of its own.
  assert.ok(!crawled.includes(url('/chain-2')));
  assert.equal(new Set(crawled).size, crawled.length, 'every URL is recorded once');

  assert.deepEqual(crawl.robots_blocked, [url('/private/secret')]);
  const requested = server.requests.map((request) => request.url);
  assert.ok(!requested.includes('/private/secret'), 'a disallowed URL is never requested');
  assert.ok(!requested.includes('/files/guide.pdf'), 'a PDF is not crawled as a page');
  assert.ok(!requested.includes('/img/icon.png'), 'images are not crawled');
});

test('every request identifies the crawler', () => {
  assert.ok(server.requests.length > 0);
  for (const request of server.requests) {
    const agent = String(request.headers['user-agent'] ?? '');
    assert.ok(agent.startsWith(`${PRODUCT_TOKEN}/`), `unexpected user agent ${JSON.stringify(agent)} for ${request.url}`);
  }
});

test('redirects are recorded with their chains', () => {
  const byUrl = new Map(crawl.pages.map((page) => [page.url, page]));
  const old = byUrl.get(url('/old-page'));
  assert.equal(old?.status, 301);
  assert.equal(old?.final_url, url('/new-page'));
  assert.equal(old?.final_status, 200);

  const chain = byUrl.get(url('/chain-1'));
  assert.equal(chain?.status, 301);
  assert.equal(chain?.redirect_chain.length, 2);
  assert.equal(chain?.final_url, url('/new-page'));

  assert.equal(byUrl.get(url('/new-page'))?.status, 200);
  assert.equal(byUrl.get(url('/gone'))?.status, 404);
  assert.equal(byUrl.get(url('/server-error'))?.status, 500);
});

test('the audit reports every problem the fixture site was built with', () => {
  /** @type {[string, string|null][]} */
  const expected = [
    ['seo.https.site_not_https', server.origin],
    ['seo.title.missing', url('/blog/post-1')],
    ['seo.title.multiple', url('/blog/post-2')],
    ['seo.title.duplicate', url('/about')],
    ['seo.title.duplicate', url('/contact')],
    ['seo.meta_description.missing', url('/about')],
    ['seo.h1.missing', url('/blog/post-2')],
    ['seo.mobile.viewport_missing', url('/blog/post-2')],
    ['seo.html.lang_missing', url('/blog/post-2')],
    ['seo.canonical.missing', url('/about')],
    ['seo.canonical.missing', url('/products/gadget')],
    ['seo.canonical.outside_head', url('/products/gadget')],
    ['seo.canonical.multiple', url('/multi-canonical')],
    ['seo.canonical.relative', url('/relative-canonical')],
    ['seo.canonical.target_not_ok', url('/broken-canonical')],
    ['seo.indexing.noindex_in_sitemap', url('/noindex-page')],
    ['seo.sitemap.url_not_ok', url('/old-page')],
    ['seo.sitemap.url_not_ok', url('/gone')],
    ['seo.sitemap.url_canonicalized', url('/canonical-away')],
    ['seo.http.server_error', url('/server-error')],
    ['seo.redirect.chain', url('/chain-1')],
    ['seo.content.duplicate_body', url('/blog/post-3')],
    ['seo.content.duplicate_body', url('/blog/post-4')],
    ['seo.structured_data.invalid_json', url('/products/widget')],
    ['links.internal.broken', url('/')],
    ['links.internal.broken', url('/contact')],
    ['links.internal.redirect', url('/')],
    ['links.internal.redirect', url('/about')],
    ['links.internal.nofollow', url('/about')],
    ['links.anchor.uncrawlable', url('/')],
    ['links.anchor.empty', url('/')],
    ['links.orphan.sitemap_only', url('/orphan')],
    ['links.orphan.sitemap_only', url('/gone')],
  ];

  const found = new Set(audit.findings.map((finding) => `${finding.check_id} ${finding.url}`));
  const missing = expected.filter(([checkId, target]) => !found.has(`${checkId} ${target}`));
  assert.deepEqual(missing, [], 'expected findings that the audit did not report');
});

test('each scored finding in the fixture is one the fixture intends', () => {
  // Scored findings (everything except info) may only come from pages that were
  // built with a problem. A finding on a clean page is a false positive. The
  // site was built for these modules; the smo and aso modules have sites of their own.
  const cleanPages = ['/new-page', '/blog/', '/nofollow-target', '/x-robots'].map(url);
  const built = new Set(['seo', 'links', 'security', 'media']);
  const unexpected = audit.findings.filter((finding) => finding.severity !== 'info' && built.has(finding.module) && cleanPages.includes(finding.url ?? ''));
  assert.deepEqual(
    unexpected.map((finding) => `${finding.check_id} ${finding.url}`),
    [],
  );

  // The home page is clean for SEO; its problems are all link problems.
  const homeSeo = audit.findings.filter(
    (finding) => finding.severity !== 'info' && finding.module === 'seo' && finding.url === url('/'),
  );
  assert.deepEqual(homeSeo.map((finding) => finding.check_id), []);

  // Checks that must stay quiet on this site.
  const quiet = [
    'seo.robots.unreachable',
    'seo.robots.disallow_all',
    'seo.sitemap.missing',
    'seo.sitemap.file_error',
    'seo.indexing.homepage_noindex',
    'seo.canonical.cross_host',
    'seo.canonical.invalid',
    'seo.redirect.broken',
    'seo.http.fetch_failed',
    'seo.meta_description.duplicate',
    'seo.meta_description.multiple',
  ];
  const noisy = audit.findings.filter((finding) => quiet.includes(finding.check_id));
  assert.deepEqual(noisy.map((finding) => `${finding.check_id} ${finding.url}`), []);
});

test('findings carry evidence, a recommendation and a documentation link', () => {
  assert.ok(audit.findings.length > 0);
  for (const finding of audit.findings) {
    assert.match(finding.id, /^[0-9a-f]{16}$/);
    assert.equal(finding.engine, 'code');
    assert.ok(finding.recommendation.length > 10, `${finding.check_id} needs a recommendation`);
    assert.ok(finding.doc_ref.startsWith('https://'), `${finding.check_id} needs a documentation link`);
    assert.equal(finding.detected_at, NOW);
  }
  assert.equal(new Set(audit.findings.map((finding) => finding.id)).size, audit.findings.length, 'finding ids are unique');
});

test('scores and coverage are reported for every module', () => {
  const { seo, links, security } = audit.modules;
  for (const module of [seo, links, security]) {
    assert.ok(module.score !== null && module.score >= 0 && module.score <= 100);
  }
  // Neither Core Web Vitals, external links, image files, sharing images, app files nor /llms.txt were collected in this
  // test, so exactly the checks that need them are skipped, and coverage shows it. The
  // site runs on this machine, so the header checks and the ai module's refusal check, which need the deployed
  // site, are skipped as well.
  const skipped = audit.checks.filter((stat) => stat.status !== 'run');
  assert.deepEqual(skipped.map((stat) => stat.id), [
    'ai.access.self_refused', 'ai.llms_txt.malformed',
    'aso.aasa.invalid', 'aso.aasa.missing', 'aso.assetlinks.invalid', 'aso.assetlinks.missing',
    'links.outbound.broken',
    'media.image.broken', 'media.image.large_file', 'media.image.legacy_format', 'media.image.robots_blocked',
    'security.headers.csp_missing', 'security.headers.framing_missing', 'security.headers.hsts_missing',
    'security.headers.nosniff_missing', 'security.headers.referrer_leaky',
    'seo.cwv.field_cls', 'seo.cwv.field_inp', 'seo.cwv.field_lcp', 'seo.cwv.lab_cls', 'seo.cwv.lab_lcp', 'seo.cwv.lab_tbt',
    'smo.og.image_broken', 'smo.og.image_heavy', 'smo.og.image_preview_shape', 'smo.og.image_too_small',
  ]);
  assert.equal(seo.checks_skipped, 6);
  assert.equal(seo.checks_total, 47);
  assert.equal(seo.coverage, 0.87);
  assert.equal(links.checks_skipped, 1);
  // The header checks count toward a score of their own (security_headers), which a local crawl cannot give.
  assert.equal(security.checks_total, 5);
  assert.equal(security.checks_skipped, 0);
  assert.equal(audit.modules.security_headers.checks_skipped, 5);
  assert.equal(audit.modules.security_headers.score, null);
  assert.match(skipped.find((stat) => stat.id === 'security.headers.hsts_missing')?.skip_reason ?? '', /server on this machine/);
  // An ordinary site with SEO and link problems has no sign of a hack.
  assert.deepEqual(audit.findings.filter((finding) => finding.module === 'security').map((finding) => finding.check_id), []);
  assert.ok(audit.checks.every((stat) => stat.status !== 'error'), 'no check may crash');
});

test('with Core Web Vitals collected, every SEO check runs on a complete crawl with a sitemap', () => {
  const withVitals = runChecks(allChecks(), buildContext(crawl, { vitals: makeVitals() }), { detectedAt: NOW });
  assert.equal(withVitals.modules.seo.coverage, 1);
  assert.equal(withVitals.modules.seo.checks_skipped, 0);
  // The measured values are all good, so the findings are the same as without them.
  assert.deepEqual(withVitals.findings, audit.findings);
});

test('the crawl of a site on this machine is marked local', () => {
  assert.equal(crawl.options.local, true);
});

test('a second crawl and audit give exactly the same result', async () => {
  const again = await crawlFixture(60);
  assert.deepEqual(
    again.pages.map((page) => page.url),
    crawl.pages.map((page) => page.url),
    'pages are fetched in the same order',
  );
  const second = auditCrawl(again);
  assert.deepEqual(second.findings, audit.findings);
  assert.deepEqual(second.modules, audit.modules);
});

test('a small page budget truncates the crawl and skips the checks that need a complete one', async () => {
  const small = await crawlFixture(8);
  assert.equal(small.truncated, true);
  assert.ok(small.pages.length <= 8, `expected at most 8 records, got ${small.pages.length}`);

  const result = auditCrawl(small);
  const orphan = result.checks.find((stat) => stat.id === 'links.orphan.sitemap_only');
  assert.equal(orphan?.status, 'skipped');
  assert.match(orphan?.skip_reason ?? '', /complete crawl/);
  assert.ok(result.modules.links.coverage < 1);
});
