import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ToolError } from '../../server/src/mcp/stdio.js';
import { createTools } from '../../server/src/tools/index.js';
import { BLOCKED_SCORE_NOTE, externalLinkUrls, topGroups } from '../../server/src/tools/audit.js';
import { deployedNotes, namedOrigin } from '../../server/src/tools/audit-deployed.js';
import { VITALS_FAILED, VITALS_NOT_ASKED } from '../../server/src/tools/audit-vitals.js';
import { UNTRUSTED_NOTE } from '../../server/src/tools/common.js';
import { LIMITS, RULES_VERSION, VERSION } from '../../server/src/config.js';
import { makeCrawl, makeField, makeLab, makeLink, makePage, makeRedirect, makeVitals } from '../helpers/factories.js';
import { NOW, PROJECT, jobFor, makeCheck, makeDeps, sampleCrawl, toolNamed } from './fakes.js';

/** @param {ReturnType<typeof makeDeps>} fake */
const audit = (fake) => toolNamed(createTools(fake.deps), 'audit_run');

/** @param {Parameters<typeof sampleCrawl>[0]} [overrides] @param {Parameters<typeof makeDeps>[0]} [seed] */
function setup(overrides = {}, seed = {}) {
  const crawl = sampleCrawl(overrides);
  return { crawl, fake: makeDeps({ jobs: [jobFor(crawl)], results: [crawl], ...seed }) };
}

describe('what audit_run says about the deployed address of a local crawl', () => {
  const local = { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true };
  const page = makePage({ url: 'http://localhost:3000/', canonicals: [{ href: 'https://www.example.com/', url: 'https://www.example.com/', source: 'html', in_head: true, line: 3 }] });
  const other = makePage({ url: 'http://localhost:3000/b', canonicals: [{ href: 'https://www.example.com/b', url: 'https://www.example.com/b', source: 'html', in_head: true, line: 3 }, { href: 'https://zzz.test/b', url: 'https://zzz.test/b', source: 'html', in_head: true, line: 4 }] });
  const crawlWith = (/** @type {object} */ extra, pages = [page, other]) => makeCrawl({ site_origin: 'http://localhost:3000', pages, options: { ...local, ...extra } });

  it('says entries were read as local pages only when one or more was', () => {
    assert.deepEqual(deployedNotes(crawlWith({ deployed_origin: 'https://www.example.com', deployed_localized: 4 })).map((note) => note.slice(0, 160)), [
      'The crawl was told that the project is deployed at https://www.example.com. Canonical links and sitemap entries on that address were read as pages of the local ',
    ]);
  });

  it('warns when the address matched nothing, and names the address the pages do use', () => {
    const [note] = deployedNotes(crawlWith({ deployed_origin: 'http://www.example.com', deployed_localized: 0 }));
    assert.match(note, /deployed at http:\/\/www\.example\.com, but no canonical link or sitemap entry names that address, so nothing was read as a page of the local server\./);
    assert.match(note, /The canonical links of the pages name https:\/\/www\.example\.com: .*crawl again with site_url set to exactly that/);
    assert.doesNotMatch(note, /were read as pages/);
    // A crawl stored before the count existed is treated as having matched nothing.
    assert.match(deployedNotes(crawlWith({ deployed_origin: 'http://www.example.com' }))[0], /but no canonical link/);
  });

  it('says so when the pages name no other address at all, and says nothing for a crawl that was not told one', () => {
    const plain = makePage({ url: 'http://localhost:3000/' , canonicals: [{ href: '/', url: 'http://localhost:3000/', source: 'html', in_head: true, line: 3 }] });
    assert.match(deployedNotes(crawlWith({ deployed_origin: 'https://www.example.com', deployed_localized: 0 }, [plain]))[0], /The pages name no other address in their canonical links either\./);
    assert.deepEqual(deployedNotes(crawlWith({})), []);
    assert.equal(namedOrigin(crawlWith({})), 'https://www.example.com');
    assert.equal(namedOrigin(crawlWith({}, [plain])), null);
  });
});

