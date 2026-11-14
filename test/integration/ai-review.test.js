// Regression tests for the defects an independent review of the ai module
// found (D1-D6, N1-N5), each run through the real crawler, store and tools
// against a local server, as the review reproduced them.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { allChecks } from '../../plugin/server/src/checks/registry.js';
import { createCrawlManager } from '../../plugin/server/src/crawl/manager.js';
import { readContentSignal } from '../../plugin/server/src/net/ai-prefs.js';
import { fetchLlmsTxt } from '../../plugin/server/src/net/llms-txt.js';
import { safeFetch } from '../../plugin/server/src/net/safe-fetch.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import * as store from '../../plugin/server/src/store/index.js';
import { compareRuns } from '../../plugin/server/src/store/compare.js';
import { ROBOTS_ONLY } from '../../plugin/server/src/checks/ai/helpers.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { startServer } from '../helpers/http-server.js';
import { makeRun } from '../helpers/run-factory.js';

const NOW = new Date('2026-11-14T10:00:00.000Z');
const WORDS = 'A made-up bakery sells bread, cakes and coffee in a quiet street, bakes sourdough loaves by hand every morning, and delivers orders to offices nearby; these pages list the menu, the opening hours, the bakers and the seasonal specials of the shop.';
const text = (/** @type {string} */ body) => ({ headers: { 'content-type': 'text/plain' }, body });
/** @param {string} title @param {string} body @param {string} [head] @param {Record<string, string>} [headers] */
const page = (title, body, head = '', headers = {}) => ({
  headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
  body: `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>${head}</head><body>${body}</body></html>`,
});

/**
 * Crawl a local site and audit it through the tools with the real store.
 * @param {{routes: Record<string, any>, profile?: (origin: string) => Record<string, unknown>, modules?: string[], audits?: number,
 *          aiRobots?: any}} options
 */
async function audit({ routes, profile, modules = ['ai'], audits = 1, aiRobots }) {
  const server = await startServer(routes);
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'seekwide-ai-review-'));
  const projectDir = path.join(tmp, 'project');
  await mkdir(projectDir);
  const notUsed = async () => {
    throw new Error('not used');
  };
  const tools = createTools({
    crawlManager: createCrawlManager({ dataDir: path.join(tmp, 'data'), sleep: async () => {}, now: () => NOW, ...(aiRobots ? { aiRobots } : {}) }),
    checks: allChecks(), ...store, renderMarkdown, renderHtml,
    checkExternalLinks: async () => new Map(), checkImageFiles: async () => new Map(), fetchAppFiles: notUsed,
    fetchLlmsTxt: (origin, options) => fetchLlmsTxt(origin, { ...options, sleep: async () => {}, fetch: safeFetch }),
    measureVitals: notUsed, loadProjectSources: notUsed, attachSources: notUsed, saveSearchImport: notUsed, loadSearchImport: async () => null,
    now: () => NOW, defaultProjectDir: () => projectDir, env: {},
  });
  /** @param {string} name @param {Record<string, unknown>} [args] */
  const call = async (name, args = {}) => /** @type {any} */ (await /** @type {any} */ (tools.find((tool) => tool.name === name)).handler(args));
  if (profile) await call('profile_set', { profile: profile(server.origin) });
  const runs = [];
  for (let i = 0; i < audits; i += 1) {
    const job = await call('crawl_start', { url: `${server.origin}/`, max_pages: 10, allow_localhost: true });
    const done = await call('crawl_status', { job_id: job.job_id, wait_seconds: 30 });
    const result = await call('audit_run', { job_id: job.job_id, modules, project_dir: projectDir, check_core_web_vitals: false });
    // The run as the store reads it back: findings whole, with the fields the stored form writes once per check.
    runs.push({ done, result, saved: await store.loadRun(projectDir, result.run_id) });
  }
  return { server, call, runs, projectDir, close: async () => { await server.close(); await rm(tmp, { recursive: true, force: true }); } };
}

/** @param {any} saved @param {string} id */
const stat = (saved, id) => saved.checks.find((/** @type {any} */ check) => check.id === id);

