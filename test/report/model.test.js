import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildReport } from '../../server/src/report/model.js';
import { compareRuns } from '../../server/src/store/compare.js';
import { SITE, makeField, makeLab, makeVitals } from '../helpers/factories.js';
import { makeCheckStat, makeFinding, makeRun } from '../helpers/run-factory.js';

/** @param {string} id @param {object} [extra] */
const check = (id, extra = {}) => ({ check_id: id, title: id, ...extra });

test('groups are ordered by severity, then impact (high first), then effort (low first), then check id', () => {
  const findings = [
    makeFinding(check('z.low', { severity: 'low', impact: 3, effort: 1 })),
    makeFinding(check('c.high.e2', { severity: 'high', impact: 2, effort: 2 })),
    makeFinding(check('b.high.e1', { severity: 'high', impact: 2, effort: 1 })),
    makeFinding(check('a.high.i3', { severity: 'high', impact: 3, effort: 3 })),
    makeFinding(check('a.crit', { severity: 'critical', impact: 1, effort: 3 })),
    makeFinding(check('a.high.e1.second', { severity: 'high', impact: 2, effort: 1 })),
    makeFinding(check('y.info', { severity: 'info', impact: 3, effort: 1 })),
    makeFinding(check('m.medium', { severity: 'medium', impact: 1, effort: 1 })),
  ];
  const { groups } = buildReport(makeRun({ findings }));
  assert.deepEqual(groups.map((g) => g.checkId), ['a.crit', 'a.high.i3', 'a.high.e1.second', 'b.high.e1', 'c.high.e2', 'm.medium', 'z.low', 'y.info']);
});

test('the order does not depend on the order of the findings in the file', () => {
  const findings = [
    makeFinding(check('b', { severity: 'low', url: 'https://example.test/2' })),
    makeFinding(check('a', { severity: 'low', url: 'https://example.test/9' })),
    makeFinding(check('b', { severity: 'low', url: 'https://example.test/1' })),
  ];
  const forward = buildReport(makeRun({ findings }));
  const reversed = buildReport(makeRun({ findings: [...findings].reverse() }));
  assert.deepEqual(forward.groups.map((g) => [g.checkId, g.findings.map((f) => f.url)]), reversed.groups.map((g) => [g.checkId, g.findings.map((f) => f.url)]));
  assert.deepEqual(forward.groups[1].findings.map((f) => f.url), ['https://example.test/1', 'https://example.test/2']);
});

test('top fixes are the first ten groups; all findings keep every group', () => {
  const findings = Array.from({ length: 12 }, (_, i) => makeFinding(check(`seo.check_${String(i).padStart(2, '0')}`, { severity: 'medium' })));
  const report = buildReport(makeRun({ findings }));
  assert.equal(report.topFixes.length, 10);
  assert.equal(report.groups.length, 12);
  assert.deepEqual(report.topFixes.map((g) => g.checkId), report.groups.slice(0, 10).map((g) => g.checkId));
});

test('a group has its count, confidence, recommendation, documentation link and at most three distinct example URLs', () => {
  const findings = [1, 2, 3, 4, 5].map((n) => makeFinding({ url: `https://example.test/p${n}` }));
  findings.push(makeFinding({ url: 'https://example.test/p1', selector: 'title' }));
  const [group] = buildReport(makeRun({ findings })).topFixes;
  assert.equal(group.count, 6);
  assert.equal(group.confidence, 'confirmed');
  assert.match(group.recommendation, /Add a unique/);
  assert.match(group.docRef, /^https:\/\/developers\.google\.com/);
  assert.deepEqual(group.examples, ['https://example.test/p1', 'https://example.test/p2', 'https://example.test/p3']);
});

test('site-level findings have no example URLs', () => {
  const [group] = buildReport(makeRun({ findings: [makeFinding({ url: null, selector: null })] })).topFixes;
  assert.deepEqual(group.examples, []);
});

test('each group shows up to maxUrlsPerCheck findings (default 10) and counts the rest', () => {
  const findings = Array.from({ length: 25 }, (_, i) => makeFinding({ url: `https://example.test/p${String(i).padStart(2, '0')}` }));
  const run = makeRun({ findings });
  const byDefault = buildReport(run).groups[0];
  assert.equal(byDefault.shown.length, 10);
  assert.equal(byDefault.more, 15);
  assert.equal(buildReport(run, { maxUrlsPerCheck: 3 }).groups[0].more, 22);
  assert.equal(buildReport(run, { maxUrlsPerCheck: 25 }).groups[0].more, 0);
  assert.equal(buildReport(run, { maxUrlsPerCheck: 100 }).groups[0].shown.length, 25);
});

