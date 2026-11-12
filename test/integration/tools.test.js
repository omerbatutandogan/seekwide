// End to end through the MCP tools: the real crawler, checks, store and report
// renderers, driven only through createTools against the fixture site on
// 127.0.0.1. Every request goes through a guard that refuses any other host.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { siteRoutes } from '../../fixtures/site/routes.js';
import { allChecks } from '../../server/src/checks/registry.js';
import { createCrawlManager } from '../../server/src/crawl/manager.js';
import { ToolError } from '../../server/src/mcp/stdio.js';
import { checkExternalLinks } from '../../server/src/net/link-check.js';
import { measureVitals } from '../../server/src/vitals/measure.js';
import { safeFetch } from '../../server/src/net/safe-fetch.js';
import { renderHtml } from '../../server/src/report/html.js';
import { renderMarkdown } from '../../server/src/report/markdown.js';
import * as store from '../../server/src/store/index.js';
import { withStoreErrors } from '../../server/src/tools/common.js';
import { createTools } from '../../server/src/tools/index.js';
import { startServer } from '../helpers/http-server.js';
import { PROFILE_NOTE } from '../../server/src/tools/profile.js';

/** @import { ToolDef } from '../../server/src/mcp/stdio.js' */

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {string} */
let tmp;
/** @type {string} */
let projectDir;
/** @type {ToolDef[]} */
let tools;
/** Requests the guard refused because they were not for 127.0.0.1. */
const refused = /** @type {string[]} */ ([]);
/** URL lists handed to the external link checker. */
const linkChecks = /** @type {string[][]} */ ([]);
/** Requests that would have gone to Google. The fixture site is on this machine, so there must be none. */
const googleCalls = /** @type {string[]} */ ([]);
const LOCAL_SITE_NOTE = "The audited site is on this machine or on a private network, so Google's services cannot reach it. Nothing was sent to Google.";

/**
 * safeFetch limited to 127.0.0.1: anything else is refused without a connection.
 * @type {typeof safeFetch}
 */
const guardedFetch = async (url, options) => {
  if (new URL(url).hostname !== '127.0.0.1') {
    refused.push(url);
    return {
      url, finalUrl: url, status: 0, headers: {}, headerLines: {}, redirectChain: [], body: null,
      truncated: false, bytes: 0, elapsedMs: 0, error: { code: 'blocked_address', message: 'Refused by the test guard.' },
    };
  }
  return safeFetch(url, options);
};

/** @param {string} name @param {Record<string, unknown>} [args] */
async function call(name, args = {}) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name}`);
  return /** @type {any} */ (await tool.handler(args));
}

/** @param {string} name @param {Record<string, unknown>} args @param {RegExp} pattern */
async function rejects(name, args, pattern) {
  await assert.rejects(call(name, args), (error) => {
    assert.ok(error instanceof ToolError, `expected a ToolError, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  });
}

/** @param {string} pathname */
const url = (pathname) => `${server.origin}${pathname}`;

/** Start a crawl through the tools and wait until it is finished. */
async function crawlSite(args = {}) {
  const started = await call('crawl_start', { url: url('/'), allow_localhost: true, max_pages: 60, ...args });
  let status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  while (status.status === 'running') status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  return { started, status };
}

before(async () => {
  server = await startServer(siteRoutes);
  tmp = await mkdtemp(path.join(os.tmpdir(), 'seekwide-tools-it-'));
  projectDir = path.join(tmp, 'project');
  await mkdir(projectDir);
  let clock = Date.parse('2026-11-11T10:00:00.000Z');
  tools = createTools({
    crawlManager: createCrawlManager({ dataDir: path.join(tmp, 'data'), fetch: guardedFetch, sleep: async () => {} }),
    checks: allChecks(),
    ...store,
    renderMarkdown,
    renderHtml,
    checkExternalLinks: (urls, options) => {
      linkChecks.push(urls);
      return checkExternalLinks(urls, { ...options, fetch: guardedFetch, fetchOptions: { allowLoopback: true }, sleep: async () => {} });
    },
    measureVitals: (crawl, options) =>
      measureVitals(crawl, {
        ...options,
        apiKey: 'a-key-that-must-never-be-sent',
        runPagespeed: async (pageUrl) => {
          googleCalls.push(`psi ${pageUrl}`);
          return { ok: false, failure: { kind: 'network', status: 0, reason: 'test_guard' } };
        },
        queryCrux: async (target) => {
          googleCalls.push(`crux ${JSON.stringify(target)}`);
          return { ok: false, failure: { kind: 'network', status: 0, reason: 'test_guard' } };
        },
      }),
    now: () => new Date((clock += 60_000)),
    defaultProjectDir: () => projectDir,
    env: { SEEKWIDE_REPORT_BRAND: '${user_config.report_brand_name}', SEEKWIDE_REPORT_LOGO: '' },
  });
});