test('D1: a Content-Signal name such as constructor or __proto__ is an unknown name, never a crash', () => {
  for (const value of ['constructor=yes', '__proto__=1', 'toString=x', 'hasOwnProperty=2', 'search=yes, valueOf=no']) {
    const read = readContentSignal(value);
    assert.equal(read.valid, true, value);
    assert.equal(Object.getPrototypeOf(read.values), Object.prototype, value);
  }
  assert.deepEqual(readContentSignal('search=yes, constructor=no').values, { search: 'yes' });
});

test('D1: such a robots.txt line does not stop the crawl, and an error in the AI reading leaves the crawl and the other modules whole', async () => {
  const routes = { '/': page('Home', `<h1>Home</h1><p>${WORDS}</p>`), '/robots.txt': text('User-agent: *\nAllow: /\nContent-Signal: constructor=yes, __proto__=1\n') };
  const plain = await audit({ routes, modules: ['seo', 'ai'] });
  try {
    assert.equal(plain.runs[0].done.status, 'done');
    assert.ok(plain.runs[0].saved.modules.seo.score !== null);
    assert.equal(stat(plain.runs[0].saved, 'ai.robots.training_preference_invalid').passed, 1, 'the line is read as valid, its names unknown');
  } finally {
    await plain.close();
  }
  const failing = await audit({ routes, modules: ['seo', 'ai'], aiRobots: () => { throw new TypeError('boom'); } });
  try {
    const { done, saved } = failing.runs[0];
    assert.equal(done.status, 'done', 'the crawl finishes');
    assert.ok(saved.modules.seo.score !== null, 'the seo module is scored');
    const blocked = stat(saved, 'ai.access.search_bot_blocked');
    assert.equal(blocked.status, 'skipped');
    assert.match(blocked.skip_reason, /internal error/);
    assert.equal(saved.ai.training_preference, 'unknown');
    assert.ok(failing.runs[0].result.notes.some((/** @type {string} */ note) => note.startsWith('What robots.txt tells AI crawlers could not be worked out because of an internal error')));
    assert.match(failing.runs[0].result.modules.ai.note, /could not be worked out because of an internal error, so it was not judged\.$/);
  } finally {
    await failing.close();
  }
});

test('D2: every profile field is written and read back, and audits use the saved ai_policy and apps through the real store', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'seekwide-profile-'));
  try {
    const input = {
      site_url: 'https://example.com', brand: { name: 'Acme', alternate_names: ['ACME'] }, business_model: 'ecommerce',
      markets: [{ country: 'TR', languages: ['tr'] }], competitors: ['rival.example'], target_queries: ['bread'],
      report: { brand_name: 'Agency' }, apps: { ios: { app_ids: ['ABCDE12345.com.acme.app'], universal_links: true } }, ai_policy: 'allow_search',
    };
    const written = await store.writeProfile(dir, input, NOW);
    const read = await store.readProfile(dir);
    assert.deepEqual(read, written);
    for (const key of Object.keys(input)) assert.ok(read && Object.hasOwn(read, key), key);
    assert.equal(read?.ai_policy, 'allow_search');
    assert.deepEqual(read?.apps, input.apps);
    await writeFile(path.join(dir, '.seekwide', 'profile.json'), JSON.stringify({ ...written, ai_policy: 'block_all' }));
    assert.equal((await store.readProfile(dir))?.ai_policy, 'block_all', 'a hand-written policy is read');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const routes = { '/': page('Home', `<h1>Home</h1><p>${WORDS}</p>`), '/robots.txt': text('User-agent: *\nAllow: /\n\nUser-agent: GPTBot\nDisallow: /\n') };
  const run = await audit({
    routes, modules: ['ai', 'aso'],
    profile: (origin) => ({ site_url: origin, brand: { name: 'Acme' }, ai_policy: 'allow_all', apps: { ios: { app_ids: ['ABCDE12345.com.acme.app'], universal_links: true } } }),
  });
  try {
    const { saved, result } = run.runs[0];
    assert.equal(saved.ai.policy, 'allow_all');
    assert.deepEqual(saved.findings.filter((/** @type {any} */ f) => f.check_id === 'ai.policy.not_applied').map((/** @type {any} */ f) => f.selector), ['GPTBot']);
    assert.ok(!result.notes.some((/** @type {string} */ note) => /site_url is not this site/.test(note)), 'the profile speaks for this site');
    const shown = await run.call('profile_get', { project_dir: run.projectDir });
    assert.equal(shown.profile.ai_policy, 'allow_all');
    assert.deepEqual(shown.profile.apps, { ios: { app_ids: ['ABCDE12345.com.acme.app'], universal_links: true } });
  } finally {
    await run.close();
  }
});

