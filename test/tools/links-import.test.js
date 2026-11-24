// search_data_import with the tables of Search Console's Links report, and the
// section report_render builds from them: how each linked page fared in the
// audit's crawl, and which sites the latest links come from.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { ToolError } from '../../plugin/server/src/mcp/stdio.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { LINKS_SUPPLIED } from '../../plugin/server/src/report/links.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { SITE, googleLatestLinksCsv, googleTopLinkedCsv } from '../helpers/exports.js';
import { makeCrawl, makePage, makeRedirect } from '../helpers/factories.js';
import { makeRun } from '../helpers/run-factory.js';
import { makeDeps, toolNamed } from './fakes.js';

/** @type {string} */
let root;
/** @type {string} */
let project;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'seekwide-links-import-'));
  project = path.join(root, 'project');
  await mkdir(project);
  await writeFile(path.join(project, 'top.csv'), googleTopLinkedCsv());
  await writeFile(path.join(project, 'latest.csv'), googleLatestLinksCsv());
});
after(() => rm(root, { recursive: true, force: true }));

const run = () => makeRun({ run_id: 'r1', crawl: { id: 'c-1' } });
const crawl = () => makeCrawl({
  id: 'c-1',
  pages: [
    makePage({ url: `${SITE}/` }),
    makePage({ url: `${SITE}/pricing`, indexability: { indexable: false, reasons: ['noindex_meta'] } }),
    makeRedirect(`${SITE}/old-page`, `${SITE}/`),
  ],
});

/** @param {Parameters<typeof makeDeps>[0]} [seed] */
function setup(seed = { runs: [run()], results: [crawl()] }) {
  const fake = makeDeps({ projectDir: project, ...seed });
  const tools = createTools(fake.deps);
  return { fake, importTool: toolNamed(tools, 'search_data_import'), report: toolNamed(tools, 'report_render') };
}
const refused = (/** @type {RegExp} */ message) => (/** @type {unknown} */ error) => error instanceof ToolError && message.test(error.message);

describe('search_data_import with the Links report', () => {
  it('imports the top linked pages and lists the linked pages that have a problem in the latest audit', async () => {
    const { importTool } = setup();
    const result = /** @type {any} */ (await importTool.handler({ path: 'top.csv', source: 'google_search_console_links', project_dir: project }));
    assert.equal(result.saved_to, '.seekwide/imports/google_search_console_links.json');
    assert.deepEqual([result.replaced, result.targets, result.linking_pages], [null, 4, 0]);
    assert.deepEqual(result.top_targets[0], { url: `${SITE}/`, links: 30, sites: 12 });
    assert.deepEqual(result.linked_pages_with_problems.map((/** @type {any} */ row) => row.url), [`${SITE}/pricing`, `${SITE}/old-page`]);
    assert.match(result.linked_pages_with_problems[0].state, /Not indexable: noindex meta/);
    assert.match(result.notes.join(' '), /a sample/);
    const again = /** @type {any} */ (await importTool.handler({ path: 'top.csv', source: 'google_search_console_links', project_dir: project }));
    assert.equal(again.replaced.imported_at, '2026-11-11T14:03:22.000Z');
  });

  it('imports Latest links, says it names no target page, and refuses a period', async () => {
    const { importTool } = setup();
    const result = /** @type {any} */ (await importTool.handler({ path: 'latest.csv', source: 'google_search_console_latest_links', project_dir: project }));
    assert.deepEqual([result.targets, result.linking_pages, result.linked_pages_with_problems], [0, 4, null]);
    assert.match(result.notes.join(' '), /not the page each one links to/);
    await assert.rejects(importTool.handler({ path: 'latest.csv', source: 'google_search_console_latest_links', project_dir: project, period_start: '2026-10-01', period_end: '2026-10-02' }), refused(/states no period/));
  });

  it('says how the pages answer is unknown when the project has no audit', async () => {
    const { importTool } = setup({ runs: [], results: [] });
    const result = /** @type {any} */ (await importTool.handler({ path: 'top.csv', source: 'google_search_console_links', project_dir: project }));
    assert.equal(result.linked_pages_with_problems, null);
    assert.match(result.notes.join(' '), /no saved audit yet/);
  });

  it('report_render adds the section on links from other sites, problems first and sites grouped by domain', async () => {
    const { fake, importTool, report } = setup();
    await importTool.handler({ path: 'top.csv', source: 'google_search_console_links', project_dir: project });
    await importTool.handler({ path: 'latest.csv', source: 'google_search_console_latest_links', project_dir: project });
    const result = /** @type {any} */ (await report.handler({ project_dir: project, formats: ['markdown'] }));
    assert.ok(result.search_data.includes('google_search_console_links') && result.search_data.includes('google_search_console_latest_links'));
    const [, options] = /** @type {any} */ (fake.calls.renderMarkdown[0]);
    const markdown = renderMarkdown(run(), options);
    assert.match(markdown, /## Links from other sites \(imported\)/);
    assert.ok(markdown.includes(LINKS_SUPPLIED));
    assert.match(markdown, /Linked pages with a problem in this audit: 2/);
    const pricing = markdown.indexOf(`${SITE}/pricing`);
    assert.ok(pricing !== -1 && pricing < markdown.indexOf('| OK |'));
    assert.match(markdown, /Not crawled/);
    assert.match(markdown, /Linking sites: 2/);
    assert.match(markdown, /\| `social\.test` \| 2 \| 2026-10-20 \|/);
    assert.match(markdown, /Crawled by Google: 2026-06-14 to 2026-11-15/);
    assert.match(renderHtml(run(), options), /Links from other sites \(imported\)/);
  });
});