describe('externalLinkUrls for a local crawl that knows the deployed address', () => {
  const pages = () => [
    makePage({ url: 'http://localhost:3000/', links: [makeLink({ url: 'https://www.example.com/pricing', internal: false }), makeLink({ url: 'https://other.test/a', internal: false }), makeLink({ url: 'http://www.example.com/http', internal: false })] }),
    makePage({ url: 'http://localhost:3000/old', status: 301, final_url: 'https://www.example.com/new', final_external: true }),
  ];
  const options = { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true };

  it('leaves out links and redirects to that site, so it is never contacted', () => {
    const crawl = makeCrawl({ pages: pages(), options: { ...options, deployed_origin: 'https://www.example.com' } });
    assert.deepEqual(externalLinkUrls(crawl), ['https://other.test/a']);
  });

  it('leaves them out by host: a site_url with another scheme, without www, or a link with another port or a trailing dot', () => {
    const variants = [makePage({ url: 'http://localhost:3000/', links: ['https://www.example.com/x', 'https://example.com/apex', 'https://www.example.com:8443/port', 'https://www.example.com./dot', 'https://sub.www.example.com/sub', 'https://other.test/a'].map((url) => makeLink({ url, internal: false })) })];
    for (const deployed_origin of ['https://www.example.com', 'http://www.example.com', 'https://example.com']) {
      assert.deepEqual(externalLinkUrls(makeCrawl({ pages: variants, options: { ...options, deployed_origin } })), ['https://other.test/a', 'https://sub.www.example.com/sub'], deployed_origin);
    }
  });

  it('checks them like any other link when no deployed address was given', () => {
    assert.deepEqual(externalLinkUrls(makeCrawl({ pages: pages(), options })), ['http://www.example.com/http', 'https://other.test/a', 'https://www.example.com/new', 'https://www.example.com/pricing']);
  });
});

