// End to end for the ai module: crawl a synthetic local site with the real
// crawler, audit it twice through the tools with the real /llms.txt reader,
// and compare the findings with what the site was built to have. The two
// audits give byte-identical findings, and the network log shows that every
// request went to the local site, named Seekwide, and that nothing was asked
// that the site does not link, list or document (robots.txt, the sitemap,
// /llms.txt): no AI vendor, search engine or social platform was contacted.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { aiRoutes } from '../../fixtures/ai/routes.js';
import { allChecks } from '../../plugin/server/src/checks/registry.js';
import { USER_AGENT } from '../../plugin/server/src/config.js';
import { createCrawlManager } from '../../plugin/server/src/crawl/manager.js';
import { fetchLlmsTxt } from '../../plugin/server/src/net/llms-txt.js';
import { safeFetch } from '../../plugin/server/src/net/safe-fetch.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import * as store from '../../plugin/server/src/store/index.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { startServer } from '../helpers/http-server.js';

/** @import { ToolDef } from '../../plugin/server/src/mcp/stdio.js' */

const NOW = new Date('2026-11-14T10:00:00.000Z');
/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {string} */
let tmp;
/** @type {string} */
let projectDir;
/** @type {ToolDef[]} */
let tools;
/** Every URL any part of the audit asked safeFetch for. */
const sent = /** @type {string[]} */ ([]);

/** safeFetch that logs every URL and refuses any address off this machine. */
const logged = /** @type {typeof safeFetch} */ (async (url, options) => {
  sent.push(url);
  if (url.startsWith(server.origin)) return safeFetch(url, options);
  return {
    url, finalUrl: url, status: 0, headers: {}, headerLines: {}, redirectChain: [], body: null, truncated: false, bytes: 0, elapsedMs: 0,
    error: { code: 'blocked_address', message: 'Not on this machine (test guard).' },
  };
});