test('evidence is flattened to short strings: objects become JSON, long text is clipped', () => {
  const finding = makeFinding({ evidence: { observed: { characters: 91, nested: [1, 2] }, expected: 'x'.repeat(1000), detail: 'why' } });
  const [group] = buildReport(makeRun({ findings: [finding] })).groups;
  const [observed, expected, detail] = group.shown[0].evidence;
  assert.deepEqual(observed, { label: 'Observed', kind: 'code', value: '{"characters":91,"nested":[1,2]}' });
  assert.equal(expected.value.length, 300);
  assert.ok(expected.value.endsWith('…'));
  assert.deepEqual(detail, { label: 'Detail', kind: 'text', value: 'why' });
  assert.deepEqual(buildReport(makeRun({ findings: [makeFinding({ evidence: {} })] })).groups[0].shown[0].evidence, []);
});

test('numbers and unknown enums from a hand-edited file cannot leak into the output as-is', () => {
  const run = makeRun({ findings: [makeFinding({ severity: /** @type {any} */ ('x" onclick="y'), confidence: /** @type {any} */ ('sure') })] });
  run.modules.seo.score = /** @type {any} */ ('50%;background:url(//evil)');
  run.modules.links.score = 250;
  run.modules.links.coverage = /** @type {any} */ ('lots');
  const report = buildReport(run);
  assert.equal(report.groups[0].severity, 'info');
  assert.equal(report.groups[0].confidence, 'likely', 'an unknown confidence is never reported as confirmed');
  assert.deepEqual(report.scores.map((s) => [s.module, s.score, s.coverage]), [['seo', null, 0.94], ['links', 100, 0]]);
});

test('modules are listed in plugin order (seo, links), then others alphabetically', () => {
  const run = makeRun();
  run.modules.zeta = { score: 1, coverage: 1, checks_total: 1, checks_run: 1, checks_skipped: 0 };
  run.modules.alpha = { score: 1, coverage: 1, checks_total: 1, checks_run: 1, checks_skipped: 0 };
  assert.deepEqual(buildReport(run).scores.map((s) => s.module), ['seo', 'links', 'alpha', 'zeta']);
});

test('checks that did not run are listed with a reason, sorted by id', () => {
  const run = makeRun({
    checks: [
      makeCheckStat({ id: 'seo.b', status: 'skipped', skip_reason: 'Needs a sitemap.' }),
      makeCheckStat({ id: 'seo.a', status: 'error', skip_reason: 'Check failed to run: boom' }),
      makeCheckStat({ id: 'seo.c', status: 'skipped', skip_reason: null }),
      makeCheckStat({ id: 'seo.d' }),
    ],
  });
  assert.deepEqual(buildReport(run).notRun, [
    { id: 'seo.a', status: 'error', reason: 'Check failed to run: boom' },
    { id: 'seo.b', status: 'skipped', reason: 'Needs a sitemap.' },
    { id: 'seo.c', status: 'skipped', reason: 'No reason recorded.' },
  ]);
});

test('dates come from run.created_at, in UTC', () => {
  assert.deepEqual(buildReport(makeRun({ created_at: '2024-03-05T23:30:00-02:00' })).date, { long: '6 March 2024', iso: '2024-03-06' });
  assert.deepEqual(buildReport(makeRun({ created_at: 'garbage' })).date, { long: 'garbage', iso: 'garbage' });
});

test('the factual summary is built from the numbers and states partial coverage', () => {
  const clean = buildReport(makeRun()).summary;
  assert.equal(clean.written, false);
  assert.match(clean.paragraphs[0], /crawled 25 pages of example\.test \(23 HTML, 21 indexable\) and ran 3 of 5 checks\./);
  assert.match(clean.paragraphs[1], /recorded 10 findings across 7 checks: 1 critical, 5 high, 1 medium, 2 low, 1 info\./);
  assert.match(clean.paragraphs[2], /Scores .*: SEO 78; Links 88\./);

  const partial = buildReport(makeRun({ crawl: { truncated: true, blocked: { reason: 'bot_challenge', url: 'https://example.test/', status: 403 } } })).summary.paragraphs.join('\n');
  assert.match(partial, /stopped early: the site answered with a bot challenge/);
  assert.match(partial, /stopped at its limit of 25 pages/);

  const none = buildReport(makeRun({ findings: [], crawl: { pages_crawled: 0 } })).summary.paragraphs.join('\n');
  assert.match(none, /could not crawl any page of example\.test/);
  assert.match(none, /found no problems in the checks that ran/);
});