after(async () => {
  await server.close();
  await rm(tmp, { recursive: true, force: true });
});

describe('the full tool flow on the fixture site', () => {
  /** @type {string} */
  let jobId;
  /** @type {any} */
  let firstAudit;

  it('crawl_start and crawl_status run a crawl to completion', async () => {
    const { started, status } = await crawlSite();
    assert.equal(started.status, 'running');
    assert.equal(started.start_url, url('/'));
    assert.equal(started.max_pages, 60);
    jobId = started.job_id;
    assert.equal(status.status, 'done');
    assert.equal(status.summary.robots_status, 'ok');
    assert.equal(status.summary.sitemap_urls, 10);
    assert.equal(status.summary.truncated, false);
    assert.ok(status.summary.pages >= 10);
    assert.ok(status.summary.by_status['404'] >= 1);
  });

  it('audit_run saves a run into the project folder and returns a small summary', async () => {
    firstAudit = await call('audit_run', { job_id: jobId });
    assert.equal(firstAudit.project_dir, projectDir);
    assert.equal(firstAudit.files.findings, path.join(projectDir, '.seekwide', 'runs', firstAudit.run_id, 'findings.json'));
    const saved = JSON.parse(await readFile(firstAudit.files.findings, 'utf8'));
    assert.equal(saved.run_id, firstAudit.run_id);
    assert.equal(saved.findings.length, firstAudit.totals.findings);
    assert.ok(firstAudit.totals.findings > 0);
    assert.ok(firstAudit.top.length > 0 && firstAudit.top.length <= 10);
    assert.ok(firstAudit.top.every((/** @type {any} */ group) => group.example_urls.length <= 3));
    assert.deepEqual(firstAudit.notes, [LOCAL_SITE_NOTE]);
    assert.ok(!Number.isNaN(Date.parse(firstAudit.core_web_vitals.measured_at)));
    assert.deepEqual(firstAudit.core_web_vitals, {
      measured_at: firstAudit.core_web_vitals.measured_at,
      reused: false,
      lab: { available: false, reason: LOCAL_SITE_NOTE, device: 'mobile' },
      field: { available: false, reason: LOCAL_SITE_NOTE, form_factor: 'phone' },
      origin: { origin: server.origin, field: null, field_note: null },
      pages: [],
    });
    assert.deepEqual(
      firstAudit.skipped_checks.filter((/** @type {any} */ c) => c.id.startsWith('seo.cwv.')).map((/** @type {any} */ c) => c.reason),
      Array(6).fill(LOCAL_SITE_NOTE),
    );
    assert.deepEqual(saved.core_web_vitals.notes, [LOCAL_SITE_NOTE]);
    assert.ok(typeof firstAudit.modules.seo.score === 'number');
    assert.ok(JSON.stringify(firstAudit).length < 20_000, 'the result stays small');
    assert.deepEqual(linkChecks, [], 'the fixture has no external links, so the link checker had nothing to check');
  });

  it('findings_query filters and pages', async () => {
    const all = await call('findings_query', {});
    assert.equal(all.run_id, firstAudit.run_id);
    assert.equal(all.total, firstAudit.totals.findings);

    const high = await call('findings_query', { module: 'seo', severity: 'high' });
    assert.ok(high.findings.every((/** @type {any} */ f) => f.module === 'seo' && f.severity === 'high'));
    assert.equal(high.total, all.findings.filter((/** @type {any} */ f) => f.module === 'seo' && f.severity === 'high').length);

    const first = await call('findings_query', { limit: 2 });
    assert.equal(first.returned, 2);
    assert.equal(first.next_offset, 2);
    const second = await call('findings_query', { limit: 2, offset: 2 });
    assert.notEqual(second.findings[0].id, first.findings[0].id);
    assert.deepEqual(second.findings.map((/** @type {any} */ f) => f.id), all.findings.slice(2, 4).map((/** @type {any} */ f) => f.id));

    const sample = all.findings.find((/** @type {any} */ f) => f.url !== null && new URL(f.url).pathname !== '/');
    const pathname = new URL(sample.url).pathname;
    const byUrl = await call('findings_query', { url_contains: pathname.toUpperCase(), check_id: sample.check_id });
    assert.ok(byUrl.total >= 1, 'the URL filter ignores case');
    assert.ok(byUrl.findings.every((/** @type {any} */ f) => f.check_id === sample.check_id && f.url.toLowerCase().includes(pathname.toLowerCase())));
  });

  it('page_get returns selected fields and counts for a page', async () => {
    const home = await call('page_get', { job_id: jobId, url: url('/') });
    assert.equal(home.status, 200);
    assert.ok(home.counts.links >= 9);
    assert.ok(home.counts.inlinks >= 1);
    assert.equal(home.links, undefined);
    assert.equal(typeof home._note, 'string');
    assert.ok(JSON.stringify(home).length < 8000);
    const gone = await call('page_get', { job_id: jobId, url: url('/missing') });
    assert.equal(gone.status, 404);
    await rejects('page_get', { job_id: jobId, url: url('/never-crawled') }, /has no record/);
  });

  it('report_render writes both formats with summary, recommendations and brand', async () => {
    const result = await call('report_render', {
      formats: ['markdown', 'html'],
      executive_summary: 'The site is in fair shape; fix the broken links first.',
      recommendations: [{ title: 'Publish a guide', detail: 'Write a buying guide for the widget.' }],
      brand_name: 'Acme <Audits>',
    });
    const runDir = path.join(projectDir, '.seekwide', 'runs', firstAudit.run_id);
    assert.deepEqual(result.files, { markdown: path.join(runDir, 'report.md'), html: path.join(runDir, 'report.html') });
    const html = await readFile(result.files.html, 'utf8');
    const markdown = await readFile(result.files.markdown, 'utf8');
    assert.equal((await stat(result.files.html)).size, result.bytes.html);
    assert.equal((await stat(result.files.markdown)).size, result.bytes.markdown);
    assert.ok(html.includes('Acme &lt;Audits&gt;'), 'the brand name is in the HTML, escaped');
    assert.ok(!/<script/i.test(html));
    assert.ok(html.includes('fix the broken links first'));
    assert.ok(html.includes('Publish a guide'));
    assert.ok(html.includes('<section id="core-web-vitals">') && html.includes('Nothing was sent to Google.'));
    assert.ok(markdown.includes('## Core Web Vitals') && markdown.includes('Nothing was sent to Google.'));
    assert.ok(markdown.includes('Acme'));
    assert.ok(markdown.includes('Write a buying guide for the widget.'));
  });

  it('a second audit_run, runs_list and runs_compare', async () => {
    const second = await call('audit_run', { job_id: jobId, check_outbound_links: false });
    assert.notEqual(second.run_id, firstAudit.run_id);
    assert.ok(second.skipped_checks.some((/** @type {any} */ c) => c.id === 'links.outbound.broken'));

    const list = await call('runs_list', {});
    assert.equal(list.total, 2);
    assert.deepEqual(list.runs.map((/** @type {any} */ r) => r.run_id), [second.run_id, firstAudit.run_id]);

    const comparison = await call('runs_compare', { limit: 5 });
    assert.equal(comparison.base_run_id, firstAudit.run_id);
    assert.equal(comparison.run_id, second.run_id);
    assert.ok(comparison.resolved.length <= 5 && comparison.added.length <= 5);
    assert.equal(comparison.persisting + comparison.added_total, second.totals.findings);
    assert.ok(comparison.notes.some((/** @type {string} */ note) => note.includes('links.outbound.broken')));

    const report = await call('report_render', { formats: ['html'], compare_to: firstAudit.run_id });
    assert.ok((await readFile(report.files.html, 'utf8')).length > 0);
  });

  it('profile_set and profile_get, and the profile brand reaches the report', async () => {
    assert.deepEqual(await call('profile_get', {}), { exists: false, profile: null, _note: PROFILE_NOTE });
    const saved = await call('profile_set', {
      profile: { site_url: url('/'), brand: { name: 'Fixture Co' }, business_model: 'ecommerce', report: { brand_name: 'Profile Brand' } },
    });
    assert.equal(saved.profile.brand.name, 'Fixture Co');
    assert.equal(typeof saved.profile.updated_at, 'string');
    const read = await call('profile_get', {});
    assert.equal(read.exists, true);
    assert.deepEqual(read.profile, saved.profile);
    const report = await call('report_render', { formats: ['html'] });
    assert.ok((await readFile(report.files.html, 'utf8')).includes('Profile Brand'));
  });

  it('accepts a blocked crawl: robots.txt disallows the start URL', async () => {
    const { status } = await crawlSite({ url: url('/private/secret') });
    assert.equal(status.status, 'blocked');
    assert.equal(status.blocked.reason, 'robots_disallow');
    const audit = await call('audit_run', { job_id: status.id, check_outbound_links: false });
    assert.match(audit.notes[0], /stopped \(robots_disallow\)/);
  });

  it('no request left 127.0.0.1, and a site on this machine was never named to Google', () => {
    assert.deepEqual(refused, []);
    assert.deepEqual(googleCalls, []);
  });
});

