// The security headers are given as a count of the recommended headers the
// start page sets, not as a score from 0 to 100: as "Security headers 0/100" a
// site without them (example.com) read like a verdict on the site. The count
// is the same in audit_run's result, both report formats, the comparison of
// two runs and the run index.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { renderHtml } from '../../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../../plugin/server/src/report/markdown.js';
import { buildReport } from '../../../plugin/server/src/report/model.js';
import { compareRuns } from '../../../plugin/server/src/store/compare.js';
import { listRuns, loadRun, saveRun } from '../../../plugin/server/src/store/runs.js';
import { makePage, makeSecurity, makeSecurityHeaders } from '../../helpers/factories.js';
import { makeRun } from '../../helpers/run-factory.js';
import { audit } from './support.js';

/** @import { ModuleScore } from '../../../plugin/server/src/types.js' */

const none = makeSecurityHeaders({ hsts_max_age: null, nosniff: false, frame_ancestors: [], x_frame_options: [], csp: null });
const COUNTED = '0 of 3 recommended headers set';

/** @param {{passed: number, of: number}|null} count @returns {ModuleScore} */
const headers = (count) => ({ score: null, count, coverage: 1, checks_total: 5, checks_run: 5, checks_skipped: 0, note: null });
/** @param {{passed: number, of: number}|null} count @param {Record<string, unknown>} [extra] */
const runWith = (count, extra = {}) => makeRun({ modules: { ...makeRun().modules, security_headers: headers(count) }, ...extra });

test('the headers are counted: how many of the scored header checks pass, with no score and a note that says so', () => {
  const result = audit([makePage({ security: makeSecurity({ headers: none }) })]);
  assert.deepEqual(result.modules.security_headers, {
    score: null, count: { passed: 0, of: 3 }, coverage: 1, checks_total: 5, checks_run: 5, checks_skipped: 0,
    note: `${COUNTED}. A count, not a score.`,
  });
  const http = audit([makePage({ url: 'http://example.test/', security: makeSecurity({ headers: makeSecurityHeaders({ hsts_max_age: null }) }) })], {
    start_url: 'http://example.test/', site_origin: 'http://example.test',
  });
  assert.deepEqual(http.modules.security_headers.count, { passed: 2, of: 2 }, 'Strict-Transport-Security is not counted on an http site');
  assert.equal(result.modules.security.count, undefined, 'a score of 0 to 100 has no count');
});

test('with nothing to count there is no count, and the note says why, as for any score', () => {
  const local = audit([makePage({ security: makeSecurity({ headers: none }) })], { options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true } });
  assert.equal(local.modules.security_headers.count, null);
  assert.equal(local.modules.security_headers.note, 'None of the checks behind this score could run.');
});

test('both report formats and the written summary show the count, never a score out of 100', () => {
  const run = runWith({ passed: 0, of: 3 });
  const report = buildReport(run);
  assert.deepEqual(report.scores.find((score) => score.module === 'security_headers'), {
    module: 'security_headers', label: 'Security headers', score: null, counted: COUNTED, coverage: 1, checksRun: 5, checksTotal: 5, checksSkipped: 0, note: null,
  });
  const summary = report.summary.paragraphs.join(' ');
  assert.match(summary, /Scores \(pass rates of the checks that ran, 0 to 100\): SEO 78; Links 88\. Security headers: 0 of 3 recommended headers set\./);
  const markdown = renderMarkdown(run);
  assert.match(markdown, /\| Security headers \| 0 of 3 recommended headers set \| 100% \| 5 of 5 \|/);
  const page = renderHtml(run);
  assert.match(page, /<td>Security headers<\/td><td>0 of 3 recommended headers set<\/td>/);
  for (const text of [markdown, page]) assert.doesNotMatch(text, /Security headers[^\n]{0,40}\b0 \/ 100/);
});

test('a stored count that is not a count is ignored by the report and refused by the store', async (t) => {
  const report = buildReport(runWith(/** @type {any} */ ({ passed: 4, of: 3 })));
  assert.equal(report.scores.find((score) => score.module === 'security_headers')?.counted, null);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seekwide-count-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  // Refused when saved, so that no saved run is one the store will not read back.
  await assert.rejects(saveRun(dir, runWith(/** @type {any} */ ({ passed: '1', of: 3 }), { run_id: 'r1' })), /modules\.security_headers\.count/);
  await assert.rejects(loadRun(dir, 'r1'), { code: 'RUN_NOT_FOUND' });
});

test('the run index and the comparison of two runs carry the counts', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seekwide-count-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const before = runWith({ passed: 0, of: 3 }, { run_id: 'r1', created_at: '2026-11-11T10:00:00.000Z' });
  const after = runWith({ passed: 2, of: 3 }, { run_id: 'r2', created_at: '2026-11-11T11:00:00.000Z' });
  await saveRun(dir, before);
  await saveRun(dir, after);
  const [first] = await listRuns(dir);
  assert.deepEqual([first.scores.security_headers, first.counts], [null, { security_headers: { passed: 0, of: 3 } }]);

  const comparison = compareRuns(before, after);
  assert.deepEqual(comparison.scores.security_headers, { from: null, to: null, from_count: { passed: 0, of: 3 }, to_count: { passed: 2, of: 3 }, delta: 2 });
  assert.deepEqual(comparison.scores.seo, { from: 78, to: 78, delta: 0 });
  const markdown = renderMarkdown(after, { comparison });
  assert.match(markdown, /\| Security headers \| 0 of 3 recommended headers set \| 2 of 3 recommended headers set \| \+2 \|/);
  // A run stored before the headers were counted has a score instead: shown as it is, with no change computed.
  const old = makeRun({ run_id: 'r0', modules: { ...makeRun().modules, security_headers: { score: 33, coverage: 1, checks_total: 5, checks_run: 5, checks_skipped: 0, note: null } } });
  assert.deepEqual(compareRuns(old, after).scores.security_headers, { from: 33, to: null, from_count: null, to_count: { passed: 2, of: 3 }, delta: null });
});
