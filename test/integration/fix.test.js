// /seekwide:fix end to end through the MCP tools, on a copy of the plain HTML
// fixture: audit the local server, plan the fixes, change the files the way
// the model would after the user said yes, audit again and verify.

import assert from 'node:assert/strict';
import { appendFile, cp, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { createToolDeps } from '../../plugin/server/src/deps.js';
import { createCrawlManager } from '../../plugin/server/src/crawl/manager.js';
import { ToolError } from '../../plugin/server/src/mcp/stdio.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { HTML_FIXTURE, startServer, staticRoutes } from '../helpers/repo.js';

/** @import { ToolDef } from '../../plugin/server/src/mcp/stdio.js' */

const SITE = 'https://plain.example.com';

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {Record<string, import('../helpers/http-server.js').RouteHandler>} */
let routes;
/** @type {string} */
let tmp;
/** @type {string} */
let projectDir;
/** @type {ToolDef[]} */
let tools;

/** @param {string} name @param {Record<string, unknown>} [args] */
async function call(name, args = {}) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name}`);
  return /** @type {any} */ (await tool.handler(args));
}

/** @param {Record<string, unknown>} [options] */
async function crawl(options = {}) {
  const started = await call('crawl_start', { url: `${server.origin}/`, allow_localhost: true, ...options });
  let status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  while (status.status === 'running') status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  assert.equal(status.status, 'done');
  return started.job_id;
}

/** Serve what the project folder holds now. */
async function reload() {
  for (const key of Object.keys(routes)) delete routes[key];
  Object.assign(routes, await staticRoutes(projectDir));
}

/** @param {string} file @param {string} from @param {string} to */
async function edit(file, from, to) {
  const target = path.join(projectDir, file);
  const before = await readFile(target, 'utf8');
  assert.ok(before.includes(from), `${file} holds ${from}`);
  await writeFile(target, before.replace(from, to));
}

/** Every file of the project with its content, without the plugin's own folder. */
async function snapshot() {
  /** @type {Record<string, string>} */
  const files = {};
  for (const entry of await readdir(projectDir, { recursive: true, withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isFile() && !file.includes(`${path.sep}.seekwide${path.sep}`)) files[path.relative(projectDir, file)] = await readFile(file, 'utf8');
  }
  return files;
}

before(async () => {
  tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seekwide-fix-it-')));
  projectDir = path.join(tmp, 'site');
  await cp(HTML_FIXTURE, projectDir, { recursive: true });
  routes = await staticRoutes(projectDir);
  server = await startServer(routes);
  let clock = Date.parse('2026-11-12T10:00:00.000Z');
  tools = createTools({
    ...createToolDeps({ SEEKWIDE_DATA_DIR: path.join(tmp, 'data'), CLAUDE_PROJECT_DIR: projectDir }),
    crawlManager: createCrawlManager({ dataDir: path.join(tmp, 'data'), sleep: async () => {} }),
    checkExternalLinks: async () => new Map(),
    measureVitals: async () => {
      throw new Error('a local site must not be measured');
    },
    now: () => new Date((clock += 60_000)),
  });
});

after(async () => {
  await server.close();
  await rm(tmp, { recursive: true, force: true });
});

describe('fix and re-audit on the plain HTML fixture', () => {
  /** @type {any} */
  let base;
  /** @type {any} */
  let plan;
  /** @param {string} checkId @param {string} [file] */
  const idOf = (checkId, file) => {
    const fix = plan.fixes.find((/** @type {any} */ f) => f.check_id === checkId && (file === undefined || f.file === file));
    assert.ok(fix, `${checkId} ${file}`);
    return fix.finding_id;
  };

  it('refuses to plan from a run that was not made in repo mode', async () => {
    const jobId = await crawl();
    await call('audit_run', { job_id: jobId, check_core_web_vitals: false });
    await assert.rejects(call('fix_plan'), (error) => error instanceof ToolError && /was not made in repo mode/.test(error.message));
  });

  it('fix_plan names the file, the line and the present value of each fixable finding, and changes nothing', async () => {
    const jobId = await crawl();
    base = await call('audit_run', { job_id: jobId, check_core_web_vitals: false, source_dir: projectDir });
    const before = await snapshot();
    plan = await call('fix_plan', { site_url: `${SITE}/` });
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual([plan.run_id, plan.site_url, plan.audited, plan.fixable_total, plan.not_fixable_total], [base.run_id, SITE, server.origin, 11, 0]);
    const title = plan.fixes.find((/** @type {any} */ f) => f.check_id === 'seo.title.missing');
    assert.deepEqual([title.file, title.line, title.kind, title.current.titles], ['about.html', 3, 'html', []]);
    const duplicate = plan.fixes.find((/** @type {any} */ f) => f.check_id === 'seo.title.duplicate' && f.file === 'contact.html');
    assert.deepEqual([duplicate.current.titles, duplicate.shares_with], [['Plain Fixture'], [{ url: `${server.origin}/services.html`, file: 'services.html' }]]);
    // Every planned finding is a finding of the saved run.
    const stored = JSON.parse(await readFile(base.files.findings, 'utf8'));
    const known = new Set(stored.findings.map((/** @type {any} */ f) => f.id));
    assert.ok(plan.fixes.every((/** @type {any} */ f) => known.has(f.finding_id)));
  });

  it('after the fixes, a re-audit closes what was fixed, keeps open what was not, and says what it could not verify', async () => {
    await edit('about.html', '<link rel="canonical" href="/about.html">', '<title>About the plain fixture site</title>\n<meta name="description" content="What the plain HTML fixture is for.">\n<link rel="canonical" href="/about.html">');
    await edit('contact.html', '<title>Plain Fixture</title>', '<title>Contact the plain fixture</title>');
    await edit('contact.html', '</head>\n<body>\n<link rel="canonical" href="/contact.html">\n', `<link rel="canonical" href="${SITE}/contact.html">\n</head>\n<body>\n`);
    await edit('index.html', '<link rel="canonical" href="/">', '<link rel="canonical" href="/">\n<meta property="og:title" content="Plain Fixture">');
    await writeFile(path.join(projectDir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${plan.fixes.find((/** @type {any} */ f) => f.type === 'sitemap').sitemap_paths.map((/** @type {string} */ p) => `<url><loc>${SITE}${p}</loc></url>`).join('\n')}\n</urlset>\n`);
    await appendFile(path.join(projectDir, 'robots.txt'), `Sitemap: ${SITE}/sitemap.xml\n`);
    await reload();

    const fixed = [
      idOf('seo.title.missing'), idOf('seo.meta_description.missing'), idOf('seo.title.duplicate', 'contact.html'), idOf('seo.title.duplicate', 'services.html'),
      idOf('seo.canonical.missing'), idOf('seo.sitemap.missing'), idOf('seo.social.og_incomplete', 'index.html'),
    ];
    const jobId = await crawl({ site_url: SITE });
    const after = await call('audit_run', { job_id: jobId, check_core_web_vitals: false, source_dir: projectDir, verify_fixes: { base_run_id: base.run_id, finding_ids: fixed } });

    assert.deepEqual(after.fix_verification.counts, { closed: 6, open: 1, replaced: 0, unverified: 0 });
    assert.deepEqual(after.fix_verification.results.map((/** @type {any} */ r) => [r.check_id, r.file, r.outcome]), [
      ['seo.title.missing', 'about.html', 'closed'],
      ['seo.meta_description.missing', 'about.html', 'closed'],
      ['seo.title.duplicate', 'contact.html', 'closed'],
      ['seo.title.duplicate', 'services.html', 'closed'],
      ['seo.canonical.missing', 'contact.html', 'closed'],
      ['seo.sitemap.missing', null, 'closed'],
      // og:title was added, og:image was not: the finding stays.
      ['seo.social.og_incomplete', 'index.html', 'open'],
    ]);
    assert.equal(after.repo.deployed_origin, SITE);
    assert.ok(after.notes.some((/** @type {string} */ note) => note.includes(`deployed at ${SITE}`)));
    assert.ok(after.modules.seo.score > base.modules.seo.score);

    // The run is saved as a run of its own, with the verification in it and in both reports.
    const stored = JSON.parse(await readFile(after.files.findings, 'utf8'));
    assert.deepEqual(stored.fixes.counts, after.fix_verification.counts);
    assert.notEqual(after.run_id, base.run_id);
    const report = await call('report_render', { compare_to: base.run_id });
    const md = await readFile(report.files.markdown, 'utf8');
    assert.match(md, /## Fixes verified in this run\n\n7 fixed findings were checked again: 6 closed, 1 still open\./);
    assert.match(md, /\| \*\*Closed\*\* \| No XML sitemap found \(`seo\.sitemap\.missing`\) \| Whole site \|/);
    assert.match(md, /## Changes since the previous run/);
    assert.match(await readFile(report.files.html, 'utf8'), /<section id="fixes">/);
  });

  it('the same fixes audited without the deployed address are not called closed where the check did not look', async () => {
    const jobId = await crawl();
    const blind = await call('audit_run', { job_id: jobId, check_core_web_vitals: false, source_dir: projectDir, verify_fixes: { base_run_id: base.run_id, finding_ids: [idOf('seo.canonical.missing'), idOf('seo.sitemap.missing')] } });
    assert.deepEqual(blind.fix_verification.results.map((/** @type {any} */ r) => [r.check_id, r.outcome]), [['seo.canonical.missing', 'unverified'], ['seo.sitemap.missing', 'unverified']]);
    assert.match(blind.fix_verification.results[0].detail, /no longer indexable in the re-audit \(canonical_elsewhere\)/);
    assert.match(blind.fix_verification.results[1].detail, /sitemap on another host/);
  });

  it('verification is refused for a finding the base run does not have', async () => {
    const jobId = await crawl({ site_url: SITE });
    await assert.rejects(
      call('audit_run', { job_id: jobId, check_core_web_vitals: false, verify_fixes: { base_run_id: base.run_id, finding_ids: ['0000000000000000'] } }),
      (error) => error instanceof ToolError && /has no finding "0000000000000000"/.test(error.message),
    );
  });
});
