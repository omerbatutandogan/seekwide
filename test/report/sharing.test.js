import assert from 'node:assert/strict';
import { test } from 'node:test';

import { reportTitle } from '../../plugin/server/src/report/copy.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { buildReport } from '../../plugin/server/src/report/model.js';
import { storedRunProblem } from '../../plugin/server/src/store/run-validate.js';
import { makeRun } from '../helpers/run-factory.js';

/** A run of the smo and aso modules with what they collected. */
function sharingRun() {
  const run = makeRun();
  run.modules_requested = ['smo', 'aso'];
  run.modules = {
    smo: { score: 92, coverage: 1, checks_total: 16, checks_run: 16, checks_skipped: 0, note: null },
    aso: { score: null, coverage: 1, checks_total: 6, checks_run: 6, checks_skipped: 0, note: 'No scored check had anything to look at.' },
  };
  run.social_images = { images: 30, selected: 20, outcomes: { ok: 18, broken: 1, unverifiable: 1 }, sized: 17, local: false };
  run.app_files = {
    aasa: { url: 'https://example.test/.well-known/apple-app-site-association', outcome: 'answered', status: 200 },
    assetlinks: { url: 'https://example.test/.well-known/assetlinks.json', outcome: 'not_found', status: 404 },
  };
  run.not_requested = { links: 3, images: 0, social_images: 1, hosts: ['facebook.com', 'play.google.com'] };
  return run;
}

test('the title names the social sharing and app modules', () => {
  assert.equal(reportTitle(['smo']), 'Social sharing audit');
  assert.equal(reportTitle(['smo', 'aso']), 'Social sharing and app audit');
  assert.equal(reportTitle(['seo', 'links', 'security', 'media', 'smo', 'aso']), 'SEO, link, security, media, social sharing and app audit');
  assert.equal(reportTitle(['seo', 'links']), 'SEO and link audit');
});

test('a run of the smo and aso modules shows what they requested, what was not requested by rule, and their method', () => {
  const run = sharingRun();
  const report = buildReport(run);
  assert.deepEqual(report.scores.map((score) => score.label), ['Social sharing', 'App links']);
  const row = (/** @type {string} */ label) => report.scope.find((entry) => entry.label === label)?.value;
  assert.equal(row('Sharing images'), '20 of 30 distinct sharing images checked (robots.txt first, then one GET of at most 64 KiB each); 19 answered, and the pixel size of 17 was read from the file.');
  assert.equal(row('App association files'), 'apple-app-site-association: served. assetlinks.json: not found.');
  assert.equal(row('Not checked, by rule'), '3 external links, 1 sharing image on Google Play or social platforms (facebook.com, play.google.com). Seekwide never sends a request there.');
  assert.ok(report.method.some((section) => section.label === 'How sharing previews are checked'));
  assert.ok(report.method.some((section) => section.label === 'How app links are checked'));
  const md = renderMarkdown(run);
  assert.match(md, /^# Social sharing and app audit/);
  assert.match(md, /No request is ever sent to a social platform/);
  assert.match(renderHtml(run), /How app links are checked/);

  const plain = buildReport(makeRun());
  assert.ok(!plain.scope.some((entry) => ['Sharing images', 'App association files', 'Not checked, by rule'].includes(entry.label)));
  assert.ok(!plain.method.some((section) => section.label.startsWith('How sharing') || section.label.startsWith('How app')));
});

test('a stored run with these fields in the plugin\'s form passes; anything else is refused by field name', () => {
  const good = sharingRun();
  assert.equal(storedRunProblem(/** @type {any} */ (good)), null);
  /** @param {(run: any) => void} change */
  const problem = (change) => {
    const run = /** @type {any} */ (sharingRun());
    change(run);
    return storedRunProblem(run);
  };
  assert.equal(problem((run) => { run.not_requested.hosts = ['<script>']; }), 'not_requested.hosts');
  assert.equal(problem((run) => { run.not_requested.links = -1; }), 'not_requested');
  assert.equal(problem((run) => { run.app_files.aasa.url = 'javascript:alert(1)'; }), 'app_files.aasa.url');
  assert.equal(problem((run) => { run.app_files.assetlinks.outcome = 'maybe'; }), 'app_files.assetlinks');
  assert.equal(problem((run) => { run.social_images.local = 'no'; }), 'social_images');
  assert.equal(problem((run) => { run.social_images.outcomes.ok = 1.5; }), 'social_images.outcomes');
  assert.equal(problem((run) => { run.social_images = null; run.app_files = null; run.not_requested = null; }), null);
  assert.equal(problem((run) => { run.modules_requested = ['smo', 'vso']; }), 'modules_requested');
});
