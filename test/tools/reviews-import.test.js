// search_data_import with Play Console's reviews report, and the section
// report_render builds from it.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';

import { ToolError } from '../../plugin/server/src/mcp/stdio.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { REVIEWS_SUPPLIED } from '../../plugin/server/src/report/reviews.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { playReviewsNovember, playReviewsOctober } from '../helpers/exports.js';
import { makeRun } from '../helpers/run-factory.js';
import { makeZip } from '../helpers/zip.js';
import { makeDeps, toolNamed } from './fakes.js';

/** @type {string} */
let root;
/** @type {string} */
let project;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'seekwide-reviews-import-'));
  project = path.join(root, 'project');
  await mkdir(project);
  await writeFile(path.join(project, 'reviews.csv'), playReviewsOctober());
  await writeFile(path.join(project, 'reviews.zip'), makeZip([{ name: 'a.csv', data: playReviewsOctober() }, { name: 'b.csv', data: playReviewsNovember() }]));
});
after(() => rm(root, { recursive: true, force: true }));

/** @param {Parameters<typeof makeDeps>[0]} [seed] */
function setup(seed = {}) {
  const fake = makeDeps({ projectDir: project, runs: [makeRun({ run_id: 'r1' })], ...seed });
  const tools = createTools(fake.deps);
  return { fake, importTool: toolNamed(tools, 'search_data_import'), report: toolNamed(tools, 'report_render') };
}
const refused = (/** @type {RegExp} */ message) => (/** @type {unknown} */ error) => error instanceof ToolError && message.test(error.message);

describe('search_data_import with Play reviews', () => {
  it('imports a month and says what it holds', async () => {
    const { importTool } = setup();
    const result = /** @type {any} */ (await importTool.handler({ path: 'reviews.csv', source: 'google_play_reviews', project_dir: project }));
    assert.equal(result.saved_to, '.seekwide/imports/google_play_reviews.json');
    assert.deepEqual(result.apps, [{ package: 'com.example.app', first_month: '2026-10', last_month: '2026-10', reviews: 4, average_stars: 3, replied: 1, unanswered_low_ratings: 2 }]);
    assert.match(result.notes.join(' '), /zip their files/);
    assert.match(result._note, /data/);
  });

  it('refuses a period, and replaces the earlier import', async () => {
    const { importTool } = setup();
    await assert.rejects(importTool.handler({ path: 'reviews.csv', source: 'google_play_reviews', project_dir: project, period_start: '2026-10-01', period_end: '2026-10-31' }), refused(/states its months/));
    await importTool.handler({ path: 'reviews.csv', source: 'google_play_reviews', project_dir: project });
    const again = /** @type {any} */ (await importTool.handler({ path: 'reviews.zip', source: 'google_play_reviews', project_dir: project }));
    assert.ok(again.replaced !== null);
    assert.equal(again.apps[0].reviews, 6);
  });

  it('report_render adds the Play reviews section with months and unanswered low ratings', async () => {
    const { fake, importTool, report } = setup();
    await importTool.handler({ path: 'reviews.zip', source: 'google_play_reviews', project_dir: project });
    const result = /** @type {any} */ (await report.handler({ project_dir: project, formats: ['markdown'] }));
    assert.deepEqual(result.search_data, ['google_play_reviews']);
    const [, options] = /** @type {any} */ (fake.calls.renderMarkdown[0]);
    const markdown = renderMarkdown(makeRun({ run_id: 'r1' }), options);
    assert.match(markdown, /## Google Play reviews \(imported\)/);
    assert.ok(markdown.includes(REVIEWS_SUPPLIED));
    assert.match(markdown, /Reviews: 6 · Months: 2026-10 to 2026-11 · Average stars of these reviews: 2\\\.50 · Replied to: 33 % · 1 or 2 stars without a reply: 3/);
    assert.match(markdown, /\| 2026-11 \| 2 \| 1\.50 \| 50 % \|/);
    assert.match(markdown, /\| 2026-11-04 \| 1 \| tr \| 42 \| <https:\/\/play\.google\.com\//);
    assert.match(markdown, /1 review was in more than one file and counted once/);
    const page = renderHtml(makeRun({ run_id: 'r1' }), options);
    assert.match(page, /<section id="play-reviews">/);
    assert.match(page, /rel="noopener noreferrer nofollow">Play Console<\/a>/);
    await assert.rejects(report.handler({ project_dir: project, search_data: ['google_play_reviews', 'bing_ai_pages'] }), refused(/No AI report/));
  });
});
