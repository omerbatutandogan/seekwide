import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareRuns } from '../../plugin/server/src/store/compare.js';
import { makeCheckStat, makeFinding, makeRun } from '../helpers/run-factory.js';

const a = makeFinding({ url: 'https://example.test/a' });
const b = makeFinding({ url: 'https://example.test/b' });
const c = makeFinding({ url: 'https://example.test/c' });
const d = makeFinding({ check_id: 'seo.h1.missing', title: 'H1 missing', selector: 'h1', url: 'https://example.test/a' });

/** @param {string} id @param {object} [extra] */
const run = (id, extra = {}) => makeRun({ run_id: id, findings: [], ...extra });

test('findings are matched by id: resolved, added and persisting', () => {
  const base = run('base', { findings: [a, b, c] });
  const current = run('current', { findings: [b, c, d] });
  const result = compareRuns(base, current);
  assert.equal(result.base_run_id, 'base');
  assert.equal(result.run_id, 'current');
  assert.deepEqual(result.resolved, [a]);
  assert.deepEqual(result.added, [d]);
  assert.equal(result.persisting, 2);
});

test('the same finding on the same URL is persisting even when its evidence changed', () => {
  const changed = { ...b, evidence: { observed: 'something else' } };
  const result = compareRuns(run('base', { findings: [b] }), run('current', { findings: [changed] }));
  assert.deepEqual(result.resolved, []);
  assert.deepEqual(result.added, []);
  assert.equal(result.persisting, 1);
});

test('two runs with no findings compare cleanly', () => {
  const result = compareRuns(run('base'), run('current'));
  assert.deepEqual({ ...result, scores: undefined }, {
    base_run_id: 'base', run_id: 'current', resolved: [], added: [], persisting: 0, scores: undefined, notes: [],
  });
});

test('scores give from, to and delta for every module in either run', () => {
  const base = run('base');
  const current = run('current');
  current.modules = {
    seo: { ...base.modules.seo, score: 85 },
    links: { ...base.modules.links, score: 80 },
    extra: { score: 50, coverage: 1, checks_total: 1, checks_run: 1, checks_skipped: 0 },
  };
  delete base.modules.links;
  base.modules.gone = { score: 90, coverage: 1, checks_total: 1, checks_run: 1, checks_skipped: 0 };
  base.modules.nulled = { score: null, coverage: 0, checks_total: 1, checks_run: 0, checks_skipped: 1 };
  current.modules.nulled = { score: 70, coverage: 1, checks_total: 1, checks_run: 1, checks_skipped: 0 };

  assert.deepEqual(compareRuns(base, current).scores, {
    extra: { from: null, to: 50, delta: null },
    gone: { from: 90, to: null, delta: null },
    links: { from: null, to: 80, delta: null },
    nulled: { from: null, to: 70, delta: null },
    seo: { from: 78, to: 85, delta: 7 },
  });
});

test('a score that dropped has a negative delta', () => {
  const base = run('base');
  const current = run('current');
  current.modules.seo = { ...current.modules.seo, score: 60 };
  assert.deepEqual(compareRuns(base, current).scores.seo, { from: 78, to: 60, delta: -18 });
});

test('identical settings give no notes', () => {
  assert.deepEqual(compareRuns(run('base'), run('current')).notes, []);
});

test('notes: a different rules version', () => {
  const { notes } = compareRuns(run('base', { rules_version: '0.1.0' }), run('current', { rules_version: '0.2.0' }));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /rules version changed from 0\.1\.0 to 0\.2\.0/);
});

test('notes: a different start URL', () => {
  const { notes } = compareRuns(run('base'), run('current', { start_url: 'https://other.example/' }));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /different URLs \(https:\/\/example\.test\/ and https:\/\/other\.example\/\)/);
});

test('notes: a different page budget', () => {
  const { notes } = compareRuns(run('base'), run('current', { crawl: { max_pages: 100 } }));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /page budget changed from 25 to 100/);
});