test('a written summary replaces the factual one and is split into paragraphs', () => {
  const { summary } = buildReport(makeRun(), { executiveSummary: '  First paragraph\nstill first.\n\n\nSecond one.  ' });
  assert.deepEqual(summary, { written: true, paragraphs: ['First paragraph still first.', 'Second one.'] });
  assert.equal(buildReport(makeRun(), { executiveSummary: '   ' }).summary.written, false);
});

test('options that cannot be rendered faithfully throw TypeError', () => {
  const run = makeRun();
  const bad = [
    { maxUrlsPerCheck: 0 }, { maxUrlsPerCheck: 1.5 }, { maxUrlsPerCheck: '10' },
    { executiveSummary: 42 },
    { brandName: 42 },
    { recommendations: 'x' }, { recommendations: [{ title: 'only title' }] }, { recommendations: [{ title: ' ', detail: 'd' }] }, { recommendations: [null] },
    { logoDataUri: 'https://evil.test/logo.png' }, { logoDataUri: 'javascript:alert(1)' }, { logoDataUri: 'data:text/html;base64,PHNjcmlwdD4=' },
    { logoDataUri: 'data:image/png;base64,AA" onerror="x' }, { logoDataUri: 42 },
    { comparison: { run_id: 'someone-else' } },
  ];
  for (const options of bad) assert.throws(() => buildReport(run, /** @type {any} */ (options)), TypeError, JSON.stringify(options));
  for (const run2 of [null, {}, { findings: [] }, 'x']) assert.throws(() => buildReport(/** @type {any} */ (run2)), TypeError);
  for (const options of [null, 'x', [], 5]) assert.throws(() => buildReport(run, /** @type {any} */ (options)), TypeError);
});

test('valid logos are accepted: png, jpeg, webp and svg data URIs', () => {
  for (const type of ['png', 'jpeg', 'webp', 'svg+xml']) {
    assert.equal(buildReport(makeRun(), { logoDataUri: `data:image/${type};base64,iVBORw0KGgo=` }).logo, `data:image/${type};base64,iVBORw0KGgo=`);
  }
  assert.equal(buildReport(makeRun()).logo, undefined);
});

test('the brand name is one line of at most 200 characters', () => {
  assert.equal(buildReport(makeRun(), { brandName: '  Acme \n Agency  ' }).brand, 'Acme Agency');
  assert.equal(buildReport(makeRun(), { brandName: 'x'.repeat(500) }).brand.length, 200);
  assert.equal(buildReport(makeRun()).brand, '');
});

test('a comparison is summarized by check, with at most ten checks per list', () => {
  const resolved = Array.from({ length: 12 }, (_, i) => makeFinding(check(`seo.r${String(i).padStart(2, '0')}`, { severity: 'low' })));
  const base = makeRun({ run_id: 'base', findings: resolved, rules_version: '0.0.1' });
  const current = makeRun({ run_id: 'current', findings: [makeFinding(check('seo.new', { severity: 'high' }))] });
  const { comparison } = buildReport(current, { comparison: compareRuns(base, current) });
  assert.equal(comparison?.baseRunId, 'base');
  assert.equal(comparison?.resolved.total, 12);
  assert.equal(comparison?.resolved.items.length, 10);
  assert.equal(comparison?.resolved.more, 2);
  assert.deepEqual(comparison?.added.items.map((i) => [i.checkId, i.count]), [['seo.new', 1]]);
  assert.equal(comparison?.notes.length, 1);
  assert.equal(buildReport(current).comparison, null);
});

test('a null score carries its note; a score that exists never shows one', () => {
  const run = makeRun();
  run.modules.links = { ...run.modules.links, score: null, note: "None of this module's checks could run." };
  run.modules.seo = { ...run.modules.seo, note: 'left over from an earlier edit' };
  const [seo, links] = buildReport(run).scores;
  assert.equal(seo.note, null);
  assert.equal(links.score, null);
  assert.equal(links.note, "None of this module's checks could run.");
});

test('runs stored before the note existed have no note', () => {
  const run = makeRun();
  run.modules.links = { score: null, coverage: 0, checks_total: 1, checks_run: 0, checks_skipped: 1 };
  delete run.modules.seo.note;
  const [seo, links] = buildReport(run).scores;
  assert.deepEqual([seo.score, seo.note, links.score, links.note], [78, null, null, null]);
});

