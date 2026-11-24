// search_data_import with YouTube Studio's exports, and the section
// report_render builds from them.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { ToolError } from '../../plugin/server/src/mcp/stdio.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { YOUTUBE_SUPPLIED } from '../../plugin/server/src/report/youtube.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { youtubeSearchTermsZip, youtubeTrafficSourcesZip } from '../helpers/exports.js';
import { makeRun } from '../helpers/run-factory.js';
import { makeDeps, toolNamed } from './fakes.js';

/** @type {string} */
let root;
/** @type {string} */
let project;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'seekwide-youtube-import-'));
  project = path.join(root, 'project');
  await mkdir(project);
  await writeFile(path.join(project, 'terms.zip'), youtubeSearchTermsZip());
  await writeFile(path.join(project, 'sources.zip'), youtubeTrafficSourcesZip());
});
after(() => rm(root, { recursive: true, force: true }));

const setup = () => {
  const fake = makeDeps({ projectDir: project, runs: [makeRun({ run_id: 'r1' })] });
  const tools = createTools(fake.deps);
  return { fake, importTool: toolNamed(tools, 'search_data_import'), report: toolNamed(tools, 'report_render') };
};
const refused = (/** @type {RegExp} */ message) => (/** @type {unknown} */ error) => error instanceof ToolError && message.test(error.message);

describe('search_data_import with YouTube Studio exports', () => {
  it('imports the search terms and says what they are', async () => {
    const { importTool } = setup();
    const result = /** @type {any} */ (await importTool.handler({ path: 'terms.zip', source: 'youtube_search_terms', project_dir: project }));
    assert.equal(result.saved_to, '.seekwide/imports/youtube_search_terms.json');
    assert.deepEqual([result.period, result.total, result.rows], [{ start: '2026-10-27', end: '2026-10-29' }, { views: 91, watch_hours: 1.5 }, 3]);
    assert.match(result.notes.join(' '), /top 3 rows only/);
    assert.match(result.notes.join(' '), /not on the web/);
    await assert.rejects(importTool.handler({ path: 'terms.zip', source: 'youtube_search_terms', project_dir: project, period_start: '2026-10-01', period_end: '2026-10-02' }), refused(/states its days/));
  });

  it('report_render adds the section on search on YouTube', async () => {
    const { fake, importTool, report } = setup();
    await importTool.handler({ path: 'terms.zip', source: 'youtube_search_terms', project_dir: project });
    await importTool.handler({ path: 'sources.zip', source: 'youtube_traffic_sources', project_dir: project });
    const result = /** @type {any} */ (await report.handler({ project_dir: project, formats: ['markdown'] }));
    assert.deepEqual(result.search_data, ['youtube_search_terms', 'youtube_traffic_sources']);
    const [, options] = /** @type {any} */ (fake.calls.renderMarkdown[0]);
    const markdown = renderMarkdown(makeRun({ run_id: 'r1' }), options);
    assert.match(markdown, /## Search on YouTube \(imported\)/);
    assert.ok(markdown.includes(YOUTUBE_SUPPLIED));
    assert.match(markdown, /\| `example widgets` \| 40 \| 44\.0 % \| 0\.8 \|/);
    assert.match(markdown, /Share of views from YouTube search: 22\\\.8 %/);
    assert.match(markdown, /top 3 terms only/);
    assert.match(renderHtml(makeRun({ run_id: 'r1' }), options), /<section id="search-on-youtube">/);
  });
});
