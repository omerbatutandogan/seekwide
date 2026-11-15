// End to end for the cro module: crawl a local site with forms using the real
// crawler, audit it with every module through the tools, and show that no form
// is ever submitted and no action URL is ever requested: the server's own log
// holds only GET and HEAD requests for pages, robots.txt, images and llms.txt.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { allChecks } from '../../plugin/server/src/checks/registry.js';
import { createCrawlManager } from '../../plugin/server/src/crawl/manager.js';
import { checkImageFiles } from '../../plugin/server/src/net/image-check.js';
import { checkExternalLinks } from '../../plugin/server/src/net/link-check.js';
import { fetchLlmsTxt } from '../../plugin/server/src/net/llms-txt.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import * as store from '../../plugin/server/src/store/index.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { startServer } from '../helpers/http-server.js';

/** @import { ToolDef } from '../../plugin/server/src/mcp/stdio.js' */

const page = (/** @type {string} */ title, /** @type {string} */ body) => ({
  body: `<!doctype html><html lang="en"><head><title>${title}</title><meta name="viewport" content="width=device-width"></head><body><main>${body}</main></body></html>`,
});

const routes = {
  '/robots.txt': { body: 'User-agent: *\nAllow: /\n', headers: { 'content-type': 'text/plain' } },
  '/': page('Home', '<h1>Welcome</h1><p>We build things.</p><a href="/contact">Contact</a><a href="/signup">Sign up</a><a href="tel:+1-800-FLOWERS">Call</a><button>Start</button>'),
  '/contact': page('Contact', [
    '<h1>Contact</h1><form method="post" action="/submit-here"><input name="email"><textarea name="message" aria-label="Message"></textarea>',
    '<button type="submit" formaction="/other-action">Send</button></form><a href="mailto:hello(at)example.test">Mail</a>',
  ].join('')),
  '/signup': page('Sign up', [
    '<h1>Sign up</h1><form action="/register?step=1"><label for="n">Name</label><input id="n" name="full_name">',
    '<input type="password" name="pw" placeholder="Password" onpaste="return false"><input name="vat" autocomplete="nope"><input type="submit"></form>',
    '<form action="/search" role="search"><input type="search" name="q" aria-label="Search"></form>',
  ].join('')),
};

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {string} */
let tmp;
/** @type {string} */
let projectDir;
/** @type {ToolDef[]} */
let tools;
/** @type {any} */
let audit;

/** @param {string} name @param {Record<string, unknown>} [args] */
async function call(name, args = {}) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name}`);
  return /** @type {any} */ (await tool.handler(args));
}

before(async () => {
  server = await startServer(routes);
  tmp = await mkdtemp(path.join(os.tmpdir(), 'seekwide-cro-it-'));
  projectDir = path.join(tmp, 'project');
  await mkdir(projectDir);
  tools = createTools({
    crawlManager: createCrawlManager({ dataDir: path.join(tmp, 'data'), sleep: async () => {} }),
    checks: allChecks(),
    ...store,
    renderMarkdown,
    renderHtml,
    checkExternalLinks: (urls, options) => checkExternalLinks(urls, { ...options, sleep: async () => {} }),
    checkImageFiles: (urls, options) => checkImageFiles(urls, { ...options, sleep: async () => {} }),
    fetchLlmsTxt: (origin, options) => fetchLlmsTxt(origin, { ...options, sleep: async () => {} }),
    measureVitals: async () => {
      throw new Error('Core Web Vitals are not measured for a site on this machine');
    },
    loadProjectSources: async () => {
      throw new Error('not used');
    },
    attachSources: async () => {
      throw new Error('not used');
    },
    now: () => new Date('2026-11-14T10:00:00.000Z'),
    defaultProjectDir: () => projectDir,
    env: {},
  });
  const started = await call('crawl_start', { url: `${server.origin}/`, allow_localhost: true });
  let status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  while (status.status === 'running') status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  audit = await call('audit_run', { job_id: started.job_id, check_core_web_vitals: false });
});

after(async () => {
  await server?.close();
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

test('no form is submitted and no action URL is requested, by the crawl or by any module of the audit', () => {
  const paths = server.requests.map((request) => request.url.split('?')[0]);
  assert.ok(paths.includes('/contact') && paths.includes('/signup'), 'the pages with forms were crawled');
  for (const action of ['/submit-here', '/other-action', '/register', '/search']) assert.ok(!paths.includes(action), `${action} was never requested`);
  assert.deepEqual([...new Set(server.requests.map((request) => request.method))].filter((method) => method !== 'GET' && method !== 'HEAD'), [], 'only GET and HEAD');
});

test('the audit result, findings_query and the stored run show the cro findings and observations', async () => {
  assert.ok(audit.modules.cro, 'the cro module has a score entry');
  const findings = await call('findings_query', { module: 'cro', limit: 200 });
  const ids = new Set(findings.findings.map((/** @type {any} */ f) => f.check_id));
  for (const id of ['cro.form.control_unnamed', 'cro.form.autocomplete_invalid', 'cro.form.paste_blocked', 'cro.contact.link_invalid', 'cro.form.placeholder_only']) assert.ok(ids.has(id), id);
  assert.deepEqual(audit.observations.map((/** @type {any} */ o) => [o.id, o.status]), [['cro.consent_tool', 'measured'], ['cro.contact_path', 'measured'], ['cro.first_action', 'measured'], ['sxo.crux_ad_metrics', 'not_available']]);
  const contact = audit.observations[1].values;
  assert.deepEqual([contact.pages_read, contact.tel_pages, contact.mailto_pages, contact.form_pages, contact.contact_link_pages], [3, 1, 1, 2, 1]);
  const saved = await store.loadRun(projectDir, audit.run_id);
  assert.deepEqual(saved.observations, audit.observations);
});

test('the rendered reports show the cro findings and the observations', async () => {
  const rendered = await call('report_render', { run_id: audit.run_id });
  const md = await readFile(rendered.files.markdown, 'utf8');
  assert.match(md, /## Observed \(not scored\)/);
  assert.match(md, /Pages with a tel: link: 1 of 3 pages read\./);
  assert.match(md, /The first button in the main element comes after 6 words and 5 elements of the HTML/);
  assert.match(md, /Form control without a name/);
  const html = await readFile(rendered.files.html, 'utf8');
  assert.match(html, /<h2>Observed \(not scored\)<\/h2>/);
  assert.match(html, /Phone or email link that cannot work/);
});