test('a note is one line of text, and a note that is not a string is ignored', () => {
  const run = makeRun();
  run.modules.seo = { ...run.modules.seo, score: null, note: 'No score:\n  nothing to look at.' };
  run.modules.links = { ...run.modules.links, score: null, note: /** @type {any} */ ({ evil: true }) };
  const [seo, links] = buildReport(run).scores;
  assert.equal(seo.note, 'No score: nothing to look at.');
  assert.equal(links.note, null);
});

test('scope names the pages that could not be read only when there are some', () => {
  const row = (run) => buildReport(run).scope.find((r) => r.label === 'Pages not read');
  assert.equal(row(makeRun()), undefined);
  assert.equal(row(makeRun({ crawl: { unreadable_pages: 0 } })), undefined);
  const crawl = makeRun().crawl;
  delete crawl.unreadable_pages;
  assert.equal(row(makeRun({ crawl })), undefined, 'a run stored before this was counted has none');

  const one = row(makeRun({ crawl: { unreadable_pages: 1 } }))?.value ?? '';
  assert.match(one, /^1 page could not be read\. The crawler was refused there \(a firewall or bot challenge, a rate limit, or a robots\.txt rule reached through a redirect\), so it was left out of the checks and this audit is incomplete\.$/);
  const many = row(makeRun({ crawl: { unreadable_pages: 7 } }))?.value ?? '';
  assert.match(many, /^7 pages could not be read\..* so they were left out of the checks/);
});

test('the pages-not-read row sits right after the blocked row', () => {
  const labels = buildReport(makeRun({ crawl: { unreadable_pages: 2 } })).scope.map((r) => r.label);
  assert.deepEqual(labels, ['Pages crawled', 'Page limit reached', 'Blocked', 'Pages not read', 'robots.txt', 'Sitemap', 'Modules', 'User agent']);
});

test('an unreadable-page count that is not a count is treated as zero', () => {
  for (const bad of [-3, Number.NaN, '5', null, { n: 5 }, Infinity]) {
    const run = makeRun({ crawl: { unreadable_pages: /** @type {any} */ (bad) } });
    assert.equal(buildReport(run).scope.find((r) => r.label === 'Pages not read'), undefined, String(bad));
  }
  assert.match(buildReport(makeRun({ crawl: { unreadable_pages: 2.9 } })).scope.find((r) => r.label === 'Pages not read')?.value ?? '', /^2 pages could not be read/);
});

test('the factual summary says the audit is incomplete when pages could not be read', () => {
  const paragraphs = (run) => buildReport(run).summary.paragraphs;
  assert.ok(!paragraphs(makeRun()).some((p) => p.includes('could not be read')));
  const withPages = paragraphs(makeRun({ crawl: { unreadable_pages: 4 } }));
  assert.ok(withPages.some((p) => p.startsWith('4 pages could not be read.') && p.endsWith('this audit is incomplete.')));
  const written = buildReport(makeRun({ crawl: { unreadable_pages: 4 } }), { executiveSummary: 'My words.' });
  assert.deepEqual(written.summary.paragraphs, ['My words.']);
  assert.ok(written.scope.some((r) => r.label === 'Pages not read'), 'the scope still says it');
});

/** A measurement with a slow site-wide LCP, a slow start page in the lab, and a blog post without field data. */
const measured = () =>
  makeVitals({
    origin: { origin: SITE, field: makeField({ lcp_ms: { p75: 3140, good: 0.61 }, cls: { p75: 0.31, good: 0.4 } }), field_note: null },
    pages: [
      { url: `${SITE}/`, why: 'Start page', lab: makeLab({ lcp_ms: 4312, cls: 0.104, tbt_ms: 650 }), lab_note: null, field: makeField(), field_note: null },
      { url: `${SITE}/blog/a`, why: 'One of 3 pages under /blog/', lab: makeLab(), lab_note: null, field: null, field_note: 'The Chrome UX Report has no phone data for this page.' },
    ],
  });

const NO_KEY = 'No Google API key is set, and the Chrome UX Report API requires one. Add a key in the plugin settings to collect field data.';

/** What an audit without a Google API key stores when PageSpeed Insights answers. */
const labOnly = () =>
  makeVitals({
    field: { available: false, reason: NO_KEY, form_factor: 'phone' },
    origin: { origin: SITE, field: null, field_note: null },
    pages: [{ url: `${SITE}/`, why: 'Start page', lab: makeLab({ lcp_ms: 2600 }), lab_note: null, field: null, field_note: null }],
    notes: [NO_KEY],
  });

