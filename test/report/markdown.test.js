import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderMarkdown } from '../../server/src/report/markdown.js';
import { compareRuns } from '../../server/src/store/compare.js';
import { SITE, makeField, makeLab, makeVitals } from '../helpers/factories.js';
import { makeCheckStat, makeFinding, makeRun } from '../helpers/run-factory.js';
import { PAYLOADS, assertSafeMarkdown, hostileInput } from './safety.js';

/** @param {string} md @returns {string[]} */
const headings = (md) => [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);

/** @param {string} md @param {string} heading @returns {string} */
function section(md, heading) {
  const start = md.indexOf(`\n## ${heading}\n`);
  assert.notEqual(start, -1, `no section "${heading}"`);
  const next = md.indexOf('\n## ', start + 4);
  return md.slice(start, next === -1 ? undefined : next);
}

const SECTIONS = ['Summary', 'Scope and limits', 'Status by layer', 'Scores', 'Top fixes', 'All findings by check', 'Checks that did not run', 'Method'];
const full = () => {
  const base = makeRun({ run_id: 'base-run', findings: makeRun().findings.slice(2) });
  const run = makeRun();
  return { run, options: { executiveSummary: 'Two sentences.\n\nAnd more.', recommendations: [{ title: 'Rewrite titles', detail: 'Use the brand name.' }], brandName: 'Acme Agency', comparison: compareRuns(base, run) } };
};

test('without options the report has the mandatory sections in order', () => {
  const md = renderMarkdown(makeRun());
  assert.deepEqual(headings(md), SECTIONS);
  assert.ok(md.startsWith('# SEO and link audit\n'));
  assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
});

test('with every option the report has all eleven sections in the contract order', () => {
  const { run, options } = full();
  assert.deepEqual(headings(renderMarkdown(run, options)), [
    'Summary', 'Scope and limits', 'Status by layer', 'Scores', 'Top fixes', 'All findings by check',
    'Suggestions (not scored)', 'Checks that did not run', 'Changes since the previous run', 'Method',
  ]);
});

test('title block: site, date from created_at, run id and "Prepared by" only with a brand name', () => {
  const plain = renderMarkdown(makeRun({ created_at: '2024-03-05T10:00:00Z' }));
  assert.match(plain, /^- \*\*Site:\*\* <https:\/\/example\.test\/>$/m);
  assert.match(plain, /^- \*\*Date:\*\* 5 March 2024$/m);
  assert.match(plain, /^- \*\*Run:\*\* `2026-11-11T14-03-22Z`$/m);
  assert.ok(!plain.includes('Prepared by'));
  assert.match(renderMarkdown(makeRun(), { brandName: 'Acme Agency' }), /^- \*\*Prepared by:\*\* Acme Agency$/m);
  assert.ok(!renderMarkdown(makeRun(), { brandName: '   ' }).includes('Prepared by'));
});

test('summary: factual by default, the written summary (labelled as interpretation) when given', () => {
  const factual = section(renderMarkdown(makeRun()), 'Summary');
  assert.match(factual, /Seekwide crawled 25 pages of example\.test/);
  assert.match(factual, /It recorded 10 findings across 7 checks/);
  assert.ok(!factual.includes('Written summary'));

  const written = section(renderMarkdown(makeRun(), { executiveSummary: 'Titles are the main problem.\n\nFix robots.txt first.' }), 'Summary');
  assert.match(written, /Written summary \(interpretation, not scored\)/);
  assert.match(written, /^Titles are the main problem\.$/m);
  assert.match(written, /^Fix robots\.txt first\.$/m);
  assert.ok(!written.includes('Seekwide crawled'), 'the written summary replaces the factual text');
  assert.match(written, /\*\*Measured:\*\* Pages crawled: 25 · Findings: 10 · Critical or high: 6 · Checks run: 3 of 5/, 'the measured figures stay');
});

