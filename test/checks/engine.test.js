import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContext, runChecks } from '../../plugin/server/src/checks/engine.js';
import { scoreModules } from '../../plugin/server/src/checks/scoring.js';
import { prepareChecks, validateCheckDef } from '../../plugin/server/src/checks/validate.js';
import { SITE, makeCrawl, makeLink, makePage, makeRedirect, makeVitals } from '../helpers/factories.js';

/** @import { CheckContext, CheckDef, CheckResult } from '../../plugin/server/src/types.js' */

const NOW = '2026-01-02T03:04:05.000Z';

/**
 * @param {Partial<CheckDef> & {id: string, run: (ctx: CheckContext) => CheckResult[]}} overrides
 * @returns {CheckDef}
 */
function def(overrides) {
  return {
    module: 'seo',
    engine: 'code',
    title: 'Example problem',
    description: 'Looks at an example.',
    severity: 'medium',
    weight: 3,
    impact: 2,
    effort: 1,
    confidence: 'confirmed',
    scope: 'page',
    requires: [],
    doc_ref: 'https://developers.google.com/search/docs',
    last_verified: '2026-11-10',
    recommendation: 'Fix the example.',
    ...overrides,
  };
}

const NO_PAGE = 'Needs what robots.txt tells AI crawlers. No page of the site was recorded.';

test('buildContext indexes pages, inlinks and capabilities', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [makeLink({ url: `${SITE}/a` }), makeLink({ url: `${SITE}/a`, text: 'Again' }), makeLink({ url: 'https://other.test/x' })],
  });
  const a = makePage({ url: `${SITE}/a`, depth: 1 });
  const broken = makePage({ url: `${SITE}/gone`, status: 404, is_html: true, indexability: { indexable: false, reasons: ['status_404'] } });
  const ctx = buildContext(makeCrawl({ pages: [home, a, broken], sitemap: { files: [], urls: [`${SITE}/a`], truncated: false } }));

  assert.equal(ctx.pages.length, 3);
  assert.deepEqual(ctx.htmlPages.map((p) => p.url), [`${SITE}/`, `${SITE}/a`]);
  assert.deepEqual(ctx.indexablePages.map((p) => p.url), [`${SITE}/`, `${SITE}/a`]);
  assert.equal(ctx.inlinks.get(`${SITE}/a`)?.length, 2);
  assert.equal(ctx.inlinks.has('https://other.test/x'), false);
  assert.equal(ctx.sitemapUrls.has(`${SITE}/a`), true);
  assert.deepEqual([...ctx.capabilities].sort(), ['ai_pages', 'full_crawl', 'live_site', 'robots', 'sitemap']);
  assert.deepEqual(ctx.site, { origin: SITE, host: 'example.test', https: true, start_url: `${SITE}/` });
  assert.equal(ctx.outbound, null);
  assert.equal(ctx.vitals, null);
  // The factory's crawl has no ai_robots, as a crawl made before rule set 0.2.0.
  assert.deepEqual(ctx.skipReasons, { ai_robots: 'Needs what robots.txt tells AI crawlers. This crawl did not record it (crawls made before rule set 0.2.0 do not). Crawl the site again.' });
});

test('buildContext provides live_site unless the crawl was of a site on this machine', () => {
  assert.equal(buildContext(makeCrawl()).capabilities.has('live_site'), true);
  const local = makeCrawl({ options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true } });
  assert.equal(buildContext(local).capabilities.has('live_site'), false);
  const old = makeCrawl({ options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false } });
  assert.equal(buildContext(old).capabilities.has('live_site'), true, 'a crawl that does not record local is not treated as one');
});

