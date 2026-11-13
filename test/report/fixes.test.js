// The "Fixes verified in this run" section of both reports, and the scope row
// for a local audit that knows the deployed address.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { buildReport } from '../../plugin/server/src/report/model.js';
import { makeRun } from '../helpers/run-factory.js';
import { PAYLOADS, assertSafeHtml, assertSafeMarkdown } from './safety.js';

/** @param {string} outcome @param {object} [overrides] */
const result = (outcome, overrides = {}) => ({
  finding_id: `id-${outcome}`, check_id: 'seo.title.missing', title: 'Page has no title', severity: 'high', url: `https://example.test/${outcome}`,
  file: 'app/about/page.tsx', outcome, detail: `Detail for ${outcome}.`, replaced_by: [], ...overrides,
});

const FIXES = {
  base_run_id: '2026-11-11T10-00-00Z',
  counts: { closed: 99, open: 99, replaced: 99, unverified: 99 },
  results: [
    result('open'),
    result('unverified', { url: null, file: null }),
    result('replaced', { replaced_by: [{ id: 'n1', check_id: 'seo.title.too_short', title: 'Title is very short', severity: 'info' }] }),
    result('closed'),
  ],
  notes: ['The rules version changed.'],
};

const run = makeRun({ fixes: /** @type {any} */ (FIXES) });

describe('fix verification in the reports', () => {
  it('counts the outcomes from the rows, not from the stored counts, and lists closed first', () => {
    const view = buildReport(run).fixes;
    assert.equal(view?.summary, '4 fixed findings were checked again: 1 closed, 1 replaced by another finding, 1 still open, 1 not verified.');
    assert.deepEqual(view?.rows.map((row) => row.outcome), ['closed', 'replaced', 'open', 'unverified']);
    assert.equal(view?.baseRunId, '2026-11-11T10-00-00Z');
  });

  it('Markdown: a section after the scope with one row per fixed finding', () => {
    const out = renderMarkdown(run);
    assert.ok(out.indexOf('## Scope and limits') < out.indexOf('## Fixes verified in this run'));
    assert.ok(out.indexOf('## Fixes verified in this run') < out.indexOf('## Status by layer'));
    assert.match(out, /Compared with run `2026-11-11T10-00-00Z`\./);
    assert.match(out, /\| \*\*Closed\*\* \| Page has no title \(`seo\.title\.missing`\) \| <https:\/\/example\.test\/closed> \| `app\/about\/page\.tsx` \| Detail for closed\. \|/);
    assert.match(out, /\| \*\*Replaced\*\* \|.*Detail for replaced\. Now reported: Title is very short \(seo\.title\.too\\_short\)\. \|/);
    assert.match(out, /\| \*\*Not verified\*\* \| Page has no title \(`seo\.title\.missing`\) \| Whole site \| — \| Detail for unverified\. \|/);
    assert.match(out, /\| \*\*Still open\*\* \|/);
    assert.match(out, /\*\*Caveats\*\*\n\n- The rules version changed\./);
  });

  it('HTML: the same section, safe', () => {
    const out = renderHtml(run);
    assert.match(out, /<section id="fixes"><h2>Fixes verified in this run<\/h2>/);
    assert.match(out, /<td><strong>Closed<\/strong><\/td><td>Page has no title \(<code>seo\.title\.missing<\/code>\)<\/td>/);
    assert.match(out, /<td><strong>Not verified<\/strong><\/td>.*<td>Whole site<\/td><td>—<\/td>/);
    assert.match(out, /Now reported: Title is very short \(seo\.title\.too_short\)\./);
    assertSafeHtml(out);
  });

  it('a single fixed finding reads in the singular', () => {
    const one = makeRun({ fixes: /** @type {any} */ ({ ...FIXES, results: [result('closed')], notes: [] }) });
    assert.equal(buildReport(one).fixes?.summary, '1 fixed finding was checked again: 1 closed.');
    assert.doesNotMatch(renderMarkdown(one), /Caveats/);
  });

  it('is absent from a run that verified nothing, whatever the stored value looks like', () => {
    for (const fixes of [undefined, null, 'x', [], {}, { results: [] }, { results: 'many' }]) {
      const plain = makeRun({ fixes: /** @type {any} */ (fixes) });
      assert.equal(buildReport(plain).fixes, null);
      assert.doesNotMatch(renderMarkdown(plain), /Fixes verified/);
      assert.doesNotMatch(renderHtml(plain), /id="fixes"/);
    }
  });

  it('takes nothing in the stored value on trust', () => {
    const odd = makeRun({ fixes: /** @type {any} */ ({ base_run_id: 7, results: [{ outcome: 'fixed!', check_id: null, title: {}, url: 5, file: [], detail: null, replaced_by: 'x' }, null], notes: [3, 'kept'] }) });
    const view = buildReport(odd).fixes;
    // Entries that are not results (null, a number, an object without a check) are not rows.
    assert.equal(view, null);
    const half = makeRun({ fixes: /** @type {any} */ ({ base_run_id: 7, results: [{ outcome: 'fixed!', check_id: 'seo.x', title: {}, url: 5, file: [], detail: null, replaced_by: 'x' }, null, 5, 'x', {}], notes: [3, 'kept'] }) });
    const view2 = buildReport(half).fixes;
    assert.deepEqual(view2?.rows, [{ outcome: 'unverified', checkId: 'seo.x', title: 'seo.x', url: null, file: null, detail: 'No detail recorded.', replacedBy: [] }]);
    assert.equal(view2?.summary, '1 fixed finding was checked again: 0 closed, 1 not verified.');
    assert.deepEqual([view2?.baseRunId, view2?.notes], ['unknown', ['kept']]);
    assert.doesNotThrow(() => renderMarkdown(odd));
    assert.doesNotThrow(() => renderMarkdown(half));
    assertSafeHtml(renderHtml(half));
  });

  it('shows at most 100 rows and says how many are left out', () => {
    const many = makeRun({ fixes: /** @type {any} */ ({ ...FIXES, results: Array.from({ length: 130 }, () => result('closed')) }) });
    assert.deepEqual([buildReport(many).fixes?.rows.length, buildReport(many).fixes?.more], [100, 30]);
    assert.match(renderMarkdown(many), /\+30 more not shown\./);
    assert.match(renderHtml(many), /<p>\+30 more not shown\.<\/p>/);
  });

  for (const payload of PAYLOADS) {
    it(`escapes hostile text in every field: ${JSON.stringify(payload).slice(0, 30)}`, () => {
      const hostile = makeRun({ fixes: /** @type {any} */ ({
        base_run_id: payload, notes: [payload],
        results: [{ finding_id: payload, check_id: payload, title: payload, url: payload, file: payload, outcome: 'closed', detail: payload, replaced_by: [{ id: payload, check_id: payload, title: payload, severity: payload }] }],
      }) });
      assertSafeHtml(renderHtml(hostile));
      const md = renderMarkdown(hostile);
      const section = md.slice(md.indexOf('## Fixes verified'), md.indexOf('## Status by layer'));
      // One header row, one separator, one data row: a payload cannot add a row or a heading.
      assert.equal(section.split('\n').filter((line) => line.startsWith('|')).length, 3);
      assert.equal(section.split('\n').filter((line) => line.startsWith('#')).length, 1);
      assertSafeMarkdown(md);
    });
  }
});