test('scope: pages against the budget, truncation, blocks, robots.txt, sitemap and user agent', () => {
  const ok = section(renderMarkdown(makeRun()), 'Scope and limits');
  assert.match(ok, /\*\*Pages crawled:\*\* 25 of 25 pages allowed \(23 HTML, 21 indexable\)/);
  assert.match(ok, /\*\*Page limit reached:\*\* No\./);
  assert.match(ok, /\*\*Blocked:\*\* No\./);
  assert.match(ok, /\*\*robots\.txt:\*\* Found and read\./);
  assert.match(ok, /\*\*Sitemap:\*\* 24 URLs listed in XML sitemaps\./);
  assert.match(ok, /\*\*User agent:\*\* seekwide\/0\.1\.0-alpha\.1/);
  assert.match(ok, /\*\*Modules:\*\* SEO, Links/);

  const limited = section(
    renderMarkdown(makeRun({ crawl: { truncated: true, pages_crawled: 10, max_pages: 10, sitemap_urls: 0, robots_status: 'missing', blocked: { reason: 'bot_challenge', url: 'https://example.test/', status: 403 } } })),
    'Scope and limits',
  );
  assert.match(limited, /\*\*Page limit reached:\*\* Yes\. The crawl stopped before every URL it found was visited/);
  assert.match(limited, /\*\*Blocked:\*\* The crawl stopped early at https:\/\/example\.test\/ \(HTTP 403\): the site answered with a bot challenge and the crawler did not try to get past it\./);
  assert.match(limited, /\*\*robots\.txt:\*\* The site has no robots\.txt/);
  assert.match(limited, /\*\*Sitemap:\*\* No URLs found in XML sitemaps\./);
});

test('scope: every robots.txt status is explained', () => {
  const text = (status) => section(renderMarkdown(makeRun({ crawl: { robots_status: status } })), 'Scope and limits');
  assert.match(text('ok'), /Found and read/);
  assert.match(text('missing'), /every URL was allowed/);
  assert.match(text('unreachable'), /treated every URL as disallowed/);
  assert.match(text('something-new'), /robots\.txt:\*\* something-new/);
});

test('layers: technical eligibility is measured; three layers say "No data in this version" and name a planned source; experience says why it has no data in this run', () => {
  const layers = section(renderMarkdown(makeRun()), 'Status by layer');
  const rows = layers.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| Layer'));
  assert.equal(rows.length, 5);
  assert.match(rows[0], /^\| Technical eligibility \(this run\) \| Measured in this run \|/);
  assert.deepEqual(rows.slice(1).map((r) => r.split(' | ')[0].replace('| ', '')), ['Search visibility', 'AI visibility', 'Experience', 'Business results']);
  for (const row of [rows[1], rows[2], rows[4]]) {
    assert.ok(row.includes('**No data in this version**'), row);
    assert.match(row, /Planned source: /);
  }
  assert.match(rows[1], /Search Console/);
  assert.ok(rows[3].includes('**No data in this run**'), rows[3]);
  assert.match(rows[3], /Real-user speed and usability of the pages\. Source: the Chrome UX Report\. It was not asked in this run\./);
  assert.match(rows[4], /Analytics and CRM/);
});

test('scores: module, score, coverage and checks run', () => {
  const scores = section(renderMarkdown(makeRun()), 'Scores');
  assert.match(scores, /\| SEO \| 78 \/ 100 \| 94% \| 32 of 34 \(2 skipped\) \|/);
  assert.match(scores, /\| Links \| 88 \/ 100 \| 80% \| 8 of 10 \(2 skipped\) \|/);
  assert.ok(scores.indexOf('| SEO |') < scores.indexOf('| Links |'));
  assert.match(scores, /weighted pass rate/);

  const unscored = makeRun();
  unscored.modules.links.score = null;
  assert.match(section(renderMarkdown(unscored), 'Scores'), /\| Links \| n\/a \| 80% \|/);
  assert.match(section(renderMarkdown(makeRun({ modules: {} })), 'Scores'), /No module was scored\./);
});

test('scores: a null score shows its note in place of the score', () => {
  const run = makeRun();
  run.modules.links = { ...run.modules.links, score: null, note: 'The crawl was blocked before any page could be read, so there is nothing to score.' };
  const md = section(renderMarkdown(run), 'Scores');
  assert.match(md, /\| Links \| The crawl was blocked before any page could be read, so there is nothing to score\. \| 80% \|/);
  assert.match(md, /\| SEO \| 78 \/ 100 \|/);
  assert.ok(!md.includes('n/a'));
});