test('buildContext adds lab_data and field_data only for the sources that answered, and keeps the reason of the others', () => {
  const both = buildContext(makeCrawl(), { vitals: makeVitals() });
  assert.ok(both.capabilities.has('lab_data') && both.capabilities.has('field_data'));
  assert.deepEqual(both.skipReasons, { ai_robots: NO_PAGE });
  assert.deepEqual(both.vitals, makeVitals());

  const labOnly = buildContext(makeCrawl(), { vitals: makeVitals({ field: { available: false, reason: 'No key.', form_factor: 'phone' } }) });
  assert.equal(labOnly.capabilities.has('lab_data'), true);
  assert.equal(labOnly.capabilities.has('field_data'), false);
  assert.deepEqual(labOnly.skipReasons, { field_data: 'No key.', ai_robots: NO_PAGE });

  const neither = buildContext(makeCrawl(), {
    vitals: makeVitals({ lab: { available: false, reason: 'Refused.', device: 'mobile' }, field: { available: false, reason: null, form_factor: 'phone' } }),
  });
  assert.equal(neither.capabilities.has('lab_data') || neither.capabilities.has('field_data'), false);
  assert.deepEqual(neither.skipReasons, { lab_data: 'Refused.', ai_robots: NO_PAGE }, 'a source without a reason gets the default one');
});

test('a check that needs missing data is skipped with the collector\'s reason, or the default one', () => {
  const needsLab = def({ id: 'seo.needs.lab', requires: ['lab_data'], run: () => [{ status: 'fail', url: SITE }] });
  const needsBoth = def({ id: 'seo.needs.both', requires: ['lab_data', 'field_data'], run: () => [] });
  const refused = buildContext(makeCrawl(), {
    vitals: makeVitals({ lab: { available: false, reason: 'PageSpeed Insights refused the request.', device: 'mobile' }, field: { available: false, reason: null, form_factor: 'phone' } }),
  });
  const { checks, findings } = runChecks([needsLab, needsBoth], refused, { detectedAt: NOW });
  assert.deepEqual(findings, []);
  assert.deepEqual(checks.map((stat) => [stat.id, stat.status, stat.skip_reason]), [
    ['seo.needs.both', 'skipped', 'PageSpeed Insights refused the request. Needs field data from the Chrome UX Report. It was not collected.'],
    ['seo.needs.lab', 'skipped', 'PageSpeed Insights refused the request.'],
  ]);
  const measured = runChecks([needsLab], buildContext(makeCrawl(), { vitals: makeVitals() }), { detectedAt: NOW });
  assert.equal(measured.checks[0].status, 'run');
  assert.equal(measured.findings.length, 1);
});

test('buildContext drops full_crawl for truncated or blocked crawls and adds outbound when given', () => {
  const truncated = buildContext(makeCrawl({ truncated: true }));
  assert.equal(truncated.capabilities.has('full_crawl'), false);

  const blocked = buildContext(makeCrawl({ blocked: { reason: 'bot_challenge', url: `${SITE}/`, status: 403 } }));
  assert.equal(blocked.capabilities.has('full_crawl'), false);

  const withOutbound = buildContext(makeCrawl(), { outbound: new Map() });
  assert.equal(withOutbound.capabilities.has('outbound'), true);

  const noRobots = buildContext(makeCrawl({ robots: { ...makeCrawl().robots, status: 'missing', http_status: 404 } }));
  assert.equal(noRobots.capabilities.has('robots'), false);
});

test('resolve follows a redirect record to the crawled target', () => {
  const target = makePage({ url: `${SITE}/new` });
  const redirect = makeRedirect(`${SITE}/old`, `${SITE}/new`);
  const dangling = makeRedirect(`${SITE}/lost`, `${SITE}/not-crawled`);
  const ctx = buildContext(makeCrawl({ pages: [target, redirect, dangling] }));

  assert.equal(ctx.resolve(`${SITE}/old`), target);
  assert.equal(ctx.resolve(`${SITE}/new`), target);
  assert.equal(ctx.resolve(`${SITE}/lost`), undefined);
  assert.equal(ctx.resolve(`${SITE}/unknown`), undefined);
});