describe('the scope row of a local audit that knows the deployed address', () => {
  const repo = { framework: 'next-app', label: 'Next.js (App Router)', source_dir: '.', findings_with_source: 0, pages_matched: 1, pages_total: 1 };

  it('says that nothing was read as a local page when the address matched nothing', () => {
    for (const extra of [{ deployed_localized: 0 }, {}, { deployed_localized: 'many' }]) {
      const missed = makeRun({ repo: /** @type {any} */ ({ ...repo, deployed_origin: 'http://www.example.com', ...extra }) });
      for (const out of [renderMarkdown(missed), renderHtml(missed)]) {
        assert.match(out, /The deployed address given for this audit \(http:\/\/www\.example\.com\) matched no canonical link, link or sitemap entry of the pages/);
        assert.doesNotMatch(out, /were read as pages of the local server/);
      }
    }
  });

  it('says that links to the deployed address were read as local pages', () => {
    const told = makeRun({ repo: /** @type {any} */ ({ ...repo, deployed_origin: 'https://www.example.com', deployed_localized: 3 }) });
    assert.match(renderMarkdown(told), /that name the deployed address \(https:\/\/www\.example\.com\) were read as pages of the local server\./);
    assert.match(renderHtml(told), /that name the deployed address \(https:\/\/www\.example\.com\) were read as pages of the local server\./);
  });

  it('says nothing about it otherwise', () => {
    assert.doesNotMatch(renderMarkdown(makeRun({ repo: /** @type {any} */ (repo) })), /deployed address/);
  });
});