describe('audit_run', () => {
  it('runs every module, checks outbound links, saves the run and returns a compact summary', async () => {
    const { fake } = setup();
    const result = await audit(fake).handler({ job_id: 'c-1' });

    assert.deepEqual(fake.calls.checkExternalLinks, [[['https://other.test/a', 'https://other.test/b'], { maxLinks: 50, concurrency: 4 }]]);
    assert.deepEqual(fake.calls.ensureProject, [[PROJECT]]);
    assert.equal(fake.runs.length, 1);
    const run = fake.runs[0];
    assert.equal(run.run_id, '2026-11-11T14-03-22Z');
    assert.equal(run.created_at, NOW.toISOString());
    assert.equal(run.rules_version, RULES_VERSION);
    assert.equal(run.plugin_version, VERSION);
    assert.equal(run.schema_version, 1);
    assert.deepEqual(run.modules_requested, ['seo', 'links', 'security']);
    assert.deepEqual(run.crawl, {
      id: 'c-1', pages_crawled: 2, html_pages: 2, indexable_pages: 2, unreadable_pages: 0, truncated: false, blocked: null,
      robots_status: 'ok', sitemap_urls: 0, max_pages: 25, user_agent: 'seekwide/test',
    });
    assert.equal(run.findings.length, 1);
    assert.equal(run.findings[0].detected_at, NOW.toISOString());

    assert.equal(result.run_id, run.run_id);
    assert.equal(result.project_dir, PROJECT);
    assert.deepEqual(result.files, { findings: `${PROJECT}/.seekwide/runs/2026-11-11T14-03-22Z/findings.json` });
    assert.deepEqual(result.totals, {
      findings: 1,
      by_severity: { critical: 0, high: 1, medium: 0, low: 0, info: 0 },
      by_module: { seo: 1 },
      checks_run: 2,
      checks_skipped: 0,
      checks_failed_to_run: 0,
    });
    assert.deepEqual(result.top, [{
      check_id: 'seo.title.missing', title: 'Title of seo.title.missing', severity: 'high', confidence: 'confirmed',
      count: 1, example_urls: ['https://example.test/about'], recommendation: 'Fix seo.title.missing.',
    }]);
    assert.deepEqual(result.skipped_checks, []);
    assert.deepEqual(result.notes, []);
    assert.equal(result._note, UNTRUSTED_NOTE);
    assert.equal(result.findings, undefined, 'findings stay in the run file');
  });

  it('measures Core Web Vitals with the seo module, names the tested pages and stores every value', async () => {
    const vitals = makeVitals({
      pages: [
        { url: 'https://example.test/', why: 'Start page', lab: makeLab({ lcp_ms: 4312 }), lab_note: null, field: makeField(), field_note: null },
        { url: 'https://example.test/about', why: 'Top-level page', lab: null, lab_note: 'PageSpeed Insights did not answer in time.', field: null, field_note: 'The Chrome UX Report has no phone data for this page.' },
      ],
      notes: ['PageSpeed Insights tested 1 of 2 pages. Without a lab result: https://example.test/about (PageSpeed Insights did not answer in time.).'],
    });
    const { fake } = setup({}, { vitals });
    fake.deps.checks = [
      ...fake.deps.checks,
      makeCheck({
        id: 'seo.cwv.lab_lcp', severity: 'low', requires: ['lab_data'],
        run: (ctx) => (ctx.vitals?.pages ?? []).filter((page) => page.lab).map((page) => ({ status: (page.lab?.lcp_ms ?? 0) > 2500 ? 'fail' : 'pass', url: page.url })),
      }),
    ];
    const result = await audit(fake).handler({ job_id: 'c-1' });

    assert.deepEqual(fake.calls.measureVitals, [['c-1', { maxPages: LIMITS.vitalsPagesDefault }]]);
    assert.deepEqual(fake.runs[0].core_web_vitals, vitals, 'the run keeps passing values too, for the report');
    assert.deepEqual(result.core_web_vitals, {
      lab: { available: true, reason: null, device: 'mobile' },
      field: { available: true, reason: null, form_factor: 'phone' },
      origin: vitals.origin,
      pages: vitals.pages,
    });
    assert.deepEqual(result.core_web_vitals.pages.map((/** @type {any} */ page) => [page.url, page.why]), [
      ['https://example.test/', 'Start page'],
      ['https://example.test/about', 'Top-level page'],
    ]);
    assert.deepEqual(result.notes, vitals.notes);
    assert.equal(fake.runs[0].findings.find((f) => f.check_id === 'seo.cwv.lab_lcp')?.url, 'https://example.test/');
  });

  it('passes the page budget through and stays within the schema limits', async () => {
    const { fake } = setup();
    await audit(fake).handler({ job_id: 'c-1', core_web_vitals_pages: 7 });
    assert.deepEqual(fake.calls.measureVitals, [['c-1', { maxPages: 7 }]]);
    const schema = /** @type {any} */ (audit(fake).inputSchema).properties;
    assert.deepEqual([schema.core_web_vitals_pages.minimum, schema.core_web_vitals_pages.maximum, schema.core_web_vitals_pages.default], [1, LIMITS.vitalsPagesMax, LIMITS.vitalsPagesDefault]);
    assert.equal(schema.check_core_web_vitals.default, true);
    assert.match(schema.check_core_web_vitals.description, /sends the URLs of a few pages to Google/);
  });

  it('does not measure when check_core_web_vitals is false, and says so', async () => {
    const { fake } = setup();
    fake.deps.checks = [...fake.deps.checks, makeCheck({ id: 'seo.cwv.field_lcp', requires: ['field_data'], run: () => [] })];
    const result = await audit(fake).handler({ job_id: 'c-1', check_core_web_vitals: false });
    assert.equal(fake.calls.measureVitals, undefined);
    assert.equal(result.core_web_vitals, null);
    assert.equal(fake.runs[0].core_web_vitals, null);
    assert.deepEqual(result.notes, [VITALS_NOT_ASKED]);
    assert.deepEqual(result.skipped_checks, [
      { id: 'seo.cwv.field_lcp', status: 'skipped', reason: 'Needs field data from the Chrome UX Report. It was not collected.' },
    ]);
  });

  it('does not measure, and adds no note, when the seo module does not run', async () => {
    const { fake } = setup();
    const result = await audit(fake).handler({ job_id: 'c-1', modules: ['links'] });
    assert.equal(fake.calls.measureVitals, undefined);
    assert.equal(result.core_web_vitals, null);
    assert.deepEqual(result.notes, []);
  });

  it('a refusal by Google never fails the audit: the checks are skipped with the reason', async () => {
    const reason = "PageSpeed Insights refused the request: Google's quota for requests without an API key is used up. Add a Google API key in the plugin settings.";
    const noKey = 'No Google API key is set, and the Chrome UX Report API requires one. Add a key in the plugin settings to collect field data.';
    const vitals = makeVitals({
      lab: { available: false, reason, device: 'mobile' },
      field: { available: false, reason: noKey, form_factor: 'phone' },
      origin: { origin: 'https://example.test', field: null, field_note: null },
      pages: [{ url: 'https://example.test/', why: 'Start page', lab: null, lab_note: reason, field: null, field_note: null }],
      notes: [reason, noKey],
    });
    const { fake } = setup({}, { vitals });
    fake.deps.checks = [
      ...fake.deps.checks,
      makeCheck({ id: 'seo.cwv.lab_lcp', requires: ['lab_data'], run: () => [] }),
      makeCheck({ id: 'seo.cwv.field_lcp', requires: ['field_data'], run: () => [] }),
    ];
    const result = await audit(fake).handler({ job_id: 'c-1' });
    assert.equal(fake.runs.length, 1, 'the run is saved');
    assert.equal(result.totals.findings, 1, 'the other checks still report');
    assert.deepEqual(result.skipped_checks, [
      { id: 'seo.cwv.field_lcp', status: 'skipped', reason: noKey },
      { id: 'seo.cwv.lab_lcp', status: 'skipped', reason },
    ]);
    assert.deepEqual(result.notes, [reason, noKey]);
    assert.equal(result.modules.seo.coverage, 0.33, 'coverage shows what did not run');
    assert.equal(result.modules.seo.score, 50, 'and the score comes from the checks that did');
  });

  it('an unexpected error while measuring is contained: the audit completes and says nothing was measured', async () => {
    const { fake } = setup({}, { vitals: new Error('socket hang up with a secret AIzaSecretKey') });
    fake.deps.checks = [...fake.deps.checks, makeCheck({ id: 'seo.cwv.lab_lcp', requires: ['lab_data'], run: () => [] })];
    const result = await audit(fake).handler({ job_id: 'c-1' });
    assert.equal(fake.runs.length, 1);
    assert.deepEqual(result.notes, [VITALS_FAILED]);
    assert.deepEqual(result.skipped_checks, [{ id: 'seo.cwv.lab_lcp', status: 'skipped', reason: VITALS_FAILED }]);
    assert.deepEqual(result.core_web_vitals.pages, []);
    assert.ok(!JSON.stringify(result).includes('AIzaSecretKey'), 'the error text stays in the log');
    assert.ok(!JSON.stringify(fake.runs[0]).includes('AIzaSecretKey'));
  });

  it('measures while the external links are checked, not after', async () => {
    /** @type {string[]} */
    const order = [];
    const { fake } = setup();
    fake.deps.checkExternalLinks = async (urls) => {
      order.push('links start');
      await new Promise((resolve) => setImmediate(resolve));
      order.push('links end');
      return new Map(urls.map((url) => [url, { url, status: 200, outcome: /** @type {const} */ ('ok'), reason: null, final_url: url }]));
    };
    fake.deps.measureVitals = async () => {
      order.push('vitals start');
      await new Promise((resolve) => setImmediate(resolve));
      order.push('vitals end');
      return makeVitals();
    };
    await audit(fake).handler({ job_id: 'c-1' });
    assert.deepEqual(order.slice(0, 2).sort(), ['links start', 'vitals start']);
  });

  it('feeds link-check results into the checks', async () => {
    const { fake } = setup({}, { outbound: (url) => (url.endsWith('/a') ? 'broken' : 'ok') });
    const result = await audit(fake).handler({ job_id: 'c-1' });
    assert.equal(result.totals.findings, 2);
    assert.equal(fake.runs[0].findings.find((f) => f.check_id === 'links.outbound.broken')?.url, 'https://other.test/a');
  });

  it('skips the link checker when check_outbound_links is false and says so', async () => {
    const { fake } = setup();
    const result = await audit(fake).handler({ job_id: 'c-1', check_outbound_links: false });
    assert.equal(fake.calls.checkExternalLinks, undefined);
    assert.deepEqual(result.skipped_checks, [{ id: 'links.outbound.broken', status: 'skipped', reason: 'Needs external link checks. They were not run.' }]);
    assert.match(result.notes.join(' '), /External links were not checked/);
  });

  it('does not call the link checker when there are no external links', async () => {
    const { fake } = setup({ pages: [makePage()] });
    const result = await audit(fake).handler({ job_id: 'c-1' });
    assert.equal(fake.calls.checkExternalLinks, undefined);
    assert.equal(result.totals.checks_run, 2);
  });

  it('runs only the requested modules, and checks external links only for the links module', async () => {
    const { fake } = setup();
    const result = await audit(fake).handler({ job_id: 'c-1', modules: ['seo', 'seo'] });
    assert.deepEqual(fake.runs[0].modules_requested, ['seo']);
    assert.deepEqual(Object.keys(result.modules), ['seo']);
    assert.equal(fake.runs[0].checks.length, 1);
    assert.equal(fake.calls.checkExternalLinks, undefined);
    assert.deepEqual(result.notes, [], 'no note about external links when the links module did not run');
  });

  it('checks the destinations of redirects that leave the site', async () => {
    const away = makeRedirect('https://example.test/away', 'https://elsewhere.test/landing', { final_external: true, final_status: 0 });
    const { fake } = setup({ pages: [...sampleCrawl().pages, away] });
    await audit(fake).handler({ job_id: 'c-1', modules: ['links'] });
    assert.deepEqual(fake.calls.checkExternalLinks[0][0], ['https://elsewhere.test/landing', 'https://other.test/a', 'https://other.test/b']);
  });

  it('counts unreadable pages and explains them in plain words', async () => {
    const refused = (/** @type {string} */ url, /** @type {string} */ reason, /** @type {number} */ status) =>
      makePage({ url, status, final_status: status, is_html: false, fetch_error: reason, titles: [], indexability: { indexable: false, reasons: ['fetch_error'] } });
    const { fake } = setup({
      pages: [
        ...sampleCrawl().pages,
        refused('https://example.test/c1', 'bot_challenge', 403),
        refused('https://example.test/c2', 'bot_challenge', 403),
        refused('https://example.test/r', 'rate_limited', 429),
        refused('https://example.test/broken', 'connection_error', 0),
      ],
    });
    const result = await audit(fake).handler({ job_id: 'c-1' });
    assert.equal(result.crawl.unreadable_pages, 3);
    assert.equal(fake.runs[0].crawl.unreadable_pages, 3);
    assert.equal(
      result.notes[0],
      "3 pages could not be read: 2 because the site's firewall challenged the crawler, 1 because the site kept rate-limiting the crawler. " +
        'The checks leave them out, because a refusal says nothing about what visitors or search engines get.',
    );
  });

  it('gives no score when the crawl was blocked before any HTML page was read', async () => {
    const blocked = { reason: /** @type {const} */ ('bot_challenge'), url: 'https://example.test/', status: 403 };
    const start = makePage({ url: 'https://example.test/', status: 403, final_status: 403, is_html: false, fetch_error: 'bot_challenge', titles: [], indexability: { indexable: false, reasons: ['fetch_error'] } });
    const { fake } = setup({ pages: [start], blocked });
    fake.jobs.set('c-1', { ...fake.jobs.get('c-1'), status: 'blocked' });
    fake.deps.checks = [...fake.deps.checks, makeCheck({ id: 'seo.site.level', scope: 'site', run: () => [{ status: 'fail', url: null }] })];
    const result = await audit(fake).handler({ job_id: 'c-1' });
    for (const score of Object.values(result.modules)) {
      assert.equal(/** @type {any} */ (score).score, null);
      assert.equal(/** @type {any} */ (score).note, BLOCKED_SCORE_NOTE);
    }
    assert.deepEqual(fake.runs[0].modules, result.modules);
    assert.equal(result.totals.findings, 1, 'site-level findings are still returned');
  });

  it('passes the scoring note through when a module has no score', async () => {
    const { fake } = setup();
    const result = await audit(fake).handler({ job_id: 'c-1', check_outbound_links: false });
    assert.equal(result.modules.links.score, null);
    assert.equal(typeof result.modules.links.note, 'string');
    assert.equal(result.modules.seo.note, null);
  });

  it('accepts a blocked or truncated crawl and explains the limits', async () => {
    const { fake } = setup({ truncated: true, blocked: { reason: 'rate_limited', url: 'https://example.test/x', status: 429 } });
    fake.jobs.set('c-1', { ...fake.jobs.get('c-1'), status: 'blocked' });
    const result = await audit(fake).handler({ job_id: 'c-1' });
    assert.match(result.notes[0], /stopped \(rate_limited\) at https:\/\/example.test\/x/);
    assert.match(result.notes[1], /page budget \(25 pages\)/);
  });

  it('notes when more external links exist than are checked', async () => {
    const links = Array.from({ length: LIMITS.maxOutboundChecks + 5 }, (_, i) => makeLink({ url: `https://other.test/${String(i).padStart(3, '0')}` }));
    const { fake } = setup({ pages: [makePage({ links })] });
    const result = await audit(fake).handler({ job_id: 'c-1' });
    assert.equal(fake.calls.checkExternalLinks[0][0].length, 55);
    assert.match(result.notes.join(' '), /links to 55 external URLs; the first 50/);
  });

  it('rejects running, failed and unknown jobs with what to do next', async () => {
    const crawl = sampleCrawl();
    const running = makeDeps({ jobs: [jobFor(crawl, { status: 'running' })] });
    await assert.rejects(audit(running).handler({ job_id: 'c-1' }), (error) =>
      error instanceof ToolError && error.message === 'The crawl is still running. Call crawl_status with wait_seconds until it finishes, then try again.');
    const failed = makeDeps({ jobs: [jobFor(crawl, { status: 'failed', error: 'connection refused' })] });
    await assert.rejects(audit(failed).handler({ job_id: 'c-1' }), /The crawl failed: connection refused/);
    await assert.rejects(audit(makeDeps()).handler({ job_id: 'c-9' }), /No crawl job "c-9"/);
    assert.equal(running.runs.length + failed.runs.length, 0);
  });

  it('gives the run a new id when one with the same timestamp exists', async () => {
    const { fake } = setup();
    await audit(fake).handler({ job_id: 'c-1' });
    const second = await audit(fake).handler({ job_id: 'c-1' });
    assert.equal(second.run_id, '2026-11-11T14-03-22Z-2');
    assert.deepEqual(fake.calls.newRunId[1][1], ['2026-11-11T14-03-22Z']);
  });

  it('uses project_dir when given and rejects a relative one', async () => {
    const { fake } = setup();
    const result = await audit(fake).handler({ job_id: 'c-1', project_dir: '/other/project' });
    assert.equal(result.project_dir, '/other/project');
    await assert.rejects(audit(fake).handler({ job_id: 'c-1', project_dir: 'relative/dir' }), /project_dir must be an absolute path/);
  });
});

