import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reportTitle } from '../../server/src/report/copy.js';
import { renderHtml } from '../../server/src/report/html.js';
import { renderMarkdown } from '../../server/src/report/markdown.js';
import { buildReport } from '../../server/src/report/model.js';
import { makeRun } from '../helpers/run-factory.js';

test('the title names the modules when the media module ran', () => {
  assert.equal(reportTitle(['seo', 'links', 'security', 'media']), 'SEO, link, security and media audit');
  assert.equal(reportTitle(['media']), 'Media audit');
  assert.equal(reportTitle(['seo', 'media']), 'SEO and media audit');
  assert.equal(reportTitle(['seo', 'links']), 'SEO and link audit');
});

test('a run with the media module shows its score, the image files it checked and its method in both formats', () => {
  const run = makeRun();
  run.modules_requested = ['seo', 'links', 'media'];
  run.modules.media = { score: 88, coverage: 1, checks_total: 11, checks_run: 11, checks_skipped: 0, note: null };
  run.image_files = { images: 120, selected: 50, outcomes: { ok: 48, not_checked: 2 }, local: false };
  const report = buildReport(run);
  assert.equal(report.title, 'SEO, link and media audit');
  assert.deepEqual(report.scores.map((score) => score.label), ['SEO', 'Links', 'Media']);
  assert.deepEqual(report.scope.find((row) => row.label === 'Image files'), {
    label: 'Image files', value: '50 of 120 distinct images chosen to check (robots.txt first, then a HEAD request each); 48 answered.',
  });
  assert.ok(report.method.some((section) => section.label === 'How images and videos are checked'));
  const md = renderMarkdown(run);
  assert.match(md, /\| Media \| 88 \/ 100 \| 100% \| 11 of 11 \|/);
  assert.match(md, /50 of 120 distinct images chosen to check/);
  assert.match(md, /No image is downloaded whole/);
  const page = renderHtml(run);
  assert.match(page, /<h1>SEO, link and media audit<\/h1>/);
  assert.match(page, /How images and videos are checked/);

  const without = buildReport(makeRun());
  assert.ok(!without.scope.some((row) => row.label === 'Image files'));
  assert.ok(!without.method.some((section) => section.label === 'How images and videos are checked'));
});

test('the scope row of image files says when only the local address was reached, and survives a damaged value', () => {
  const run = makeRun();
  run.modules_requested = ['media'];
  run.image_files = { images: 3, selected: 2, outcomes: { ok: 2 }, local: true };
  assert.match(buildReport(run).scope.find((row) => row.label === 'Image files')?.value ?? '', /Only images on the address of this site on your machine were requested\./);
  run.image_files = /** @type {any} */ ({ images: 'many', selected: -4 });
  assert.equal(buildReport(run).scope.find((row) => row.label === 'Image files')?.value, 'The crawled pages show no image file to check.');
  run.image_files = { images: 0, selected: 0, outcomes: {}, local: false };
  assert.equal(buildReport(run).scope.find((row) => row.label === 'Image files')?.value, 'The crawled pages show no image file to check.');
});
