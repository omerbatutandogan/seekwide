// End to end for the security module: crawl the clean and the injected copy of
// the café fixture with the real crawler and extractor, and compare what the
// module reports with what fixtures/security/README.md says each one holds.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { buildContext, runChecks } from '../../server/src/checks/engine.js';
import { allChecks } from '../../server/src/checks/registry.js';
import { PRODUCT_TOKEN, USER_AGENT } from '../../server/src/config.js';
import { crawlLocal, staticRoutes, startServer } from '../helpers/repo.js';

/** @import { AuditResult, CrawlResult } from '../../server/src/types.js' */

const FIXTURES = path.resolve(import.meta.dirname, '..', '..', 'fixtures', 'security');

/**
 * @typedef {Object} Audited
 * @property {Awaited<ReturnType<typeof startServer>>} server
 * @property {CrawlResult} crawl
 * @property {AuditResult} audit
 * @property {string} dataDir
 */

/** @type {Record<'clean'|'injected', Audited>} */
const sites = /** @type {any} */ ({});

/**
 * @param {'clean'|'injected'} name
 * @returns {Promise<Audited>}
 */
async function auditFixture(name) {
  const server = await startServer(await staticRoutes(path.join(FIXTURES, name)));
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'seekwide-security-'));
  const crawl = await crawlLocal(server.origin, dataDir, 50);
  const audit = runChecks(allChecks(), buildContext(crawl), { modules: ['security'], detectedAt: '2026-11-12T00:00:00.000Z' });
  return { server, crawl, audit, dataDir };
}

/**
 * @param {Audited} site
 * @returns {string[]} `check_id path` of every finding, sorted.
 */
function found(site) {
  return site.audit.findings.map((finding) => `${finding.check_id} ${(finding.url ?? '').replace(site.server.origin, '')}`).sort();
}

before(async () => {
  sites.clean = await auditFixture('clean');
  sites.injected = await auditFixture('injected');
});

after(async () => {
  for (const site of Object.values(sites)) {
    await site.server.close();
    await rm(site.dataDir, { recursive: true, force: true });
  }
});

test('the clean site has no security finding, info included', () => {
  assert.deepEqual(found(sites.clean), []);
  const { security } = sites.clean.audit.modules;
  assert.equal(security.score, 100);
  // Every check that does not need the deployed site looked at something; rare_host needs a crawl of 50 pages or more.
  for (const id of ['security.hidden.external_link', 'security.content.spam_terms', 'security.content.foreign_script', 'security.embeds.hidden_frame']) {
    const stat = sites.clean.audit.checks.find((check) => check.id === id);
    assert.equal(stat?.status, 'run', id);
    assert.ok((stat?.applicable ?? 0) > 0, `${id} had units`);
  }
});

test('the injected site gives exactly the findings it was built with', () => {
  assert.deepEqual(found(sites.injected), [
    'security.content.foreign_script /tokyo-sale.html',
    'security.content.spam_terms /',
    'security.content.spam_terms /promo.html',
    'security.embeds.hidden_frame /about.html',
    'security.hidden.external_link /',
    'security.hidden.external_link /about.html',
  ]);
  assert.ok((sites.injected.audit.modules.security.score ?? 100) < 100);
});

test('the findings carry evidence that points at the injected markup', () => {
  const byKey = new Map(sites.injected.audit.findings.map((finding) => [`${finding.check_id} ${(finding.url ?? '').replace(sites.injected.server.origin, '')}`, finding]));
  const hidden = byKey.get('security.hidden.external_link /');
  assert.equal(hidden?.selector, 'a[href="https://cheap-pills.test/buy-viagra"]');
  assert.match(hidden?.evidence.detail ?? '', /off-screen, set on div\[style="position:absolute;left:-9999px;top:-9999px"\]/);
  assert.match(byKey.get('security.hidden.external_link /about.html')?.evidence.detail ?? '', /one character \("-"\)/);
  assert.deepEqual(/** @type {any} */ (byKey.get('security.content.spam_terms /')?.evidence.observed), { pharma: { matches: 4, terms: ['viagra', 'cialis'] } });
  assert.match(byKey.get('security.embeds.hidden_frame /about.html')?.evidence.detail ?? '', /malware\.test.*zero size/);
  assert.match(byKey.get('security.content.foreign_script /tokyo-sale.html')?.evidence.detail ?? '', /Chinese or Japanese characters.*"en"/);
  for (const finding of sites.injected.audit.findings) {
    assert.ok(finding.doc_ref.startsWith('https://'), finding.check_id);
    assert.ok(finding.recommendation.length > 20, finding.check_id);
  }
});

test('the header checks are skipped for a site on this machine, with the reason', () => {
  for (const site of Object.values(sites)) {
    const headers = site.audit.checks.filter((check) => check.id.startsWith('security.headers.'));
    assert.equal(headers.length, 5);
    for (const stat of headers) {
      assert.equal(stat.status, 'skipped');
      assert.match(stat.skip_reason ?? '', /server on this machine/);
    }
    // The signs of a hack are scored apart from the headers, so the security score keeps full coverage.
    assert.equal(site.audit.modules.security.coverage, 1);
    assert.equal(site.audit.modules.security_headers.coverage, 0);
    assert.equal(site.audit.modules.security_headers.note, 'None of the checks behind this score could run.');
  }
});

test('the module only reads what the crawl fetches anyway, as the crawler, without pretending to be another one', () => {
  for (const site of Object.values(sites)) {
    const listed = new Set(['/robots.txt', '/sitemap.xml', ...site.crawl.pages.map((page) => new URL(page.url).pathname)]);
    for (const request of site.server.requests) {
      assert.equal(request.method, 'GET');
      assert.ok(listed.has(new URL(request.url, site.server.origin).pathname), `unexpected request for ${request.url}`);
      assert.equal(request.headers['user-agent'], USER_AGENT);
      assert.ok(String(request.headers['user-agent']).startsWith(`${PRODUCT_TOKEN}/`));
      assert.doesNotMatch(String(request.headers['user-agent']), /googlebot|mozilla|chrome/i);
      assert.equal(request.headers.referer, undefined);
    }
    // One request per URL: nothing is fetched a second time with other headers.
    const paths = site.server.requests.map((request) => request.url);
    assert.equal(new Set(paths).size, paths.length);
  }
});

test('a second crawl and audit of the injected site give the same findings', async () => {
  const again = await auditFixture('injected');
  try {
    assert.deepEqual(found(again), found(sites.injected));
    assert.deepEqual(again.audit.modules, sites.injected.audit.modules);
  } finally {
    await again.server.close();
    await rm(again.dataDir, { recursive: true, force: true });
  }
});