const REFUSED = "PageSpeed Insights refused the request: Google's quota for requests without an API key is used up. Add a Google API key in the plugin settings.";

/** What an audit without a Google API key stores today: nothing measured, with the reasons. */
const refused = () =>
  makeVitals({
    lab: { available: false, reason: REFUSED, device: 'mobile' },
    field: { available: false, reason: NO_KEY, form_factor: 'phone' },
    origin: { origin: SITE, field: null, field_note: null },
    pages: [{ url: `${SITE}/`, why: 'Start page', lab: null, lab_note: REFUSED, field: null, field_note: null }],
    notes: [REFUSED, NO_KEY],
  });

test('a run without a measurement has no Core Web Vitals section, and the experience layer says it was not asked', () => {
  for (const run of [makeRun(), makeRun({ core_web_vitals: null }), makeRun({ core_web_vitals: /** @type {any} */ ('yes') })]) {
    const report = buildReport(run);
    assert.equal(report.vitals, null);
    assert.deepEqual(report.layers.map((layer) => layer.name), ['Technical eligibility (this run)', 'Search visibility', 'AI visibility', 'Experience', 'Business results']);
    assert.deepEqual(report.layers[3], {
      name: 'Experience', measured: false, status: 'No data in this run',
      text: 'Real-user speed and usability of the pages.',
      detail: 'Source: the Chrome UX Report. It was not asked in this run.',
    });
    assert.ok(!report.method.some((part) => part.label === 'How Core Web Vitals are measured'));
  }
});

test('Core Web Vitals: the whole site first, then each tested page, with every value formatted and rated', () => {
  const report = buildReport(makeRun({ core_web_vitals: measured() }));
  const vitals = report.vitals;
  assert.ok(vitals);
  assert.deepEqual(vitals.columns, ['LCP (field)', 'INP (field)', 'CLS (field)', 'LCP (lab)', 'CLS (lab)', 'TBT (lab)']);
  assert.deepEqual(vitals.rows, [
    {
      label: 'Whole site', url: null, why: SITE,
      cells: [{ value: '3.140 s', rating: 'needs improvement' }, { value: '150 ms', rating: 'good' }, { value: '0.31', rating: 'poor' }, null, null, null],
    },
    {
      label: null, url: `${SITE}/`, why: 'Start page',
      cells: [
        { value: '2.100 s', rating: 'good' }, { value: '150 ms', rating: 'good' }, { value: '0.05', rating: 'good' },
        { value: '4.312 s', rating: 'poor' }, { value: '0.104', rating: 'needs improvement' }, { value: '650 ms', rating: 'poor' },
      ],
    },
    {
      label: null, url: `${SITE}/blog/a`, why: 'One of 3 pages under /blog/',
      cells: [null, null, null, { value: '1.800 s', rating: 'good' }, { value: '0.02', rating: 'good' }, { value: '120 ms', rating: 'good' }],
    },
  ]);
  assert.deepEqual(vitals.sources, [
    { label: 'Lab data', value: 'PageSpeed Insights tested 2 of 2 pages on an emulated phone.' },
    { label: 'Field data', value: 'The Chrome UX Report has data from real Chrome users on phones for the site as a whole and 1 tested page, collected 2026-10-12 to 2026-11-08.' },
  ]);
  assert.deepEqual(vitals.notes, []);
  assert.match(vitals.legend, /LCP\) of 2\.5 s or less.*INP\) of 200 ms or less.*CLS\) of 0\.1 or less.*TBT\) of 200 ms or less/);

  assert.deepEqual(report.layers[3], {
    name: 'Experience', measured: true, status: 'Measured in this run',
    text: 'Real-user Core Web Vitals from the Chrome UX Report, for the site as a whole and 1 tested page. The values are in the Core Web Vitals section. Not covered: usability and analytics data.',
    detail: null,
  });
  assert.ok(report.summary.paragraphs.includes('Core Web Vitals: lab results for 2 of 2 tested pages; real-user data for the site as a whole and 1 tested page.'));
  assert.ok(report.method.some((part) => part.label === 'How Core Web Vitals are measured' && /sent to Google/.test(part.text)));
});