/** @param {string} name @param {Record<string, unknown>} [args] */
async function call(name, args = {}) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name}`);
  return /** @type {any} */ (await tool.handler(args));
}

/** Crawl the fixture and audit it with the ai module; returns the saved run. */
async function auditOnce() {
  const job = await call('crawl_start', { url: `${server.origin}/`, max_pages: 20, allow_localhost: true });
  const done = await call('crawl_status', { job_id: job.job_id, wait_seconds: 30 });
  assert.equal(done.status, 'done');
  const audit = await call('audit_run', { job_id: job.job_id, modules: ['ai'], project_dir: projectDir });
  return { audit, saved: JSON.parse(await readFile(audit.files.findings, 'utf8')) };
}

/** @type {Awaited<ReturnType<typeof auditOnce>>} */
let first;
/** @type {Awaited<ReturnType<typeof auditOnce>>} */
let second;

before(async () => {
  server = await startServer(aiRoutes);
  tmp = await mkdtemp(path.join(os.tmpdir(), 'seekwide-ai-it-'));
  projectDir = path.join(tmp, 'project');
  await mkdir(projectDir);
  tools = createTools({
    crawlManager: createCrawlManager({ dataDir: path.join(tmp, 'data'), sleep: async () => {}, fetch: logged, now: () => NOW }),
    checks: allChecks(),
    ...store,
    renderMarkdown,
    renderHtml,
    checkExternalLinks: async () => new Map(),
    checkImageFiles: async () => new Map(),
    fetchAppFiles: async () => {
      throw new Error('not used');
    },
    fetchLlmsTxt: (origin, options) => fetchLlmsTxt(origin, { ...options, sleep: async () => {}, fetch: logged }),
    measureVitals: async () => {
      throw new Error('not used');
    },
    loadProjectSources: async () => {
      throw new Error('not used');
    },
    attachSources: async () => {
      throw new Error('not used');
    },
    saveSearchImport: async () => {
      throw new Error('not used');
    },
    loadSearchImport: async () => null,
    now: () => NOW,
    defaultProjectDir: () => projectDir,
    env: {},
  });
  first = await auditOnce();
  second = await auditOnce();
});

after(async () => {
  await server.close();
  await rm(tmp, { recursive: true, force: true });
});

/** @param {any} saved @param {string} id */
const failed = (saved, id) => saved.findings.filter((/** @type {any} */ finding) => finding.check_id === id);

test('two audits of the same crawl data give byte-identical ai findings', () => {
  assert.equal(JSON.stringify(first.saved.findings), JSON.stringify(second.saved.findings));
  assert.equal(JSON.stringify(first.saved.ai), JSON.stringify(second.saved.ai));
  assert.ok(first.saved.findings.length > 0);
});

test('each ai check finds what the fixture was built to have', () => {
  const { saved } = first;
  const selectors = (/** @type {string} */ id) => failed(saved, id).map((/** @type {any} */ f) => f.selector ?? f.url.replace(server.origin, '')).sort();
  assert.deepEqual(selectors('ai.access.search_bot_blocked'), ['Applebot', 'PerplexityBot']);
  assert.deepEqual(selectors('ai.access.search_bot_partial'), ['/private-docs/guide']);
  assert.deepEqual(selectors('ai.access.user_fetcher_blocked'), ['ChatGPT-User']);
  assert.deepEqual(selectors('ai.robots.search_crawler_blocked_for_training'), ['Applebot']);
  assert.deepEqual(selectors('ai.robots.shared_preference_overridden'), ['ClaudeBot']);
  assert.deepEqual(selectors('ai.robots.training_preference_invalid'), ['content-usage[0]']);
  assert.deepEqual(selectors('ai.snippet.nosnippet'), ['/nosnippet']);
  assert.deepEqual(selectors('ai.snippet.max_snippet_set'), ['/limited']);
  assert.deepEqual(selectors('ai.snippet.data_nosnippet_main'), ['/hidden-main']);
  assert.deepEqual(selectors('ai.content.script_only'), ['/app']);
  assert.deepEqual(selectors('ai.bing.grounding_restricted'), ['/grounding']);
  assert.deepEqual(selectors('ai.bing.legacy_ai_directive'), ['/']);
  assert.deepEqual(selectors('ai.llms_txt.malformed'), ['/llms.txt']);
  assert.deepEqual(failed(saved, 'ai.llms_txt.malformed')[0].evidence.observed.problem, 'h1_not_first');
  // Passing units: the four other search crawlers, the other pages, the valid preference lines.
  const stat = (/** @type {string} */ id) => saved.checks.find((/** @type {any} */ check) => check.id === id);
  assert.deepEqual([stat('ai.access.search_bot_blocked').applicable, stat('ai.access.search_bot_blocked').passed], [6, 4]);
  assert.deepEqual([stat('ai.robots.training_preference_invalid').applicable, stat('ai.robots.training_preference_invalid').passed], [3, 2]);
  assert.equal(stat('ai.snippet.nosnippet').passed, stat('ai.snippet.nosnippet').applicable - 1);
  // A local site: the refusal check needs the deployed site, and no policy was stated.
  assert.equal(stat('ai.access.self_refused').status, 'skipped');
  assert.equal(stat('ai.policy.not_applied').applicable, 0);
});

test('the ai module is a count, never a score, and the run records no text from the site', () => {
  const { saved, audit } = first;
  assert.equal(saved.modules.ai.score, null);
  assert.ok(saved.modules.ai.count !== null && saved.modules.ai.count.of > 0);
  assert.match(saved.modules.ai.note, /AI readiness checks passed\. A count, not a score\./);
  assert.equal(saved.ai.policy, null);
  assert.equal(saved.ai.training_preference, 'disallow');
  assert.deepEqual(saved.ai.llms_txt, { url: `${server.origin}/llms.txt`, outcome: 'found', status: 200 });
  assert.equal(saved.ai.agents.find((/** @type {any} */ a) => a.token === 'PerplexityBot').allowed, false);
  assert.ok(audit.notes.some((/** @type {string} */ note) => note.startsWith('AI search crawlers: robots.txt lets 4 of 6 read the start page')));
});

test('every request went to the local site, named Seekwide, and asked only for what the site links, lists or documents', () => {
  assert.ok(sent.length > 0);
  assert.ok(sent.every((url) => url.startsWith(`${server.origin}/`)), 'nothing left the local site');
  assert.ok(server.requests.every((request) => request.headers['user-agent'] === USER_AGENT));
  const paths = new Set(server.requests.map((request) => request.url));
  assert.deepEqual([...paths].sort(), ['/', '/app', '/grounding', '/hidden-main', '/limited', '/llms.txt', '/nosnippet', '/private-docs/guide', '/robots.txt', '/sitemap.xml']);
  assert.equal(server.requests.filter((request) => request.url === '/llms.txt').length, 2, 'one request per audit');
});

test('both reports show the readiness counts, the crawler table, Google\'s statement and the manual check, and no score', () => {
  const md = renderMarkdown(first.saved, {});
  assert.match(md, /## AI search readiness/);
  assert.match(md, /AI search crawlers that robots\.txt lets read the start page:\*\* 4 of 6/);
  assert.match(md, /There are no additional requirements to appear in AI Overviews or AI Mode/);
  assert.match(md, /Search generative AI/);
  assert.match(md, /`PerplexityBot` \(counted\) \| Perplexity \| AI search \| \*\*Blocked\*\*/);
  assert.match(md, /Crawler data verified 2026-11-14\./);
  assert.match(md, /\| AI readiness \| \d+ of \d+ AI readiness checks passed/);
  assert.doesNotMatch(md, /AI readiness \| \d+ \/ 100/);
  const html = renderHtml(first.saved, {});
  assert.match(html, /<section id="ai-readiness"><h2>AI search readiness<\/h2>/);
  assert.match(html, /How AI access and readiness are checked/);
  assert.match(html, /AI search readiness \(this run\)/);
});
