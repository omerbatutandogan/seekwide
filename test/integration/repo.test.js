// Repo mode end to end through the MCP tools: detect the project, crawl its
// local server with the real crawler, audit with source_dir, and read the
// source files back from the stored run, findings_query and both reports.

import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createToolDeps } from '../../server/src/deps.js';
import { createCrawlManager } from '../../server/src/crawl/manager.js';
import { ToolError } from '../../server/src/mcp/stdio.js';
import { createTools } from '../../server/src/tools/index.js';
import { HTML_FIXTURE, startServer, staticRoutes } from '../helpers/repo.js';

/** The static-server command uses `python` on Windows and `python3` elsewhere (see repo/detect.js). */
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

/** @import { ToolDef } from '../../server/src/mcp/stdio.js' */

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {string} */
let tmp;
/** @type {string} */
let projectDir;
/** @type {ToolDef[]} */
let tools;
/** Calls that would have gone to Google or to external sites. There must be none. */
const outside = /** @type {string[]} */ ([]);

/** @param {string} name @param {Record<string, unknown>} [args] */
async function call(name, args = {}) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name}`);
  return /** @type {any} */ (await tool.handler(args));
}

async function crawl() {
  const started = await call('crawl_start', { url: `${server.origin}/`, allow_localhost: true });
  let status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  while (status.status === 'running') status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  assert.equal(status.status, 'done');
  return started.job_id;
}

before(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seekwide-repo-it-')));
  // A copy, so that the audit's .seekwide folder never lands in the repository's fixture.
  projectDir = path.join(tmp, 'site');
  await cp(HTML_FIXTURE, projectDir, { recursive: true });
  server = await startServer(await staticRoutes(projectDir));
  let clock = Date.parse('2026-11-11T10:00:00.000Z');
  tools = createTools({
    ...createToolDeps({ SEEKWIDE_DATA_DIR: path.join(tmp, 'data'), CLAUDE_PROJECT_DIR: projectDir }),
    crawlManager: createCrawlManager({ dataDir: path.join(tmp, 'data'), sleep: async () => {} }),
    checkExternalLinks: async (urls) => {
      outside.push(...urls);
      return new Map();
    },
    measureVitals: async (result) => {
      outside.push(`vitals ${result.start_url}`);
      throw new Error('a local site must not be measured');
    },
    now: () => new Date((clock += 60_000)),
  });
});

after(async () => {
  await server.close();
  await rm(tmp, { recursive: true, force: true });
});

describe('repo mode on the plain HTML fixture', () => {
  /** @type {string} */
  let jobId;
  /** @type {any} */
  let audit;

  it('project_detect recognizes the project and proposes a server that listens on this machine only', async () => {
    const found = await call('project_detect');
    assert.deepEqual([found.framework, found.supported, found.source_dir], ['html', true, projectDir]);
    assert.equal(found.dev_server.command, `${PYTHON} -m http.server 4173 --bind 127.0.0.1`);
    assert.equal(found.dev_server.cwd, projectDir);
    assert.equal(found.routes_total, 5);
  });

  it('audit_run with source_dir names the file and line of each finding and stores them', async () => {
    jobId = await crawl();
    audit = await call('audit_run', { job_id: jobId, check_core_web_vitals: false, source_dir: projectDir });
    assert.deepEqual(audit.repo, {
      framework: 'html', label: 'Plain HTML', source_dir: '.', findings_with_source: audit.totals.findings - 2, pages_matched: 5, pages_total: 5,
    });
    const stored = JSON.parse(await readFile(audit.files.findings, 'utf8'));
    assert.deepEqual(stored.repo, audit.repo);
    const broken = stored.findings.find((/** @type {any} */ f) => f.check_id === 'links.internal.broken');
    assert.deepEqual(broken.source, { file: 'services.html', line: 17, route: '/services.html' });
    assert.deepEqual(audit.top.find((/** @type {any} */ g) => g.check_id === 'links.internal.broken').example_files, ['services.html']);
    assert.deepEqual(outside, []);
  });

  it('findings_query returns the source with each finding', async () => {
    const titles = await call('findings_query', { check_id: 'seo.title.missing' });
    assert.deepEqual(titles.findings.map((/** @type {any} */ f) => f.source), [{ file: 'about.html', line: 3, route: '/about.html' }]);
    const site = await call('findings_query', { check_id: 'seo.sitemap.missing' });
    assert.equal('source' in site.findings[0], false);
  });

  it('report_render shows the source in Markdown and HTML', async () => {
    const report = await call('report_render');
    const md = await readFile(report.files.markdown, 'utf8');
    const html = await readFile(report.files.html, 'utf8');
    assert.match(md, /Source: `about\.html:3` \(route `\/about\.html`\)/);
    assert.match(md, /Source: `services\.html:17` \(route `\/services\.html`\)/);
    assert.match(md, /\*\*Source files:\*\* Plain HTML project\./);
    assert.match(html, /<span class="k">Source<\/span><code>contact\.html:15<\/code> <span class="k">Route<\/span><code>\/contact\.html<\/code>/);
    assert.match(html, /<dt>Source files<\/dt>/);
  });

  it('keeps the folder path of this machine out of the stored run and the reports', async () => {
    const run = await readFile(audit.files.findings, 'utf8');
    const report = await call('report_render', { run_id: audit.run_id });
    // In JSON a Windows path has its backslashes doubled, so the path is looked for as JSON writes it too.
    const forms = [tmp, JSON.stringify(tmp).slice(1, -1)];
    for (const text of [run, await readFile(report.files.markdown, 'utf8'), await readFile(report.files.html, 'utf8')]) {
      for (const form of forms) assert.equal(text.includes(form), false);
    }
  });

  it('an audit of the same crawl without source_dir has the same finding ids, so runs compare cleanly', async () => {
    const plain = await call('audit_run', { job_id: jobId, check_core_web_vitals: false });
    assert.equal(plain.repo, null);
    const comparison = await call('runs_compare');
    assert.deepEqual([comparison.resolved_total, comparison.added_total, comparison.persisting], [0, 0, audit.totals.findings]);
    const listed = await call('findings_query', { limit: 200 });
    assert.equal(listed.findings.some((/** @type {any} */ f) => 'source' in f), false);
  });

  it('refuses a source folder outside the project folder', async () => {
    await assert.rejects(call('audit_run', { job_id: jobId, source_dir: tmp }), (error) => error instanceof ToolError && /or a folder inside it/.test(error.message));
    await assert.rejects(call('project_detect', { source_dir: os.homedir() }), ToolError);
  });
});