test('runChecks turns failures into sorted findings with stable ids', () => {
  const pages = [makePage({ url: `${SITE}/b` }), makePage({ url: `${SITE}/a` }), makePage({ url: `${SITE}/c` })];
  const ctx = buildContext(makeCrawl({ pages }));
  const check = def({
    id: 'seo.example.problem',
    run: (c) =>
      c.htmlPages.map((page) => ({
        status: page.url.endsWith('/c') ? 'pass' : 'fail',
        url: page.url,
        selector: 'head > title',
        line: 3,
        evidence: { observed: 'x', expected: 'y' },
        related_urls: Array.from({ length: 30 }, (_, i) => `${SITE}/r${i}`),
      })),
  });

  const first = runChecks([check], ctx, { detectedAt: NOW });
  const second = runChecks([check], ctx, { detectedAt: NOW });

  assert.deepEqual(first, second);
  assert.deepEqual(first.findings.map((f) => f.url), [`${SITE}/a`, `${SITE}/b`]);
  assert.equal(first.checks[0].applicable, 3);
  assert.equal(first.checks[0].passed, 1);
  assert.equal(first.checks[0].failed, 2);

  const finding = first.findings[0];
  assert.match(finding.id, /^[0-9a-f]{16}$/);
  assert.equal(finding.check_id, 'seo.example.problem');
  assert.equal(finding.engine, 'code');
  assert.equal(finding.status, 'fail');
  assert.equal(finding.selector, 'head > title');
  assert.equal(finding.line, 3);
  assert.equal(finding.detected_at, NOW);
  assert.equal(finding.related_urls.length, 20);
  assert.equal(finding.recommendation, 'Fix the example.');
  assert.equal(finding.fix, null);
});

test('finding ids do not depend on other findings and differ when URL and selector repeat', () => {
  const ctx = buildContext(makeCrawl({ pages: [makePage({ url: `${SITE}/a` })] }));
  const one = def({ id: 'seo.example.one', run: () => [{ status: 'fail', url: `${SITE}/a`, selector: 'a' }] });
  const twice = def({
    id: 'seo.example.one',
    run: () => [
      { status: 'fail', url: `${SITE}/a`, selector: 'a' },
      { status: 'fail', url: `${SITE}/a`, selector: 'a' },
    ],
  });

  const single = runChecks([one], ctx, { detectedAt: NOW }).findings;
  const repeated = runChecks([twice], ctx, { detectedAt: NOW }).findings;

  assert.equal(repeated.length, 2);
  assert.notEqual(repeated[0].id, repeated[1].id);
  assert.ok(repeated.some((f) => f.id === single[0].id));
});

test('runChecks orders findings by severity, then check id, then URL', () => {
  const ctx = buildContext(makeCrawl({ pages: [makePage({ url: `${SITE}/a` })] }));
  const fail = () => [{ status: /** @type {const} */ ('fail'), url: `${SITE}/a` }];
  const checks = [
    def({ id: 'seo.z.low', severity: 'low', weight: 1, run: fail }),
    def({ id: 'seo.b.high', severity: 'high', weight: 4, run: fail }),
    def({ id: 'seo.a.high', severity: 'high', weight: 4, run: fail }),
    def({ id: 'seo.a.info', severity: 'info', weight: 0, run: fail }),
    def({ id: 'seo.c.critical', severity: 'critical', weight: 5, run: fail }),
  ];
  const { findings } = runChecks(checks, ctx, { detectedAt: NOW });
  assert.deepEqual(findings.map((f) => f.check_id), ['seo.c.critical', 'seo.a.high', 'seo.b.high', 'seo.z.low', 'seo.a.info']);
});

test('runChecks skips checks whose requirements are not met and explains why', () => {
  const ctx = buildContext(makeCrawl({ truncated: true }));
  const check = def({ id: 'seo.example.needs', requires: ['full_crawl', 'sitemap'], run: () => assert.fail('must not run') });
  const result = runChecks([check], ctx, { detectedAt: NOW });

  assert.equal(result.findings.length, 0);
  assert.equal(result.checks[0].status, 'skipped');
  assert.match(result.checks[0].skip_reason ?? '', /complete crawl/);
  assert.match(result.checks[0].skip_reason ?? '', /XML sitemap/);
  assert.equal(result.modules.seo.score, null);
  assert.match(result.modules.seo.note ?? '', /could run/);
  assert.equal(result.modules.seo.coverage, 0);
  assert.equal(result.modules.seo.checks_skipped, 1);
});

