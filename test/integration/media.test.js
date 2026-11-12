// End to end for the media module: crawl a synthetic local site with the real
// crawler, audit it with every module through the tools, with the real check
// of image files, and compare the findings with what the site was built to have.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { mediaRoutes } from '../../fixtures/media/routes.js';
import { allChecks } from '../../server/src/checks/registry.js';
import { USER_AGENT } from '../../server/src/config.js';
import { createCrawlManager } from '../../server/src/crawl/manager.js';
import { IMAGE_ACCEPT, checkImageFiles } from '../../server/src/net/image-check.js';
import { checkExternalLinks } from '../../server/src/net/link-check.js';
import { safeFetch } from '../../server/src/net/safe-fetch.js';
import { renderHtml } from '../../server/src/report/html.js';
import { renderMarkdown } from '../../server/src/report/markdown.js';
import * as store from '../../server/src/store/index.js';
import { createTools } from '../../server/src/tools/index.js';
import { startServer } from '../helpers/http-server.js';

/** @import { ToolDef } from '../../server/src/mcp/stdio.js' */

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
/** @type {string} */
let tmp;
/** @type {ToolDef[]} */
let tools;
/** Every URL the image check asked safeFetch for. */
const imageRequests = /** @type {string[]} */ ([]);
/** @type {any} */
let audit;
/** @type {any} */
let saved;

/** @param {string} name @param {Record<string, unknown>} [args] */
async function call(name, args = {}) {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `tool ${name}`);
  return /** @type {any} */ (await tool.handler(args));
}

before(async () => {
  server = await startServer(mediaRoutes);
  tmp = await mkdtemp(path.join(os.tmpdir(), 'seekwide-media-it-'));
  const projectDir = path.join(tmp, 'project');
  await mkdir(projectDir);
  tools = createTools({
    crawlManager: createCrawlManager({ dataDir: path.join(tmp, 'data'), sleep: async () => {} }),
    checks: allChecks(),
    ...store,
    renderMarkdown,
    renderHtml,
    checkExternalLinks: (urls, options) => checkExternalLinks(urls, { ...options, sleep: async () => {} }),
    // The real check with the real safeFetch: what keeps it on the local address is the audit's own rule.
    checkImageFiles: (urls, options) => checkImageFiles(urls, {
      ...options,
      sleep: async () => {},
      fetch: (url, fetchOptions) => {
        imageRequests.push(url);
        return safeFetch(url, fetchOptions);
      },
    }),
    measureVitals: async () => {
      throw new Error('Core Web Vitals are not measured for a site on this machine');
    },
    loadProjectSources: async () => {
      throw new Error('not used');
    },
    attachSources: async () => {
      throw new Error('not used');
    },
    now: () => new Date('2026-11-12T10:00:00.000Z'),
    defaultProjectDir: () => projectDir,
    env: {},
  });
  const started = await call('crawl_start', { url: `${server.origin}/`, allow_localhost: true });
  let status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  while (status.status === 'running') status = await call('crawl_status', { job_id: started.job_id, wait_seconds: 25 });
  audit = await call('audit_run', { job_id: started.job_id, check_core_web_vitals: false });
  saved = await store.loadRun(projectDir, audit.run_id);
});

after(async () => {
  await server.close();
  await rm(tmp, { recursive: true, force: true });
});

/** @param {string} id @returns {[number, number]} units and failures */
const stat = (id) => {
  const found = saved.checks.find((/** @type {any} */ check) => check.id === id);
  assert.ok(found, id);
  assert.equal(found.status, 'run', `${id}: ${found.skip_reason}`);
  return [found.applicable, found.failed];
};
/** @param {string} id */
const failing = (id) => saved.findings.filter((/** @type {any} */ finding) => finding.check_id === id).map((/** @type {any} */ finding) => new URL(finding.url).pathname + (finding.selector ? ` ${finding.selector}` : ''));

test('an audit without a module list runs the media module and scores it', () => {
  assert.deepEqual(saved.modules_requested, ['seo', 'links', 'security', 'media']);
  assert.equal(saved.modules.media.coverage, 1);
  assert.ok(saved.modules.media.score > 0 && saved.modules.media.score < 100);
  assert.deepEqual(saved.image_files, { images: 7, selected: 6, outcomes: { ok: 5, broken: 1 }, local: true });
});

