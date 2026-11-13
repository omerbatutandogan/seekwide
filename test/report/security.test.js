import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reportTitle } from '../../plugin/server/src/report/copy.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { buildReport } from '../../plugin/server/src/report/model.js';
import { makeRun } from '../helpers/run-factory.js';

test('the title names the modules only when the security module ran', () => {
  assert.equal(reportTitle(['seo', 'links']), 'SEO and link audit');
  assert.equal(reportTitle(['seo']), 'SEO and link audit');
  assert.equal(reportTitle(undefined), 'SEO and link audit');
  assert.equal(reportTitle(['security', 'links', 'seo']), 'SEO, link and security audit');
  assert.equal(reportTitle(['security']), 'Security audit');
  assert.equal(reportTitle(['links', 'security']), 'Link and security audit');
});

test('a run with the security module says in both formats what an outside audit can and cannot see', () => {
  const run = makeRun();
  run.modules_requested = ['seo', 'links', 'security'];
  run.modules.security = { score: 96, coverage: 1, checks_total: 10, checks_run: 10, checks_skipped: 0, note: null };
  const report = buildReport(run);
  assert.equal(report.title, 'SEO, link and security audit');
  const labels = report.method.map((section) => section.label);
  assert.ok(labels.includes('How security signals are found'));
  assert.ok(labels.includes('What an outside audit cannot see'));
  assert.deepEqual(report.scores.map((score) => score.label), ['SEO', 'Links', 'Security']);
  const md = renderMarkdown(run);
  assert.ok(md.startsWith('# SEO, link and security audit\n'));
  assert.match(md, /a clean result here does not prove that the site is clean/);
  assert.match(md, /\| Security \| 96 \/ 100 \| 100% \| 10 of 10 \|/);
  const page = renderHtml(run);
  assert.match(page, /<h1>SEO, link and security audit<\/h1>/);
  assert.match(page, /What an outside audit cannot see/);

  const without = buildReport(makeRun());
  assert.equal(without.title, 'SEO and link audit');
  assert.ok(!without.method.some((section) => section.label === 'How security signals are found'));
});