test('a check that throws or returns a malformed result is reported, not fatal', () => {
  const ctx = buildContext(makeCrawl({ pages: [makePage()] }));
  const checks = [
    def({ id: 'seo.bad.throws', run: () => { throw new Error('boom'); } }),
    def({ id: 'seo.bad.shape', run: () => /** @type {any} */ ([{ status: 'maybe', url: null }]) }),
    def({ id: 'seo.bad.nourl', run: () => /** @type {any} */ ([{ status: 'fail' }]) }),
    def({ id: 'seo.good.one', run: () => [{ status: 'pass', url: null }] }),
  ];
  const result = runChecks(checks, ctx, { detectedAt: NOW });
  const byId = Object.fromEntries(result.checks.map((s) => [s.id, s]));

  assert.equal(byId['seo.bad.throws'].status, 'error');
  assert.match(byId['seo.bad.throws'].skip_reason ?? '', /boom/);
  assert.equal(byId['seo.bad.shape'].status, 'error');
  assert.equal(byId['seo.bad.nourl'].status, 'error');
  assert.equal(byId['seo.good.one'].status, 'run');
  assert.equal(result.modules.seo.checks_run, 1);
  assert.equal(result.modules.seo.checks_skipped, 3);
  assert.equal(result.modules.seo.coverage, 0.25);
});

test('runChecks filters by module', () => {
  const ctx = buildContext(makeCrawl({ pages: [makePage()] }));
  const checks = [
    def({ id: 'seo.x.one', run: () => [{ status: 'pass', url: null }] }),
    def({ id: 'links.x.one', module: 'links', run: () => [{ status: 'fail', url: null }] }),
  ];
  const result = runChecks(checks, ctx, { modules: ['links'], detectedAt: NOW });
  assert.deepEqual(result.checks.map((s) => s.id), ['links.x.one']);
  assert.deepEqual(Object.keys(result.modules), ['links']);
});

test('scoreModules weights pass rates and ignores info, empty and skipped checks', () => {
  const checks = [
    def({ id: 'seo.a.one', weight: 4, severity: 'high', run: () => [] }),
    def({ id: 'seo.a.two', weight: 1, severity: 'low', run: () => [] }),
    def({ id: 'seo.a.info', weight: 0, severity: 'info', run: () => [] }),
    def({ id: 'seo.a.empty', weight: 5, severity: 'critical', run: () => [] }),
    def({ id: 'seo.a.skipped', weight: 5, severity: 'critical', run: () => [] }),
  ];
  const stats = [
    { id: 'seo.a.one', module: 'seo', status: /** @type {const} */ ('run'), skip_reason: null, applicable: 10, passed: 5, failed: 5 },
    { id: 'seo.a.two', module: 'seo', status: /** @type {const} */ ('run'), skip_reason: null, applicable: 4, passed: 4, failed: 0 },
    { id: 'seo.a.info', module: 'seo', status: /** @type {const} */ ('run'), skip_reason: null, applicable: 10, passed: 0, failed: 10 },
    { id: 'seo.a.empty', module: 'seo', status: /** @type {const} */ ('run'), skip_reason: null, applicable: 0, passed: 0, failed: 0 },
    { id: 'seo.a.skipped', module: 'seo', status: /** @type {const} */ ('skipped'), skip_reason: 'x', applicable: 0, passed: 0, failed: 0 },
  ];
  // (4 × 0.5 + 1 × 1.0) / (4 + 1) = 0.6
  assert.deepEqual(scoreModules(stats, checks), {
    seo: { score: 60, coverage: 0.8, checks_total: 5, checks_run: 4, checks_skipped: 1, note: null },
  });
});