test('each image check finds what the site was built to have, and passes the rest', () => {
  assert.deepEqual(stat('media.image.alt_missing'), [3, 1]);
  assert.deepEqual(failing('media.image.alt_missing'), ['/gallery img:not([alt])']);
  assert.deepEqual(stat('media.image.alt_placeholder'), [3, 1]);
  assert.deepEqual(failing('media.image.alt_placeholder'), ['/gallery img[alt]']);
  assert.deepEqual(stat('media.image.dimensions_missing'), [3, 1]);
  assert.deepEqual(failing('media.image.dimensions_missing'), ['/ img:not([width][height])']);
  assert.deepEqual(stat('media.image.lazy_priority'), [1, 1]);
  assert.deepEqual(stat('media.image.broken'), [6, 1]);
  assert.deepEqual(failing('media.image.broken'), ['/ img[src="/img/missing.jpg"]']);
  assert.deepEqual(stat('media.image.legacy_format'), [4, 2]);
  assert.deepEqual(failing('media.image.legacy_format'), ['/ img[src="/img/logo.png"]', '/gallery img[src="/private-img/plan.png"]']);
  assert.deepEqual(stat('media.image.large_file'), [4, 1]);
  assert.deepEqual(failing('media.image.large_file'), ['/gallery img[src="/private-img/plan.png"]']);
  assert.deepEqual(stat('media.image.robots_blocked'), [6, 1]);
  const [robots] = saved.findings.filter((/** @type {any} */ finding) => finding.check_id === 'media.image.robots_blocked');
  assert.deepEqual(robots.evidence.observed, { crawler: 'Googlebot-Image', robots_host: '127.0.0.1' });
  // The broken image on the home page is shown on no other page.
  assert.deepEqual(saved.findings.find((/** @type {any} */ finding) => finding.check_id === 'media.image.broken').related_urls, []);
});

test('each video check finds what the site was built to have', () => {
  assert.deepEqual(stat('media.video.captions_missing'), [2, 1]);
  assert.deepEqual(failing('media.video.captions_missing'), ['/talk video']);
  assert.deepEqual(stat('media.video.structured_data_incomplete'), [2, 1]);
  assert.deepEqual(failing('media.video.structured_data_incomplete'), ['/talk jsonld[1] VideoObject[1]']);
});

test('the image check stays on the local address, reads robots.txt first, names itself and asks for no whole file', () => {
  assert.ok(imageRequests.length > 0);
  assert.ok(imageRequests.every((url) => url.startsWith(server.origin)), JSON.stringify(imageRequests));
  assert.ok(!server.requests.some((request) => request.url.includes('pixel.gif')), 'a tracking pixel is never requested');
  const imageHits = server.requests.filter((request) => request.url.startsWith('/img/') || request.url.startsWith('/private-img/'));
  const firstImage = server.requests.indexOf(imageHits[0]);
  const robotsBefore = server.requests.slice(0, firstImage).filter((request) => request.url === '/robots.txt').length;
  assert.ok(robotsBefore >= 1, 'robots.txt is read before the first image');
  for (const request of imageHits) {
    assert.equal(request.headers['user-agent'], USER_AGENT);
    assert.equal(request.headers.accept, IMAGE_ACCEPT);
    assert.ok(request.method === 'HEAD' || request.headers.range === 'bytes=0-0', `${request.method} ${request.url}`);
  }
  assert.ok(!server.requests.some((request) => request.url.startsWith('/media/')), 'video files are never requested');
});

test('the notes and both reports say what the media module checked', async () => {
  assert.ok(audit.notes.includes('The pages show 7 distinct images; 6 of them were chosen to check, page by page in crawl order, and 6 answered.'));
  assert.ok(audit.notes.some((/** @type {string} */ note) => note.startsWith('This is a site on this machine, so only images on its own address were checked')));
  const md = renderMarkdown(saved, {});
  assert.match(md, /^# SEO, link, security and media audit/);
  assert.match(md, /6 of 7 distinct images chosen to check \(robots\.txt first, then a HEAD request each\); 6 answered\./);
  assert.match(md, /\| Media \| \d+ \/ 100 \|/);
  assert.match(renderHtml(saved, {}), /How images and videos are checked/);
});