test('notes: a truncated crawl on either side, named by side', () => {
  const truncatedBase = compareRuns(run('base', { crawl: { truncated: true } }), run('current')).notes;
  assert.equal(truncatedBase.length, 1);
  assert.match(truncatedBase[0], /^The base run's crawl stopped at its page limit/);

  const truncatedCurrent = compareRuns(run('base'), run('current', { crawl: { truncated: true } })).notes;
  assert.equal(truncatedCurrent.length, 1);
  assert.match(truncatedCurrent[0], /^The current run's crawl stopped at its page limit/);

  assert.equal(compareRuns(run('base', { crawl: { truncated: true } }), run('current', { crawl: { truncated: true } })).notes.length, 2);
});

test('notes: a blocked crawl on either side, with the reason', () => {
  const blocked = { reason: 'bot_challenge', url: 'https://example.test/', status: 403 };
  const baseBlocked = compareRuns(run('base', { crawl: { blocked } }), run('current')).notes;
  assert.equal(baseBlocked.length, 1);
  assert.match(baseBlocked[0], /^The base run's crawl was blocked \(bot_challenge\)/);
  const currentBlocked = compareRuns(run('base'), run('current', { crawl: { blocked } })).notes;
  assert.match(currentBlocked[0], /^The current run's crawl was blocked \(bot_challenge\)/);
});

test('notes: a crawl that was both blocked and truncated gets one note for that side', () => {
  const blocked = { reason: 'rate_limited', url: 'https://example.test/', status: 429 };
  const { notes } = compareRuns(run('base'), run('current', { crawl: { blocked, truncated: true } }));
  assert.equal(notes.length, 1);
  assert.match(notes[0], /was blocked \(rate_limited\) and stopped at its page limit/);
});

test('notes: checks that ran in only one of the two runs', () => {
  const base = run('base', { checks: [makeCheckStat({ id: 'seo.a' }), makeCheckStat({ id: 'links.b', module: 'links' })] });
  const current = run('current', {
    checks: [makeCheckStat({ id: 'seo.a' }), makeCheckStat({ id: 'links.b', module: 'links', status: 'skipped', skip_reason: 'x' }), makeCheckStat({ id: 'seo.c' })],
  });
  const { notes } = compareRuns(base, current);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /2 checks ran in only one of the two runs \(links\.b, seo\.c\)/);
});

test('notes: a long list of differing checks is shortened', () => {
  const many = Array.from({ length: 8 }, (_, i) => makeCheckStat({ id: `seo.check_${i}` }));
  const { notes } = compareRuns(run('base', { checks: [] }), run('current', { checks: many }));
  assert.match(notes[0], /8 checks ran in only one of the two runs \(seo\.check_0, seo\.check_1, seo\.check_2, seo\.check_3, seo\.check_4, \.\.\.\)/);
});

test('notes come in a fixed order: rules, URL, budget, base crawl, current crawl, checks', () => {
  const base = run('base', { rules_version: '0.1.0', crawl: { truncated: true }, checks: [makeCheckStat({ id: 'seo.only_base' })] });
  const current = run('current', {
    rules_version: '0.2.0',
    start_url: 'https://other.example/',
    crawl: { max_pages: 5, blocked: { reason: 'robots_disallow', url: 'https://other.example/', status: 200 } },
    checks: [],
  });
  const { notes } = compareRuns(base, current);
  assert.equal(notes.length, 6);
  assert.match(notes[0], /rules version/);
  assert.match(notes[1], /different URLs/);
  assert.match(notes[2], /page budget/);
  assert.match(notes[3], /base run/);
  assert.match(notes[4], /current run/);
  assert.match(notes[5], /ran in only one/);
});

test('compareRuns does not change either run and gives the same answer twice', () => {
  const base = run('base', { findings: [a, b] });
  const current = run('current', { findings: [b, c] });
  const copies = [structuredClone(base), structuredClone(current)];
  const first = compareRuns(base, current);
  assert.deepEqual([base, current], copies);
  assert.deepEqual(compareRuns(base, current), first);
});

test('comparing a run with itself finds nothing resolved or added', () => {
  const same = run('same', { findings: [a, b, c] });
  const result = compareRuns(same, same);
  assert.deepEqual([result.resolved, result.added, result.persisting], [[], [], 3]);
  assert.deepEqual(result.notes, []);
});

test('notes: a lab finding that appeared or went away is flagged, because lab values vary between audits', () => {
  const lab = makeFinding({ check_id: 'seo.cwv.lab_lcp', title: 'Largest Contentful Paint is slow in a lab test', url: 'https://example.test/', selector: null });
  const field = makeFinding({ check_id: 'seo.cwv.field_lcp', title: 'Largest Contentful Paint is slow for real users', url: null, selector: 'origin' });
  const caveat = /^A Core Web Vitals lab finding appeared or went away\. Lab values come from one simulated page load per audit/;

  const gone = compareRuns(run('base', { findings: [lab, a] }), run('current', { findings: [a] }));
  assert.equal(gone.notes.length, 1);
  assert.match(gone.notes[0], caveat);
  assert.match(gone.notes[0], /The real-user \(field\) values are steadier, but they also follow a 28-day window that moves every day\.$/);
  assert.match(compareRuns(run('base'), run('current', { findings: [lab] })).notes[0], caveat);

  assert.deepEqual(compareRuns(run('base', { findings: [lab] }), run('current', { findings: [lab] })).notes, [], 'a lab finding in both runs needs no caveat');
  assert.deepEqual(compareRuns(run('base', { findings: [field] }), run('current')).notes, [], 'field values are comparable');
});