describe('audit helpers', () => {
  it('collects external URLs from 200 HTML pages only, de-duplicated and sorted', () => {
    const crawl = sampleCrawl({
      pages: [
        ...sampleCrawl().pages,
        makePage({ url: 'https://example.test/404', status: 404, links: [makeLink({ url: 'https://ignored.test/' })] }),
      ],
    });
    assert.deepEqual(externalLinkUrls(crawl), ['https://other.test/a', 'https://other.test/b']);
  });

  it('orders top groups by severity, impact and effort and clips them', () => {
    /** @param {string} check_id @param {string} severity @param {number} impact @param {number} effort @param {string|null} url */
    const finding = (check_id, severity, impact, effort, url) => /** @type {any} */ ({
      check_id, severity, impact, effort, url, title: check_id, confidence: 'likely', recommendation: 'r',
    });
    const findings = [
      finding('a.low', 'low', 3, 1, 'u1'),
      finding('b.high.lowimpact', 'high', 1, 1, 'u1'),
      finding('c.high.hard', 'high', 3, 3, 'u1'),
      finding('d.high.easy', 'high', 3, 1, 'u1'),
      finding('d.high.easy', 'high', 3, 1, 'u2'),
      finding('d.high.easy', 'high', 3, 1, 'u3'),
      finding('d.high.easy', 'high', 3, 1, 'u4'),
      finding('d.high.easy', 'high', 3, 1, null),
      finding('e.critical', 'critical', 1, 3, null),
    ];
    const top = topGroups(findings, 4);
    assert.deepEqual(top.map((g) => g.check_id), ['e.critical', 'd.high.easy', 'c.high.hard', 'b.high.lowimpact']);
    assert.equal(top[1].count, 5);
    assert.deepEqual(top[1].example_urls, ['u1', 'u2', 'u3']);
    assert.deepEqual(top[0].example_urls, []);
  });
});