test('scores: a null score without a note, as in older runs, shows n/a', () => {
  const run = makeRun();
  run.modules.links = { score: null, coverage: 0.8, checks_total: 10, checks_run: 8, checks_skipped: 2 };
  assert.match(section(renderMarkdown(run), 'Scores'), /\| Links \| n\/a \| 80% \|/);
});

test('scores: a note is not shown next to a score that exists', () => {
  const run = makeRun();
  run.modules.seo = { ...run.modules.seo, note: 'should not appear' };
  assert.ok(!renderMarkdown(run).includes('should not appear'));
});

test('scores: a note with pipes and markup keeps the table intact', () => {
  const run = makeRun();
  run.modules.links = { ...run.modules.links, score: null, note: 'No score | really\n# not a heading <b>x</b> `y`' };
  const md = renderMarkdown(run);
  assertSafeMarkdown(md);
  assert.ok(!/^# not a heading/m.test(md));
  assert.match(section(md, 'Scores'), /\| Links \| No score \\\| really # not a heading &lt;b>x&lt;\/b> \\`y\\` \| 80% \|/);
});

test('scope: pages the crawler could not read are counted, with the reason, only when there are some', () => {
  const scope = (crawl) => section(renderMarkdown(makeRun({ crawl })), 'Scope and limits');
  assert.ok(!scope({}).includes('Pages not read'));
  assert.ok(!scope({ unreadable_pages: 0 }).includes('Pages not read'));
  const none = makeRun();
  delete none.crawl.unreadable_pages;
  assert.ok(!section(renderMarkdown(none), 'Scope and limits').includes('Pages not read'));

  assert.match(scope({ unreadable_pages: 1 }), /^- \*\*Pages not read:\*\* 1 page could not be read\. The crawler was refused there \(a firewall or bot challenge, a rate limit, or a robots\.txt rule reached through a redirect\), so it was left out of the checks and this audit is incomplete\.$/m);
  assert.match(scope({ unreadable_pages: 12 }), /^- \*\*Pages not read:\*\* 12 pages could not be read\..* so they were left out of the checks and this audit is incomplete\.$/m);
});

test('summary: the factual summary says the audit is incomplete when pages could not be read', () => {
  assert.ok(!section(renderMarkdown(makeRun()), 'Summary').includes('could not be read'));
  assert.match(section(renderMarkdown(makeRun({ crawl: { unreadable_pages: 3 } })), 'Summary'), /^3 pages could not be read\..* this audit is incomplete\.$/m);
});

test('top fixes: grouped by check with count, confidence, recommendation, three examples and the documentation link', () => {
  const md = section(renderMarkdown(makeRun()), 'Top fixes');
  assert.match(md, /^### 1\. robots\.txt blocks the whole site \(Critical\)$/m);
  assert.match(md, /^### 2\. Title missing \(High\)$/m);
  const second = md.slice(md.indexOf('### 2.'), md.indexOf('### 3.'));
  assert.match(second, /- \*\*Check:\*\* `seo\.title\.missing`/);
  assert.match(second, /- \*\*Affected:\*\* 3 findings · \*\*Confidence:\*\* Confirmed/);
  assert.match(second, /- \*\*What to do:\*\* Add a unique, descriptive title element/);
  assert.match(second, /- \*\*Examples:\*\* <https:\/\/example\.test\/about> <https:\/\/example\.test\/contact> <https:\/\/example\.test\/pricing>/);
  assert.match(second, /- \*\*Documentation:\*\* <https:\/\/developers\.google\.com\/search\/docs\/appearance\/title-link>/);
  assert.match(md, /Confirmed means a measured fact\. Likely means/);
  const order = [...md.matchAll(/^### \d+\. (.+) \((\w+)\)$/gm)].map((m) => m[2]);
  assert.deepEqual(order, ['Critical', 'High', 'High', 'Medium', 'Low', 'Low', 'Info']);
});

test('top fixes lists at most ten groups and at most three example URLs per group', () => {
  const findings = Array.from({ length: 12 }, (_, i) => makeFinding({ check_id: `seo.c${String(i).padStart(2, '0')}`, title: `Problem ${i}`, severity: 'medium', url: `https://example.test/${i}` }));
  findings.push(...Array.from({ length: 6 }, (_, i) => makeFinding({ check_id: 'seo.c00', title: 'Problem 0', severity: 'medium', url: `https://example.test/extra${i}` })));
  const md = renderMarkdown(makeRun({ findings }));
  const top = section(md, 'Top fixes');
  assert.equal([...top.matchAll(/^### \d+\./gm)].length, 10);
  assert.equal([...section(md, 'All findings by check').matchAll(/^### /gm)].length, 12);
  assert.ok(top.includes('Problem 9') && !top.includes('Problem 10'));
  assert.equal(top.match(/Examples:\*\* (.*)/g)?.[0].match(/<https/g)?.length, 3);
});

test('"no findings" is stated, not hidden', () => {
  const md = renderMarkdown(makeRun({ findings: [] }));
  assert.match(section(md, 'Top fixes'), /No findings\. Every check that ran passed\./);
  assert.match(section(md, 'All findings by check'), /No findings\./);
  assert.match(section(md, 'Summary'), /found no problems in the checks that ran/);
});

test('all findings: a table per check with URL and evidence, selector and line', () => {
  const md = section(renderMarkdown(makeRun()), 'All findings by check');
  assert.match(md, /^### Broken internal link \(`links\.internal\.broken`\)$/m);
  assert.match(md, /^High · Confirmed · 2 findings$/m);
  assert.match(md, /\| <https:\/\/example\.test\/blog> \| Observed: `\{"target":"https:\/\/example\.test\/old-post","status":404\}` · Expected: `A link to a page that answers 200` · Selector: `a\[href="\/old-post"\]` · Line 42 \|/);
  assert.match(md, /\| Whole site \| Detail: No sitemap was listed in robots\.txt or found at \/sitemap\.xml\. \|/);
  assert.match(md, /Also: <https:\/\/example\.test\/services\/b>/);
  assert.match(md, /\| URL \| Evidence \|\n\|---\|---\|/);
});

test('all findings: up to maxUrlsPerCheck rows and "+N more"', () => {
  const findings = Array.from({ length: 25 }, (_, i) => makeFinding({ url: `https://example.test/p${String(i).padStart(2, '0')}` }));
  const run = makeRun({ findings });
  const rows = (md) => md.split('\n').filter((line) => line.startsWith('| <https://example.test/p')).length;
  const byDefault = section(renderMarkdown(run), 'All findings by check');
  assert.equal(rows(byDefault), 10);
  assert.match(byDefault, /^\+15 more findings not shown\.$/m);
  const three = section(renderMarkdown(run, { maxUrlsPerCheck: 3 }), 'All findings by check');
  assert.equal(rows(three), 3);
  assert.match(three, /^\+22 more findings not shown\.$/m);
  const all = section(renderMarkdown(run, { maxUrlsPerCheck: 25 }), 'All findings by check');
  assert.equal(rows(all), 25);
  assert.ok(!all.includes('more finding'));
  assert.match(renderMarkdown(makeRun({ findings: findings.slice(0, 2) }), { maxUrlsPerCheck: 1 }), /^\+1 more finding not shown\.$/m);
});

test('evidence with pipes, backticks, newlines and markup keeps tables and formatting intact', () => {
  const nasty = 'a | b ``` ` c\n# not a heading\n- not a list | more\r\n<b>bold</b> [x](javascript:alert(1)) **b** _i_';
  const finding = makeFinding({ evidence: { observed: nasty, expected: 'x|y', detail: nasty }, selector: 'a[href="x|y"]', related_urls: ['https://example.test/a|b', 'javascript:alert(1)'], url: 'https://example.test/q?a=1|2' });
  const md = renderMarkdown(makeRun({ findings: [finding] }));
  assertSafeMarkdown(md);
  const row = md.split('\n').find((line) => line.startsWith('| <https://example.test/q'));
  assert.ok(row && !row.includes('\n'));
  assert.ok(row.includes('not a heading'), 'the text is kept, on one line');
  assert.ok(!/^# not a heading/m.test(md) && !/^- not a list/m.test(md));
  assert.ok(row.includes('<https://example.test/q?a=1%7C2>'));
  assert.ok(row.includes('`javascript:alert(1)`'), 'a non-http URL is shown as code, not linked');
});

test('suggestions are labelled as not scored, and only appear when given', () => {
  assert.ok(!renderMarkdown(makeRun()).includes('Suggestions'));
  assert.ok(!renderMarkdown(makeRun(), { recommendations: [] }).includes('Suggestions'));
  const md = section(renderMarkdown(makeRun(), { recommendations: [{ title: 'Rewrite titles', detail: 'Use the brand name.\nKeep it short.' }, { title: 'Add a sitemap', detail: 'List it in robots.txt.' }] }), 'Suggestions (not scored)');
  assert.match(md, /interpretation, not measurement, and they do not change any score/);
  assert.match(md, /^### 1\. Rewrite titles$/m);
  assert.match(md, /^Use the brand name\. Keep it short\.$/m);
  assert.match(md, /^### 2\. Add a sitemap$/m);
});

test('checks that did not run are listed with reasons, or all checks ran is stated', () => {
  const md = section(renderMarkdown(makeRun()), 'Checks that did not run');
  assert.match(md, /\| `links\.orphan\.sitemap_only` \| Skipped \| Needs a complete crawl\./);
  assert.match(md, /\| `links\.outbound\.broken` \| Skipped \| Needs external link checks\. They were not run\. \|/);
  const failed = makeRun({ checks: [makeCheckStat({ id: 'seo.x', status: 'error', skip_reason: 'Check failed to run: boom' })] });
  assert.match(section(renderMarkdown(failed), 'Checks that did not run'), /\| `seo\.x` \| Error \| Check failed to run: boom \|/);
  assert.match(section(renderMarkdown(makeRun({ checks: [makeCheckStat()] })), 'Checks that did not run'), /All checks ran\./);
});

test('changes since the previous run: counts, score deltas, checks and caveats', () => {
  const run = makeRun({ run_id: 'now' });
  const base = makeRun({ run_id: 'before', findings: run.findings.slice(3), rules_version: '0.0.9', crawl: { truncated: true } });
  base.modules.seo.score = 70;
  base.modules.links.score = 90;
  const md = section(renderMarkdown(run, { comparison: compareRuns(base, run) }), 'Changes since the previous run');
  assert.match(md, /Compared with run `before`\./);
  assert.match(md, /- \*\*Resolved:\*\* 0 findings/);
  assert.match(md, /- \*\*New:\*\* 3 findings/);
  assert.match(md, /- \*\*Still present:\*\* 7/);
  assert.match(md, /\| SEO \| 70 \| 78 \| \+8 \|/);
  assert.match(md, /\| Links \| 90 \| 88 \| -2 \|/);
  assert.match(md, /\*\*New\*\* \(3 findings\)\n\n- robots\.txt blocks the whole site \(`seo\.robots\.disallow_all`\): 1/);
  assert.match(md, /\*\*Caveats\*\*/);
  assert.match(md, /rules version changed from 0\.0\.9/);
  assert.match(md, /base run's crawl stopped at its page limit/);
  assert.ok(!md.includes('**Resolved** ('), 'an empty list is not shown');
});

test('changes: resolved findings are listed, and a comparison of equal runs has no caveats', () => {
  const run = makeRun({ run_id: 'now', findings: [] });
  const base = makeRun({ run_id: 'before' });
  const md = section(renderMarkdown(run, { comparison: compareRuns(base, run) }), 'Changes since the previous run');
  assert.match(md, /- \*\*Resolved:\*\* 10 findings/);
  assert.match(md, /\*\*Resolved\*\* \(10 findings\)/);
  assert.ok(!md.includes('Caveats'));
});

test('changes: long lists are cut at ten checks', () => {
  const many = Array.from({ length: 13 }, (_, i) => makeFinding({ check_id: `seo.r${String(i).padStart(2, '0')}`, title: `Gone ${i}` }));
  const run = makeRun({ run_id: 'now', findings: [] });
  const md = section(renderMarkdown(run, { comparison: compareRuns(makeRun({ run_id: 'before', findings: many }), run) }), 'Changes since the previous run');
  assert.match(md, /\*\*Resolved\*\* \(13 findings\)/);
  assert.match(md, /- \+3 more checks/);
});

test('a comparison that belongs to another run is refused', () => {
  const comparison = compareRuns(makeRun({ run_id: 'a' }), makeRun({ run_id: 'b' }));
  assert.throws(() => renderMarkdown(makeRun({ run_id: 'c' }), { comparison }), /belongs to run b, not to run c/);
});

test('method: crawl behaviour, confirmed and likely, versions and the no-prediction statement', () => {
  const md = section(renderMarkdown(makeRun({ plugin_version: '9.9.9', rules_version: '8.8.8' })), 'Method');
  assert.match(md, /one at a time at a limited rate, obeys robots\.txt/);
  assert.match(md, /does not run JavaScript/);
  assert.match(md, /Confirmed means the problem is a measured fact\. Likely means a strong signal/);
  assert.match(md, /Seekwide 9\.9\.9, rules 8\.8\.8/);
  assert.match(md, /does not predict rankings or traffic/);
});

test('the report is honest about what it did not measure', () => {
  const md = renderMarkdown(makeRun());
  assert.equal(md.match(/No data in this version/g)?.length, 3, 'the three layers this version cannot measure');
  assert.equal(md.match(/No data in this run/g)?.length, 1, 'the experience layer, which this run did not fill');
  assert.match(md, /Not covered: whether the pages are actually indexed\./);
  assert.match(md, /The layers marked "No data" were not measured at all\./);
  assert.ok(!/guarantee(?!s? any position)/.test(md.replace(/does not guarantee any position/g, '')));
});

test('the same arguments give byte-identical output, whatever the clock says', (t) => {
  const { run, options } = full();
  const first = renderMarkdown(structuredClone(run), structuredClone(options));
  t.mock.timers.enable({ apis: ['Date'], now: new Date('1999-01-01T00:00:00Z') });
  const second = renderMarkdown(structuredClone(run), structuredClone(options));
  t.mock.timers.setTime(new Date('2040-06-06T06:06:06Z').getTime());
  const third = renderMarkdown(structuredClone(run), structuredClone(options));
  assert.equal(second, first);
  assert.equal(third, first);
  assert.ok(!/1999|2040/.test(first));
});

test('dates come from run.created_at', () => {
  assert.match(renderMarkdown(makeRun({ created_at: '2019-07-04T12:00:00Z' })), /\*\*Date:\*\* 4 July 2019/);
});

test('rendering does not change the run or the options', () => {
  const { run, options } = full();
  const copies = structuredClone({ run, options });
  renderMarkdown(run, options);
  assert.deepEqual({ run, options }, copies);
});

test('logoDataUri is accepted and ignored: Markdown has no embedded logo', () => {
  const withLogo = renderMarkdown(makeRun(), { logoDataUri: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.equal(withLogo, renderMarkdown(makeRun()));
});

for (const payload of PAYLOADS) {
  test(`hostile text in every field cannot inject Markdown or HTML: ${JSON.stringify(payload).slice(0, 40)}`, () => {
    const { run, options } = hostileInput(payload);
    const md = renderMarkdown(run, options);
    assertSafeMarkdown(md);
    assert.ok(!/^# injected/m.test(md) && !/^- item/m.test(md), 'a hostile line became markup');
    assert.deepEqual(headings(md).filter((h) => !SECTIONS.includes(h) && !['Core Web Vitals', 'Suggestions (not scored)', 'Changes since the previous run'].includes(h)), []);
    assert.ok(!/\]\(javascript:/i.test(md));
  });
}

test('a single hostile field at a time: each dynamic field is rendered and neutralized', () => {
  const payload = '<script>alert(1)</script>';
  const cases = {
    title: (run) => { run.findings[1].title = payload; },
    url: (run) => { run.findings[1].url = payload; },
    selector: (run) => { run.findings[1].selector = payload; },
    observed: (run) => { run.findings[1].evidence.observed = payload; },
    detail: (run) => { run.findings[1].evidence.detail = payload; },
    recommendation: (run) => { run.findings[1].recommendation = payload; },
    docRef: (run) => { run.findings[1].doc_ref = payload; },
    checkId: (run) => { run.findings[1].check_id = payload; },
    skipReason: (run) => { run.checks[3].skip_reason = payload; },
    scoreNote: (run) => { run.modules.links.score = null; run.modules.links.note = payload; },
    userAgent: (run) => { run.crawl.user_agent = payload; },
    startUrl: (run) => { run.start_url = payload; },
    pluginVersion: (run) => { run.plugin_version = payload; },
    runId: (run) => { run.run_id = payload; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const run = makeRun();
    mutate(run);
    const md = renderMarkdown(run);
    assert.ok(md.includes('script'), `${name} was not rendered`);
    assertSafeMarkdown(md);
  }
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

test('Core Web Vitals section: after the scores, with sources, a table of values and the legend', () => {
  const md = renderMarkdown(makeRun({ core_web_vitals: measured() }));
  assert.deepEqual(headings(md), ['Summary', 'Scope and limits', 'Status by layer', 'Scores', 'Core Web Vitals', 'Top fixes', 'All findings by check', 'Checks that did not run', 'Method']);
  const part = section(md, 'Core Web Vitals');
  assert.match(part, /^- \*\*Lab data:\*\* PageSpeed Insights tested 2 of 2 pages on an emulated phone\.$/m);
  assert.match(part, /^- \*\*Field data:\*\* The Chrome UX Report has data from real Chrome users on phones for the site as a whole and 1 tested page, collected 2026-10-12 to 2026-11-08\.$/m);
  const rows = part.split('\n').filter((line) => line.startsWith('| '));
  assert.deepEqual(rows, [
    '| Page | Why it was measured | LCP (field) | INP (field) | CLS (field) | LCP (lab) | CLS (lab) | TBT (lab) |',
    `| Whole site | ${SITE} | 3.140 s (needs improvement) | 150 ms (good) | 0.31 (poor) | — | — | — |`,
    `| <${SITE}/> | Start page | 2.100 s (good) | 150 ms (good) | 0.05 (good) | 4.312 s (poor) | 0.104 (needs improvement) | 650 ms (poor) |`,
    `| <${SITE}/blog/a> | One of 3 pages under /blog/ | — | — | — | 1.800 s (good) | 0.02 (good) | 120 ms (good) |`,
  ]);
  assert.match(part, /^\*Field values are the 75th percentile among real Chrome users on phones over 28 days/m);
  const withNote = section(renderMarkdown(makeRun({ core_web_vitals: { ...measured(), notes: ['PageSpeed Insights was redirected from https://example.test/ to https://example.test/home and tested that page.'] } })), 'Core Web Vitals');
  assert.ok(withNote.trimEnd().endsWith('\n- PageSpeed Insights was redirected from https://example.test/ to https://example.test/home and tested that page.'), 'a note that adds something is listed under the table');
  assert.match(section(md, 'Status by layer'), /\| Experience \| Measured in this run \| Real-user Core Web Vitals from the Chrome UX Report/);
  assert.match(section(md, 'Method'), /\*\*How Core Web Vitals are measured\.\*\* Only a few pages are measured/);
  assert.match(section(md, 'Summary'), /Core Web Vitals: lab results for 2 of 2 tested pages; real-user data for the site as a whole and 1 tested page\./);
  assertSafeMarkdown(md);
});

test('Core Web Vitals section without a key: lab columns only, and the note says how to get field data', () => {
  const part = section(renderMarkdown(makeRun({ core_web_vitals: labOnly() })), 'Core Web Vitals');
  assert.deepEqual(part.split('\n').filter((line) => line.startsWith('| ')), [
    '| Page | Why it was measured | LCP (lab) | CLS (lab) | TBT (lab) |',
    `| <${SITE}/> | Start page | 2.600 s (needs improvement) | 0.02 (good) | 120 ms (good) |`,
  ]);
  assert.ok(part.includes(`- **Field data:** ${NO_KEY}`));
  assert.equal(part.split(NO_KEY).length - 1, 1, 'the reason is stated once, not repeated as a note');
});

test('Core Web Vitals section when Google refused: the reasons, each once, and no table', () => {
  const md = renderMarkdown(makeRun({ core_web_vitals: refused() }));
  const part = section(md, 'Core Web Vitals');
  assert.ok(!part.includes('| Page |'));
  assert.equal(part.trim(), `## Core Web Vitals\n\n- **Lab data:** ${REFUSED}\n- **Field data:** ${NO_KEY}`);
  assert.match(section(md, 'Status by layer'), /\| Experience \| \*\*No data in this run\*\* \|/);
  assertSafeMarkdown(md);
});

test('a run without a measurement has no Core Web Vitals section', () => {
  assert.ok(!headings(renderMarkdown(makeRun())).includes('Core Web Vitals'));
  assert.ok(!headings(renderMarkdown(makeRun({ core_web_vitals: null }))).includes('Core Web Vitals'));
});