test('D3: a stored token the current crawler data no longer has keeps the run readable, and is shown as such', async () => {
  const run = await audit({ routes: { '/': page('Home', `<h1>Home</h1><p>${WORDS}</p>`), '/robots.txt': text('User-agent: *\nAllow: /\n') }, audits: 2 });
  try {
    const file = run.runs[0].result.files.findings;
    const saved = JSON.parse(await readFile(file, 'utf8'));
    saved.ai.agents[0].token = 'OAI-SearchBot-Renamed';
    await writeFile(file, JSON.stringify(saved));
    const runId = run.runs[0].result.run_id;
    const report = await run.call('report_render', { run_id: runId, format: 'markdown', project_dir: run.projectDir });
    const markdown = await readFile(report.files.markdown, 'utf8');
    assert.match(markdown, /`OAI-SearchBot-Renamed` \| — \| Not in the current crawler data/);
    assert.match(markdown, /AI search crawlers that robots\.txt lets read the start page:\*\* 5 of 5 \(1 not in the current crawler data\)/);
    const html = await readFile((await run.call('report_render', { run_id: runId, format: 'html', project_dir: run.projectDir })).files.html, 'utf8');
    assert.match(html, /5 of 5 \(1 not in the current crawler data\)/);
    const comparison = await run.call('runs_compare', { base_run_id: runId, run_id: run.runs[1].result.run_id, project_dir: run.projectDir });
    assert.ok(comparison.notes.some((/** @type {string} */ note) => note === 'The base run names 1 AI crawler token that the current crawler data does not have, so its count of AI search crawlers leaves it out.'));
    await run.call('findings_query', { run_id: runId, project_dir: run.projectDir });
    saved.ai.agents[0].token = 'Evil Bot <script>';
    await writeFile(file, JSON.stringify(saved));
    await assert.rejects(() => run.call('findings_query', { run_id: runId, project_dir: run.projectDir }), /ai\.agents\[0\]/);
  } finally {
    await run.close();
  }
});