describe('documented error paths against the real store', () => {
  it('a crawl that is still running cannot be audited', async () => {
    const started = await call('crawl_start', { url: url('/'), allow_localhost: true, max_pages: 3 });
    await rejects('audit_run', { job_id: started.job_id }, /still running\. Call crawl_status with wait_seconds/);
    await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  });

  it('a failed crawl cannot be audited: without allow_localhost a site on this machine is refused', async () => {
    const started = await call('crawl_start', { url: url('/') });
    const status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
    assert.equal(status.status, 'failed');
    await rejects('audit_run', { job_id: started.job_id }, /The crawl failed: .*allow localhost explicitly.*start a new crawl with crawl_start/);
  });

  it('unknown and malformed ids', async () => {
    await rejects('crawl_status', { job_id: 'c-unknown' }, /No crawl job "c-unknown" was found/);
    await rejects('findings_query', { run_id: 'nope-run' }, /Run nope-run was not found .*Call runs_list/);
    await rejects('findings_query', { run_id: '../evil' }, /Invalid run id/);
    await rejects('report_render', { run_id: 'last', compare_to: 'last' }, /compare_to names the run being rendered/);
  });

  it('bad project folders', async () => {
    const missing = path.join(tmp, 'does-not-exist');
    await rejects('audit_run', { job_id: 'c-unknown', project_dir: missing }, /does not exist\. .*Pass project_dir with the full path of an existing folder/);
    await rejects('profile_set', { project_dir: missing, profile: { site_url: url('/'), brand: { name: 'X' } } }, /does not exist/);
    await rejects('runs_list', { project_dir: 'relative/path' }, /must be an absolute path/);
  });

  it('an empty project has no last or previous run', async () => {
    const empty = await mkdtemp(path.join(tmp, 'empty-'));
    await rejects('findings_query', { project_dir: empty }, /No audit runs found .*Call runs_list/);
    assert.deepEqual((await call('runs_list', { project_dir: empty })).runs, []);
  });

  it('only one run means no previous run to compare with', async () => {
    const single = await mkdtemp(path.join(tmp, 'single-'));
    const { started } = await crawlSite({ max_pages: 3 });
    await call('audit_run', { job_id: started.job_id, project_dir: single, check_outbound_links: false });
    await rejects('runs_compare', { project_dir: single }, /No saved run is older than .*so there is no previous run/);
  });

  it('a damaged run file and a damaged profile', async () => {
    const damaged = await mkdtemp(path.join(tmp, 'damaged-'));
    const { started } = await crawlSite({ max_pages: 3 });
    const audit = await call('audit_run', { job_id: started.job_id, project_dir: damaged, check_outbound_links: false });
    await writeFile(audit.files.findings, '{not json');
    await rejects('findings_query', { project_dir: damaged }, /is damaged.*Call runs_list to pick another run/);
    await writeFile(path.join(damaged, '.seekwide', 'profile.json'), '{"site_url": 5}');
    await rejects('profile_get', { project_dir: damaged }, /not valid.*Fix these fields and call profile_set again/);
  });

  it('an invalid profile names the bad fields', async () => {
    await rejects('profile_set', { profile: { brand: {} } }, /site_url.*Fix these fields and call profile_set again/);
  });

  it('a run id that is already stored is refused', async () => {
    const run = await store.loadRun(projectDir, 'last');
    await assert.rejects(withStoreErrors(() => store.saveRun(projectDir, run)), (error) =>
      error instanceof ToolError && /already stored.*Call audit_run again/.test(error.message));
  });

  it('a logo that is not an image is refused', async () => {
    const notImage = path.join(tmp, 'logo.txt');
    await writeFile(notImage, 'hello');
    await rejects('report_render', { logo_path: notImage }, /not a PNG, JPEG, WebP or SVG image/);
  });
});
