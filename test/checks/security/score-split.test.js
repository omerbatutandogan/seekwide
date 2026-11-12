// The signs of a hack and the security headers are scored apart (validation of
// 2026-11-12, confusion item 7). Clean sites with three low-severity headers
// missing scored 79 to 83 for security, which a reader takes for a security
// problem with the site.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateCheckDef } from '../../../server/src/checks/validate.js';
import { checks } from '../../../server/src/checks/security/index.js';
import { buildReport } from '../../../server/src/report/model.js';
import { makePage, makeSecurity, makeSecurityHeaders } from '../../helpers/factories.js';
import { makeRun } from '../../helpers/run-factory.js';
import { audit } from './support.js';

const bare = makeSecurityHeaders({ hsts_max_age: null, nosniff: false, frame_ancestors: [], x_frame_options: [], csp: null });

test('a clean site with missing headers keeps a security score of 100, and its headers get a count of their own', () => {
  const result = audit([makePage({ security: makeSecurity({ headers: bare }) }), makePage({ url: 'https://example.test/b', security: makeSecurity({ headers: bare }) })]);
  assert.equal(result.modules.security.score, 100);
  assert.equal(result.modules.security.checks_total, 5);
  assert.equal(result.modules.security_headers.checks_total, 5);
  assert.equal(result.modules.security_headers.score, null, 'the headers are counted, not scored');
  assert.deepEqual(result.modules.security_headers.count, { passed: 0, of: 3 }, 'three scored header checks fail, the info ones do not count');
  assert.deepEqual(new Set(result.findings.map((finding) => finding.module)), new Set(['security']), 'header findings stay in the security module');
});

test('a sign of a hack lowers the security score whatever the headers', () => {
  const hidden = makeSecurity({
    hidden_links: [{ index: 0, url: 'https://spam.test/', host: 'spam.test', text: 'pills', how: 'display:none', element: 'div[style="display:none"]', element_line: 3, line: 4, count: 1 }],
  });
  const result = audit([makePage({ security: hidden })]);
  assert.ok((result.modules.security.score ?? 100) < 100);
  assert.deepEqual(result.modules.security_headers.count, { passed: 3, of: 3 });
});

test('only the header checks count toward the headers score, and a check cannot name a score outside its module', () => {
  const grouped = checks.filter((check) => check.score_group === 'security_headers').map((check) => check.id).sort();
  assert.deepEqual(grouped, checks.filter((check) => check.id.startsWith('security.headers.')).map((check) => check.id).sort());
  assert.throws(() => validateCheckDef({ ...checks[0], id: 'seo.x.y', module: 'seo', score_group: 'security_headers' }), /score_group/);
});

test('a run stored before the headers were counted still shows its two scores on two lines', () => {
  const run = makeRun({ modules: { ...makeRun().modules, security: { score: 100, coverage: 1, checks_total: 5, checks_run: 5, checks_skipped: 0, note: null }, security_headers: { score: 79, coverage: 1, checks_total: 5, checks_run: 5, checks_skipped: 0, note: null } } });
  const report = buildReport(run);
  assert.deepEqual(report.scores.slice(-2).map((score) => [score.label, score.score]), [['Security', 100], ['Security headers', 79]]);
  assert.match(report.summary.paragraphs.join(' '), /Security 100; Security headers 79/);
  assert.match(report.method.map((section) => section.text).join(' '), /Security, a score for signs that the site was hacked, and Security headers, a count of the recommended response headers/);
});
