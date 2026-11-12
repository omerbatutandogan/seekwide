// The report counts what the owner fixes (validation of 2026-11-12, fix 6).
// Modeled on a blog whose menu links three redirecting addresses on every
// page: 66 redirect findings are three links to change.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderMarkdown } from '../../server/src/report/markdown.js';
import { buildReport } from '../../server/src/report/model.js';
import { topGroups } from '../../server/src/tools/audit-summary.js';
import { makeFinding, makeRun } from '../helpers/run-factory.js';

const targets = ['/about', '/account', '/almanac'];
const redirects = Array.from({ length: 22 }, (_, page) => targets.map((path) => makeFinding({
  check_id: 'links.internal.redirect', module: 'links', title: 'Internal link goes through a redirect', severity: 'low',
  url: `https://example.test/post-${String(page).padStart(2, '0')}/`, selector: `a[href="${path}"]`,
  evidence: { observed: { target_url: `https://example.test${path}`, status: 301 }, expected: 'A link to the final URL' },
}))).flat();

test('a links group says how many links on how many pages, and shows one finding per link first', () => {
  const report = buildReport(makeRun({ findings: redirects }), { maxUrlsPerCheck: 5 });
  const group = report.groups.find((entry) => entry.checkId === 'links.internal.redirect');
  assert.deepEqual(group?.distinct, { links: 3, pages: 22 });
  assert.deepEqual(group?.shown.slice(0, 3).map((finding) => finding.target), targets.map((path) => `https://example.test${path}`));
  assert.match(renderMarkdown(makeRun({ findings: redirects })), /\*\*Affected:\*\* 66 findings \(3 links on 22 pages\)/);
  assert.deepEqual(topGroups(redirects, 3)[0], { ...topGroups(redirects, 3)[0], count: 66, distinct_links: 3, pages: 22 });
});

test('groups of other modules, and links groups without repetition, keep the plain count', () => {
  const titles = Array.from({ length: 4 }, (_, i) => makeFinding({ url: `https://example.test/p${i}` }));
  const markdown = renderMarkdown(makeRun({ findings: titles }));
  assert.match(markdown, /\*\*Affected:\*\* 4 findings · /);
  assert.equal(topGroups(titles, 1)[0].distinct_links, undefined);
  const once = redirects.slice(0, 3);
  assert.match(renderMarkdown(makeRun({ findings: once })), /\*\*Affected:\*\* 3 findings · /);
});

test('a group with likely and confirmed findings says how many are likely (review of 2026-11-12)', () => {
  const mixed = redirects.slice(0, 10).map((finding, i) => ({ ...finding, confidence: /** @type {'confirmed'|'likely'} */ (i === 0 ? 'likely' : 'confirmed') }));
  const markdown = renderMarkdown(makeRun({ findings: mixed }));
  assert.match(markdown, /\*\*Confidence:\*\* Likely for 1 of 10 findings, confirmed for the rest/);
  assert.deepEqual([topGroups(mixed, 1)[0].confidence, topGroups(mixed, 1)[0].likely_findings], ['likely', 1]);
  const reversed = mixed.map((finding) => ({ ...finding, confidence: /** @type {'confirmed'|'likely'} */ (finding.confidence === 'likely' ? 'confirmed' : 'likely') }));
  assert.match(renderMarkdown(makeRun({ findings: reversed })), /\*\*Confidence:\*\* Likely for 9 of 10 findings, confirmed for the rest/);
});
