// End to end for the smo and aso modules: crawl a synthetic local site with
// the real crawler, audit it through the tools with the real check of sharing
// images, and compare the findings with what the site was built to have. The
// network log shows that no request left the local site, so none went to a
// social platform or to Google Play.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { sharingRoutes } from '../../fixtures/sharing/routes.js';
import { allChecks } from '../../plugin/server/src/checks/registry.js';
import { USER_AGENT } from '../../plugin/server/src/config.js';
import { createCrawlManager } from '../../plugin/server/src/crawl/manager.js';
import { fetchAppFiles } from '../../plugin/server/src/net/app-files.js';
import { checkImageFiles } from '../../plugin/server/src/net/image-check.js';
import { checkExternalLinks } from '../../plugin/server/src/net/link-check.js';
import { safeFetch } from '../../plugin/server/src/net/safe-fetch.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import * as store from '../../plugin/server/src/store/index.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { startServer } from '../helpers/http-server.js';

/** @import { ToolDef } from '../../plugin/server/src/mcp/stdio.js' */

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {string} */
let tmp;
/** @type {ToolDef[]} */
let tools;
/** Every URL any check asked safeFetch for, outside the crawl. */
const sent = /** @type {string[]} */ ([]);
/** @type {any} */
let audit;
/** @type {any} */
let saved;

/**
 * safeFetch that records every URL and sends nothing off this machine: a test
 * may not reach outside 127.0.0.1, so any other address is refused here.
 */
const logged = () => /** @type {typeof safeFetch} */ (async (url, options) => {
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

before(async () => {
  server = await startServer(sharingRoutes);
  tmp = await mkdtemp(path.join(os.tmpdir(), 'seekwide-sharing-it-'));
  const projectDir = path.join(tmp, 'project');
  await mkdir(projectDir);
  tools = createTools({
    crawlManager: createCrawlManager({ dataDir: path.join(tmp, 'data'), sleep: async () => {}, fetch: logged() }),
    checks: allChecks(),
    ...store,
    renderMarkdown,
    renderHtml,
    checkExternalLinks: (urls, options) => checkExternalLinks(urls, { ...options, sleep: async () => {}, fetch: logged() }),
    checkImageFiles: (urls, options) => checkImageFiles(urls, { ...options, sleep: async () => {}, fetch: logged() }),
    fetchAppFiles: (origin, options) => fetchAppFiles(origin, { ...options, sleep: async () => {}, fetch: logged() }),
    measureVitals: async () => {
      throw new Error('Core Web Vitals are not measured for a site on this machine');
    },
    loadProjectSources: async () => {
      throw new Error('not used');
    },
    attachSources: async () => {
      throw new Error('not used');
    },
    now: () => new Date('2026-11-13T10:00:00.000Z'),
    defaultProjectDir: () => projectDir,
    env: {},
  });
  const started = await call('crawl_start', { url: `${server.origin}/`, allow_localhost: true });
  let status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  while (status.status === 'running') status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  audit = await call('audit_run', { job_id: started.job_id, modules: ['links', 'smo', 'aso'], check_core_web_vitals: false });
  saved = await store.loadRun(projectDir, audit.run_id);
});

after(async () => {
  await server.close();
  await rm(tmp, { recursive: true, force: true });
});

/** @param {string} id */
const failing = (id) => saved.findings.filter((/** @type {any} */ finding) => finding.check_id === id).map((/** @type {any} */ finding) => new URL(finding.url).pathname);
/** @param {string} id */
const stat = (id) => {
  const found = saved.checks.find((/** @type {any} */ check) => check.id === id);
  return [found.status === 'run' ? found.applicable : found.status, found.failed];
};

test('each sharing check finds what the site was built to have, and passes the rest', () => {
  assert.deepEqual(failing('smo.robots.preview_bot_blocked'), ['/']);
  assert.deepEqual(failing('smo.og.head_too_late'), ['/late']);
  assert.deepEqual(failing('smo.og.outside_head'), ['/body-og']);
  assert.deepEqual(failing('smo.og.required_missing'), ['/body-og']);
  assert.deepEqual(failing('smo.og.image_too_small'), ['/small']);
  assert.deepEqual(failing('smo.og.image_heavy'), ['/small']);
  assert.deepEqual(stat('smo.og.image_broken'), [2, 0], 'the image on a social platform is not a unit');
  assert.deepEqual(failing('smo.profiles.sameas_missing'), ['/'], 'the home page links to a Facebook profile');
  assert.deepEqual(failing('smo.profiles.rel_me_missing'), ['/']);
  assert.deepEqual(failing('smo.og.image_missing'), []);
  assert.deepEqual(failing('smo.og.image_not_absolute'), ['/'], 'the home page gives a relative og:image');
  assert.deepEqual(failing('aso.banner.app_id_invalid'), ['/banner']);
  assert.deepEqual(failing('aso.banner.outside_head'), []);
  assert.deepEqual(saved.social_images, { images: 3, selected: 2, outcomes: { ok: 2 }, sized: 2, local: true });
  assert.deepEqual(saved.not_requested, { links: 2, images: 0, social_images: 1, hosts: ['facebook.com', 'fbcdn.net', 'play.google.com'] });
  assert.equal(saved.app_files, null, 'a site on this machine: the files are read from the deployed site');
});

test('no request of the crawl or of any check left the local site: none went to a social platform or Google Play', () => {
  assert.ok(sent.length > 0);
  // The external link check of a local audit contacts external sites; here every external link is off limits but one
  // fediverse profile, which the test guard refuses before anything is sent.
  const away = sent.filter((url) => !url.startsWith(server.origin));
  assert.deepEqual([...new Set(away.map((url) => new URL(url).host))], ['mastodon.example']);
  assert.ok(!sent.some((url) => /facebook|fbcdn|google\.com/.test(url)), JSON.stringify(sent));
});

test('the sharing images were read with one ranged GET each, after robots.txt, naming the crawler', () => {
  const imageHits = server.requests.filter((request) => request.url.startsWith('/img/'));
  assert.equal(imageHits.length, 2);
  for (const request of imageHits) {
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.range, 'bytes=0-65535');
    assert.equal(request.headers['user-agent'], USER_AGENT);
  }
});

test('the notes and the report say what was checked and what was not requested by rule', () => {
  assert.ok(audit.notes.some((/** @type {string} */ note) => note.startsWith('Not checked, by rule: 2 external links, 1 sharing image')));
  const md = renderMarkdown(saved, {});
  assert.match(md, /^# Link, social sharing and app audit/);
  assert.match(md, /Not checked, by rule/);
  assert.match(md, /How sharing previews are checked/);
});
