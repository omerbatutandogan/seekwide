// search_data_import with the AI reports: stored as their own sources, and
// report_render fills the AI visibility layer and section from them.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { ToolError } from '../../plugin/server/src/mcp/stdio.js';
import { AI_SUPPLIED } from '../../plugin/server/src/report/ai-visibility.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { SITE, bingAiOverviewCsv, bingAiPagesCsv, googleAiZip, googleZipEnglish } from '../helpers/exports.js';
import { makeRun } from '../helpers/run-factory.js';
import { makeDeps, toolNamed } from './fakes.js';

/** @type {string} */
let root;
/** @type {string} */
let project;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'seekwide-ai-import-'));
  project = path.join(root, 'project');
  await mkdir(project);
  await writeFile(path.join(project, 'gsc-ai.zip'), googleAiZip());
  await writeFile(path.join(project, 'gsc.zip'), googleZipEnglish());
  await writeFile(path.join(project, 'bing-ai.csv'), bingAiOverviewCsv());
  await writeFile(path.join(project, 'bing-ai-pages.csv'), bingAiPagesCsv());
});
after(() => rm(root, { recursive: true, force: true }));

const setup = () => {
  const fake = makeDeps({ projectDir: project, runs: [makeRun({ run_id: 'r1' })] });
  const tools = createTools(fake.deps);
  return { fake, importTool: toolNamed(tools, 'search_data_import'), report: toolNamed(tools, 'report_render') };
};
const refused = (/** @type {RegExp} */ message) => (/** @type {unknown} */ error) => error instanceof ToolError && message.test(error.message);

describe('search_data_import with the AI reports', () => {
  it('imports each report as its own source, with its period, totals and pages', async () => {
    const { importTool } = setup();
    const google = /** @type {any} */ (await importTool.handler({ path: 'gsc-ai.zip', source: 'google_search_console_ai', project_dir: project }));
    assert.equal(google.saved_to, '.seekwide/imports/google_search_console_ai.json');
    assert.deepEqual([google.period, google.totals, google.dates, google.pages], [{ start: '2026-10-01', end: '2026-10-03', from: 'file' }, { impressions: 12 }, 3, 3]);
    assert.match(google.notes.join(' '), /impressions only/);
    const bing = /** @type {any} */ (await importTool.handler({ path: 'bing-ai.csv', source: 'bing_ai_performance', project_dir: project }));
    assert.deepEqual(bing.totals, { citations: 4, peak_cited_pages: 2, days_cited: 2 });
    const pages = /** @type {any} */ (await importTool.handler({ path: 'bing-ai-pages.csv', source: 'bing_ai_pages', project_dir: project, period_start: '2026-09-30', period_end: '2026-10-02' }));
    assert.deepEqual([pages.period, pages.top_pages[0]], [{ start: '2026-09-30', end: '2026-10-02', from: 'user' }, { url: `${SITE}/`, citations: 3 }]);
  });

  it('refuses the Performance report as the AI report, and a period for a file that has dates', async () => {
    const { importTool } = setup();
    await assert.rejects(importTool.handler({ path: 'gsc.zip', source: 'google_search_console_ai', project_dir: project }), refused(/source google_search_console/));
    await assert.rejects(importTool.handler({ path: 'bing-ai.csv', source: 'bing_ai_performance', project_dir: project, period_start: '2026-09-30', period_end: '2026-10-02' }), refused(/Leave period_start and period_end out/));
  });

  it('report_render fills the AI visibility layer and an imported section, and refuses a named source never imported', async () => {
    const { fake, importTool, report } = setup();
    await importTool.handler({ path: 'gsc-ai.zip', source: 'google_search_console_ai', project_dir: project });
    await importTool.handler({ path: 'bing-ai.csv', source: 'bing_ai_performance', project_dir: project });
    const result = /** @type {any} */ (await report.handler({ project_dir: project, formats: ['markdown'] }));
    assert.deepEqual(result.search_data, ['google_search_console_ai', 'bing_ai_performance']);
    const [, options] = /** @type {any} */ (fake.calls.renderMarkdown[0]);
    const markdown = renderMarkdown(makeRun({ run_id: 'r1' }), options);
    assert.match(markdown, /## AI search performance \(imported\)/);
    assert.ok(markdown.includes(AI_SUPPLIED));
    assert.match(markdown, /\*\*Impressions in AI Overviews and AI Mode:\*\* 12/);
    assert.match(markdown, /\*\*Days with a citation:\*\* 2 of 3/);
    assert.doesNotMatch(markdown, /AI visibility[^\n]*No data in this version/);
    assert.match(renderHtml(makeRun({ run_id: 'r1' }), options), /<section id="ai-search-performance">/);
    await assert.rejects(report.handler({ project_dir: project, search_data: ['bing_ai_pages'] }), refused(/No AI report from bing_ai_pages/));
  });
});