test('scoreModules gives a clean module 100 and an empty one null', () => {
  const checks = [def({ id: 'seo.a.one', run: () => [] }), def({ id: 'links.a.one', module: 'links', run: () => [] })];
  const stats = [
    { id: 'seo.a.one', module: 'seo', status: /** @type {const} */ ('run'), skip_reason: null, applicable: 3, passed: 3, failed: 0 },
    { id: 'links.a.one', module: 'links', status: /** @type {const} */ ('run'), skip_reason: null, applicable: 0, passed: 0, failed: 0 },
  ];
  const modules = scoreModules(stats, checks);
  assert.equal(modules.seo.score, 100);
  assert.equal(modules.seo.note, null);
  assert.equal(modules.links.score, null);
  assert.equal(modules.links.coverage, 1);
  assert.match(modules.links.note ?? '', /nothing to look at/, 'a missing score always comes with its reason');
});

test('scoreModules never shows 100 next to a failed unit of a scored check', () => {
  const checks = [
    def({ id: 'links.a.big', module: 'links', weight: 2, run: () => [] }),
    def({ id: 'links.a.clean', module: 'links', weight: 4, run: () => [] }),
    def({ id: 'links.a.info', module: 'links', weight: 0, severity: 'info', run: () => [] }),
  ];
  /** @param {number} failed @param {number} infoFailed */
  const stats = (failed, infoFailed) => [
    { id: 'links.a.big', module: 'links', status: /** @type {const} */ ('run'), skip_reason: null, applicable: 1095, passed: 1095 - failed, failed },
    { id: 'links.a.clean', module: 'links', status: /** @type {const} */ ('run'), skip_reason: null, applicable: 25, passed: 25, failed: 0 },
    { id: 'links.a.info', module: 'links', status: /** @type {const} */ ('run'), skip_reason: null, applicable: 10, passed: 10 - infoFailed, failed: infoFailed },
  ];
  // 15 of 1095 fail: the weighted pass rate is 99.5 %, which rounds to 100.
  assert.equal(scoreModules(stats(15, 0), checks).links.score, 99);
  assert.equal(scoreModules(stats(1, 0), checks).links.score, 99);
  assert.equal(scoreModules(stats(0, 0), checks).links.score, 100);
  assert.equal(scoreModules(stats(0, 10), checks).links.score, 100, 'info checks never move a score');
  assert.equal(scoreModules(stats(600, 0), checks).links.score, 82, 'a lower score is not touched by the cap');
});

test('validateCheckDef accepts a valid definition and names the broken field otherwise', () => {
  const good = def({ id: 'seo.title.missing', run: () => [] });
  assert.doesNotThrow(() => validateCheckDef(good));

  /** @type {[Partial<CheckDef>, RegExp][]} */
  const cases = [
    [{ id: 'Title Missing' }, /id must look like/],
    [{ id: 'links.title.missing' }, /id must start with the module name/],
    [{ engine: /** @type {any} */ ('llm') }, /engine must be "code"/],
    [{ title: 'Ends with a period.' }, /title must be/],
    [{ severity: /** @type {any} */ ('urgent') }, /severity must be one of/],
    [{ weight: 6 }, /weight must be an integer/],
    [{ severity: 'info', weight: 2 }, /weight must be 0 for info/],
    [{ severity: 'high', weight: 0 }, /weight must be 0 for info/],
    [{ impact: /** @type {any} */ (4) }, /impact must be/],
    [{ confidence: /** @type {any} */ ('heuristic') }, /confidence must be/],
    [{ requires: ['everything'] }, /requires must be a list/],
    [{ doc_ref: 'http://example.com' }, /doc_ref must be an https URL/],
    [{ last_verified: '10/11/2026' }, /last_verified must be YYYY-MM-DD/],
    [{ run: /** @type {any} */ ('nope') }, /run must be a function/],
  ];
  for (const [change, pattern] of cases) {
    assert.throws(() => validateCheckDef({ ...good, ...change }), pattern);
  }
});

test('prepareChecks sorts by id and rejects duplicates', () => {
  const a = def({ id: 'seo.a.one', run: () => [] });
  const b = def({ id: 'seo.b.one', run: () => [] });
  assert.deepEqual(prepareChecks([b, a]).map((c) => c.id), ['seo.a.one', 'seo.b.one']);
  assert.throws(() => prepareChecks([a, { ...a }]), /defined twice/);
});