test('D4: a robots.txt that refused the crawler skips the robots checks with the reason, and the report does not claim a training preference', async () => {
  const run = await audit({ routes: { '/': page('Home', `<h1>Home</h1><p>${WORDS}</p><a href="/a">a</a>`), '/a': page('A', `<h1>A</h1><p>${WORDS}</p>`), '/robots.txt': { status: 403, body: 'no' } } });
  try {
    const { saved } = run.runs[0];
    for (const id of ['ai.access.search_bot_blocked', 'ai.access.search_bot_partial', 'ai.access.user_fetcher_blocked', 'ai.robots.search_crawler_blocked_for_training',
      'ai.robots.training_preference_invalid', 'ai.robots.shared_preference_overridden', 'ai.policy.not_applied']) {
      assert.equal(stat(saved, id).status, 'skipped', id);
      assert.match(stat(saved, id).skip_reason, /robots\.txt answered HTTP 403/, id);
    }
    assert.equal(saved.ai.training_preference, 'unknown');
    assert.ok(saved.modules.ai.checks_skipped >= 7);
    // What the user reads says the count is of what could be judged: the tool's modules and notes, the scores row and the layer.
    const notJudged = "robots.txt answered HTTP 403 to Seekwide's crawler instead of the file, so what it tells AI crawlers was not judged.";
    assert.ok(run.runs[0].result.modules.ai.note.endsWith(notJudged));
    assert.ok(run.runs[0].result.notes.some((/** @type {string} */ note) => note.startsWith(notJudged)));
    const html = await readFile((await run.call('report_render', { run_id: run.runs[0].result.run_id, format: 'html', project_dir: run.projectDir })).files.html, 'utf8');
    assert.match(html, /AI readiness checks passed\. robots\.txt answered HTTP 403 to Seekwide&#39;s crawler/);
    assert.match(html, /AI search readiness \(this run\)[\s\S]*?robots\.txt answered HTTP 403/);
    assert.ok(saved.modules.ai.coverage < 0.6);
    const report = await run.call('report_render', { run_id: run.runs[0].result.run_id, format: 'markdown', project_dir: run.projectDir });
    const markdown = await readFile(report.files.markdown, 'utf8');
    assert.match(markdown, /Training preference:\*\* Not known: robots\.txt was not read for AI crawlers/);
    assert.match(markdown, /\| AI readiness \| \d+ of \d+ AI readiness checks passed\. robots\.txt answered HTTP 403/);
    assert.match(markdown, /\| AI search readiness \(this run\) \|[^\n]*robots\.txt answered HTTP 403/);
    assert.doesNotMatch(markdown, /states no shared training preference/);
  } finally {
    await run.close();
  }
});

test('D4: a module with nothing it could judge shows no count and says why', async () => {
  const run = await audit({ routes: { '/robots.txt': text('User-agent: *\nDisallow: /\n') } });
  try {
    assert.equal(run.runs[0].saved.modules.ai.count ?? null, null);
    assert.ok(run.runs[0].saved.modules.ai.note);
  } finally {
    await run.close();
  }
});

test('D6: every finding judged from robots.txt shows the CDN caveat whole, in the tool output and in both report formats', async () => {
  const run = await audit({
    routes: {
      '/': page('Home', `<h1>Home</h1><p>${WORDS}</p><a href="/docs/a">a</a>`), '/docs/a': page('Doc', `<h1>Doc</h1><p>${WORDS}</p>`),
      '/robots.txt': text('User-agent: *\nAllow: /\n\nUser-agent: ChatGPT-User\nUser-agent: PerplexityBot\nUser-agent: Applebot\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /docs/\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-Agent: __usage_ai-training\nDisallow: /\n'),
    },
    profile: (origin) => ({ site_url: origin, brand: { name: 'Acme' }, ai_policy: 'allow_search' }),
  });
  try {
    const robotsChecks = ['ai.access.search_bot_blocked', 'ai.access.search_bot_partial', 'ai.access.user_fetcher_blocked', 'ai.robots.search_crawler_blocked_for_training',
      'ai.policy.not_applied', 'ai.robots.shared_preference_overridden'];
    const runId = run.runs[0].result.run_id;
    let judged = 0;
    for (const id of robotsChecks) {
      const query = await run.call('findings_query', { run_id: runId, project_dir: run.projectDir, check_id: id });
      assert.ok(query.findings.length > 0, `${id} reports in the fixture`);
      for (const finding of query.findings) assert.equal(finding.evidence.limit, ROBOTS_ONLY, `${id} ${finding.selector ?? finding.url}`);
      judged += query.findings.length;
    }
    // PerplexityBot and ClaudeBot carry the longest vendor texts that these checks report; the caveat is whole beside them.
    const perplexity = (await run.call('findings_query', { run_id: runId, project_dir: run.projectDir, check_id: 'ai.access.search_bot_blocked' })).findings.find((/** @type {any} */ f) => f.selector === 'PerplexityBot');
    assert.ok(perplexity.evidence.detail.startsWith('Perplexity: Perplexity says'));
    const markdown = await readFile((await run.call('report_render', { run_id: runId, format: 'markdown', project_dir: run.projectDir })).files.markdown, 'utf8');
    const html = await readFile((await run.call('report_render', { run_id: runId, format: 'html', project_dir: run.projectDir })).files.html, 'utf8');
    const tail = 'Seekwide never pretends to be it, so that is not tested.';
    assert.equal(markdown.split(tail).length - 1, judged);
    assert.match(markdown, /Limit: Read from robots\.txt with the crawler's own token \(RFC 9309\)\./);
    assert.equal(html.split(tail).length - 1, judged);
  } finally {
    await run.close();
  }
});

test('N1: a noindex after ai-training: in its X-Robots-Tag line is reported as likely; a noindex on a line of its own stays confirmed', async () => {
  for (const [lines, confidence] of /** @type {const} */ ([[['ai-training:disallow, noindex'], 'likely'], [['noindex', 'ai-training:disallow, nofollow'], 'confirmed']])) {
    const run = await audit({ modules: ['seo'], routes: { '/': page('Home', `<h1>Home</h1><p>${WORDS}</p>`, '', /** @type {any} */ ({ 'x-robots-tag': lines })), '/robots.txt': text('User-agent: *\nAllow: /\n') } });
    try {
      const query = await run.call('findings_query', { run_id: run.runs[0].result.run_id, project_dir: run.projectDir, check_id: 'seo.indexing.homepage_noindex' });
      assert.equal(query.findings.length, 1, JSON.stringify(lines));
      assert.equal(query.findings[0].confidence, confidence, JSON.stringify(lines));
      if (confidence === 'likely') assert.match(query.findings[0].evidence.detail, /Google documents nothing about them/);
      else assert.doesNotMatch(query.findings[0].evidence.detail, /ai-training/);
    } finally {
      await run.close();
    }
  }
});

test('N2, N3: the crawler table says only what each vendor page states', async () => {
  const run = await audit({ routes: { '/': page('Home', `<h1>Home</h1><p>${WORDS}</p>`), '/robots.txt': text('User-agent: *\nAllow: /\n') } });
  try {
    const report = await run.call('report_render', { run_id: run.runs[0].result.run_id, format: 'markdown', project_dir: run.projectDir });
    const markdown = await readFile(report.files.markdown, 'utf8');
    assert.match(markdown, /`PerplexityBot` \(counted\) \| Perplexity \| AI search \| \*\*Allowed\*\* \| Vendor documents a robots\.txt setting \|/);
    assert.match(markdown, /`ClaudeBot` \| Anthropic \| Training \| \*\*Allowed\*\* \| Vendor says it follows robots\.txt \|/);
    const reference = await readFile(new URL('../../plugin/references/ai-bots.md', import.meta.url), 'utf8');
    assert.match(reference, /`Amzn-SearchBot` .*follows the rules given to other search bots, which Seekwide does not model\./);
  } finally {
    await run.close();
  }
});

test('N4: data-nosnippet counts on span, div and section only, and an empty widget inside a short server-rendered page is not a script shell', async () => {
  const run = await audit({
    routes: {
      '/': page('Home', `<h1>Home</h1><p>${WORDS}</p><a href="/marked">m</a> <a href="/short">s</a> <a href="/shell">x</a>`),
      '/marked': page('Marked', `<h1 data-nosnippet>Marked</h1><p data-nosnippet>${WORDS}</p><p>Short.</p>`),
      '/short': page('Short', '<main><h1>Contact</h1><p>Call us on weekdays.</p><div id="app"></div></main><script src="/analytics.js"></script>'),
      '/shell': page('Shell', '<div id="root"></div><script src="/app.js"></script>'),
      '/robots.txt': text('User-agent: *\nAllow: /\n'),
    },
  });
  try {
    const { saved } = run.runs[0];
    const urls = (/** @type {string} */ id) => saved.findings.filter((/** @type {any} */ f) => f.check_id === id).map((/** @type {any} */ f) => new URL(f.url).pathname);
    assert.deepEqual(urls('ai.snippet.data_nosnippet_main'), [], 'Google ignores data-nosnippet on h1 and p');
    assert.deepEqual(urls('ai.content.script_only'), ['/shell']);
  } finally {
    await run.close();
  }
});

test('N5: counts of different numbers of checks are shown side by side, with no delta', () => {
  const base = makeRun({ run_id: 'a' });
  const current = makeRun({ run_id: 'b' });
  base.modules = { ...base.modules, ai: { score: null, count: { passed: 3, of: 4 }, coverage: 1, checks_total: 15, checks_run: 15, checks_skipped: 0, note: null } };
  current.modules = { ...current.modules, ai: { score: null, count: { passed: 4, of: 6 }, coverage: 1, checks_total: 15, checks_run: 15, checks_skipped: 0, note: null } };
  assert.deepEqual(compareRuns(base, current).scores.ai, { from: null, to: null, from_count: { passed: 3, of: 4 }, to_count: { passed: 4, of: 6 }, delta: null });
  current.modules.ai = { ...current.modules.ai, count: { passed: 4, of: 4 } };
  assert.equal(compareRuns(base, current).scores.ai.delta, 1);
  const markdown = renderMarkdown(current, { comparison: compareRuns(base, { ...current, modules: { ...current.modules, ai: { ...current.modules.ai, count: { passed: 4, of: 6 } } } }) });
  assert.match(markdown, /\| AI readiness \| 3 of 4 AI readiness checks passed \| 4 of 6 AI readiness checks passed \| n\/a \|/);
});