test('Core Web Vitals without a key: only the lab columns, and the experience layer says why it has no data', () => {
  const report = buildReport(makeRun({ core_web_vitals: labOnly() }));
  const vitals = report.vitals;
  assert.ok(vitals);
  assert.deepEqual(vitals.columns, ['LCP (lab)', 'CLS (lab)', 'TBT (lab)']);
  assert.deepEqual(vitals.rows, [
    { label: null, url: `${SITE}/`, why: 'Start page', cells: [{ value: '2.600 s', rating: 'needs improvement' }, { value: '0.02', rating: 'good' }, { value: '120 ms', rating: 'good' }] },
  ]);
  assert.deepEqual(vitals.sources[1], { label: 'Field data', value: NO_KEY });
  assert.deepEqual(vitals.notes, [], 'the reason is on the status line, so it is not listed again');
  assert.equal(report.layers[3].measured, false);
  assert.equal(report.layers[3].status, 'No data in this run');
  assert.equal(
    report.layers[3].detail,
    `Source: the Chrome UX Report. ${NO_KEY} Lab test results, which are simulated and not real-user data, are in the Core Web Vitals section.`,
  );
  assert.ok(report.summary.paragraphs.includes('Core Web Vitals: lab results for 1 of 1 tested page; no real-user data.'));
});

test('Core Web Vitals that Google refused: no table, the reasons, and a summary that does not pretend', () => {
  const report = buildReport(makeRun({ core_web_vitals: refused() }));
  const vitals = report.vitals;
  assert.ok(vitals);
  assert.deepEqual(vitals.columns, []);
  assert.deepEqual(vitals.rows, []);
  assert.deepEqual(vitals.sources, [{ label: 'Lab data', value: REFUSED }, { label: 'Field data', value: NO_KEY }]);
  assert.deepEqual(vitals.notes, []);
  assert.equal(report.layers[3].detail, `Source: the Chrome UX Report. ${NO_KEY}`);
  assert.ok(report.summary.paragraphs.includes('Core Web Vitals could not be measured; the Core Web Vitals section says why.'));
});

test('Core Web Vitals: the Chrome UX Report answered but has no data', () => {
  const vitals = makeVitals({
    origin: { origin: SITE, field: null, field_note: 'The Chrome UX Report has no phone data for this site.' },
    pages: [{ url: `${SITE}/`, why: 'Start page', lab: makeLab(), lab_note: null, field: null, field_note: 'The Chrome UX Report has no phone data for this page.' }],
  });
  const report = buildReport(makeRun({ core_web_vitals: vitals }));
  assert.equal(report.vitals?.sources[1].value, 'The Chrome UX Report has no phone data for this site or for the tested pages.');
  assert.equal(report.layers[3].measured, false);
  assert.match(report.layers[3].detail ?? '', /^Source: the Chrome UX Report\. It has no data for this site or for the tested pages\. Lab test results/);
});

test('Core Web Vitals in a run file that was edited by hand: nothing is taken on trust', () => {
  const odd = /** @type {any} */ ({
    lab: 'yes', field: null, origin: [], notes: 'none',
    pages: [
      { url: 42, why: null, lab: { lcp_ms: '1800', cls: -1, tbt_ms: Number.NaN }, field: { lcp_ms: { p75: 'slow' }, inp_ms: 7, cls: { p75: Infinity } } },
      'not a page',
      ...Array.from({ length: 30 }, (_, i) => ({ url: `${SITE}/p${i}`, why: 'x', lab: { lcp_ms: 1000 } })),
    ],
  });
  const vitals = buildReport(makeRun({ core_web_vitals: odd })).vitals;
  assert.ok(vitals);
  assert.deepEqual(vitals.columns, ['LCP (lab)']);
  assert.equal(vitals.rows.length, 10, 'at most ten pages are shown');
  assert.deepEqual(vitals.rows[0], { label: null, url: '', why: '', cells: [null] });
  assert.deepEqual(vitals.sources, [{ label: 'Lab data', value: 'Not collected.' }, { label: 'Field data', value: 'Not collected.' }]);
  assert.deepEqual(vitals.notes, []);
});

test('Core Web Vitals notes: kept when they add something, dropped when they repeat a status line', () => {
  const partial = 'PageSpeed Insights tested 1 of 2 pages. Without a lab result: https://example.test/slow (PageSpeed Insights did not answer in time.).';
  const vitals = buildReport(makeRun({ core_web_vitals: { ...labOnly(), notes: [partial, NO_KEY, '', 7, `  ${NO_KEY}  `] } })).vitals;
  assert.deepEqual(vitals?.notes, [partial]);
});
