import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderHtml } from '../../plugin/server/src/report/html.js';
import { compareRuns } from '../../plugin/server/src/store/compare.js';
import { SITE, makeField, makeLab, makeVitals } from '../helpers/factories.js';
import { makeCheckStat, makeFinding, makeRun } from '../helpers/run-factory.js';
import { PAYLOADS, assertSafeHtml, hostileInput, parseHtml } from './safety.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** @param {string} out @returns {string[]} */
const sectionIds = (out) => [...out.matchAll(/<section id="([^"]+)">/g)].map((m) => m[1]);

/** @param {string} out @param {string} id @returns {string} */
function section(out, id) {
  const start = out.indexOf(`<section id="${id}">`);
  assert.notEqual(start, -1, `no section ${id}`);
  return out.slice(start, out.indexOf('</section>', start));
}

/** @param {string} fragment @returns {string} Visible text: tags become spaces, entities are decoded. */
const textOf = (fragment) =>
  fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

const full = () => {
  const base = makeRun({ run_id: 'base-run', findings: makeRun().findings.slice(2) });
  const run = makeRun();
  return { run, options: { executiveSummary: 'Two sentences.\n\nAnd more.', recommendations: [{ title: 'Rewrite titles', detail: 'Use the brand name.' }], brandName: 'Acme Agency', logoDataUri: PNG, comparison: compareRuns(base, run) } };
};

test('without options the report has the mandatory sections in order', () => {
  const out = renderHtml(makeRun());
  assert.deepEqual(sectionIds(out), ['summary', 'scope', 'layers', 'scores', 'top-fixes', 'findings', 'not-run', 'method']);
  assert.ok(out.startsWith('<!doctype html>\n<html lang="en">'));
  assert.ok(out.endsWith('</html>\n'));
  assertSafeHtml(out);
});

test('with every option the report has all eleven sections in the contract order', () => {
  const { run, options } = full();
  const out = renderHtml(run, options);
  assert.deepEqual(sectionIds(out), ['summary', 'scope', 'layers', 'scores', 'top-fixes', 'findings', 'suggestions', 'not-run', 'changes', 'method']);
  assertSafeHtml(out);
  const headings = [...out.matchAll(/<h2>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, [
    'Summary', 'Scope and limits', 'Status by layer', 'Scores', 'Top fixes', 'All findings by check',
    'Suggestions (not scored)', 'Checks that did not run', 'Changes since the previous run', 'Method',
  ]);
});

test('it is one self-contained file: inline CSS, no scripts, no external requests, a restrictive CSP', () => {
  const { run, options } = full();
  for (const out of [renderHtml(run, options), renderHtml(makeRun())]) {
    assert.equal(out.match(/<style>/g)?.length, 1);
    assert.ok(!/<script|<link|<iframe|<object|<embed|<base|<form/i.test(out));
    assert.ok(!/@import|url\s*\(/i.test(out));
    assert.ok(!/<[^>]+\s(?:src|srcset|poster|data|action|formaction|background)\s*=\s*"(?!data:image\/)/i.test(out));
    assert.match(out, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">/);
    assert.match(out, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
    assert.match(out, /<meta name="referrer" content="no-referrer">/);
  }
});

test('print styles: page size, page breaks, repeating table headers and exact colors', () => {
  const css = parseHtml(renderHtml(makeRun())).css;
  assert.match(css, /@page\{size:A4/);
  assert.match(css, /@media print\{/);
  assert.match(css, /break-inside:avoid/);
  assert.match(css, /thead\{display:table-header-group\}/);
  assert.match(css, /print-color-adjust:exact/);
  assert.match(css, /@media \(max-width:600px\)/);
  assert.ok(css.length < 6500, `stylesheet is ${css.length} characters; keep it compact`);
});

test('title block: h1, the site as a link, the date from created_at, and "Prepared by" only with a brand name', () => {
  const plain = renderHtml(makeRun({ created_at: '2024-03-05T10:00:00Z' }));
  assert.match(plain, /<h1>SEO and link audit<\/h1>/);
  assert.match(plain, /<p class="sub"><a class="u" href="https:\/\/example\.test\/" rel="noopener noreferrer nofollow">https:\/\/example\.test\/<\/a> &middot; 5 March 2024<\/p>/);
  assert.match(plain, /<title>SEO and link audit: example\.test<\/title>/);
  assert.ok(!plain.includes('Prepared by') && !plain.includes('<img') && !plain.includes('class="brand"'));
  const branded = renderHtml(makeRun(), { brandName: 'Acme Agency' });
  assert.match(branded, /<div class="brand"><span>Prepared by Acme Agency<\/span><\/div>/);
  assert.ok(!branded.includes('<img'));
});

test('logo: embedded as a data URI image next to the brand name', () => {
  const out = renderHtml(makeRun(), { brandName: 'Acme Agency', logoDataUri: PNG });
  assert.match(out, /<div class="brand"><img src="data:image\/png;base64,[^"]+" alt="Acme Agency"><span>Prepared by Acme Agency<\/span><\/div>/);
  assert.match(renderHtml(makeRun(), { logoDataUri: PNG }), /<img src="data:image\/png;base64,[^"]+" alt="">/);
  assertSafeHtml(out);
});

test('a logo that is not a base64 PNG, JPEG, WebP or SVG data URI is refused', () => {
  for (const bad of ['https://evil.test/logo.png', '//evil.test/logo.png', 'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/gif;base64,R0lGOD', 'data:image/png,not-base64']) {
    assert.throws(() => renderHtml(makeRun(), { logoDataUri: bad }), TypeError, bad);
  }
});

test('summary: factual by default, the written summary labelled as interpretation when given', () => {
  const factual = textOf(section(renderHtml(makeRun()), 'summary'));
  assert.match(factual, /Seekwide crawled 25 pages of example\.test/);
  assert.ok(!factual.includes('Written summary'));
  assert.match(factual, /Measured in this run/);

  const out = section(renderHtml(makeRun(), { executiveSummary: 'First point.\n\nSecond point.' }), 'summary');
  assert.match(out, /<p class="note">Written summary \(interpretation, not scored\)/);
  assert.match(out, /<p>First point\.<\/p>\s*<p>Second point\.<\/p>/);
  assert.ok(!out.includes('Seekwide crawled'));
  assert.match(out, /<div class="figs">(?:<div class="fig"><b>[^<]+<\/b><span>[^<]+<\/span><\/div>){4}<\/div>/);
});

test('scope: budget, truncation, blocks, robots.txt, sitemap and user agent', () => {
  const ok = textOf(section(renderHtml(makeRun()), 'scope'));
  assert.match(ok, /Pages crawled 25 of 25 pages allowed \(23 HTML, 21 indexable\)/);
  assert.match(ok, /Page limit reached No\./);
  assert.match(ok, /Blocked No\./);
  assert.match(ok, /robots\.txt Found and read\./);
  assert.match(ok, /Sitemap 24 URLs listed in XML sitemaps\./);
  assert.match(ok, /User agent seekwide\/0\.1\.0-alpha\.1/);
  assert.match(section(renderHtml(makeRun()), 'scope'), /<dt>User agent<\/dt><dd><code>seekwide/);

  const limited = textOf(section(renderHtml(makeRun({ crawl: { truncated: true, robots_status: 'unreachable', sitemap_urls: 0, blocked: { reason: 'rate_limited', url: 'https://example.test/x', status: 429 } } })), 'scope'));
  assert.match(limited, /Page limit reached Yes\./);
  assert.match(limited, /Blocked The crawl stopped early at https:\/\/example\.test\/x \(HTTP 429\): the site kept answering "too many requests"\./);
  assert.match(limited, /treated every URL as disallowed/);
  assert.match(limited, /No URLs found in XML sitemaps\./);
});

test('layers: technical eligibility is measured; three say "No data in this version" with a planned source; experience says why it has no data in this run', () => {
  const out = section(renderHtml(makeRun()), 'layers');
  const cards = out.split(/<div class="layer(?: on)?">/).slice(1);
  assert.equal(cards.length, 5);
  assert.match(out, /<div class="layer on">\s*<h3>Technical eligibility/);
  assert.match(cards[0], /^\s*<h3>Technical eligibility \(this run\)<\/h3><span class="pill">Measured in this run<\/span>/);
  for (const card of [cards[1], cards[2], cards[4]]) {
    assert.match(card, /<span class="pill">No data in this version<\/span>/);
    assert.match(card, /Planned source: /);
  }
  assert.match(cards[3], /<span class="pill">No data in this run<\/span>/);
  assert.match(cards[3], /<p class="src">Source: the Chrome UX Report\. It was not asked in this run\.<\/p>/);
  assert.deepEqual(cards.slice(1).map((c) => /<h3>([^<]+)<\/h3>/.exec(c)?.[1]), ['Search visibility', 'AI visibility', 'Experience', 'Business results']);
});

test('scores: a row per module with score, coverage and checks run, and a bar of numeric width', () => {
  const out = section(renderHtml(makeRun()), 'scores');
  assert.match(out, /<td>SEO<\/td><td><b>78<\/b> \/ 100<span class="bar"><i style="width:78%"><\/i><\/span><\/td><td class="n">94%<\/td><td class="n">32 of 34 \(2 skipped\)<\/td>/);
  assert.match(out, /<td>Links<\/td><td><b>88<\/b> \/ 100/);
  assert.ok(out.indexOf('<td>SEO</td>') < out.indexOf('<td>Links</td>'));
  const unscored = makeRun();
  unscored.modules.links.score = null;
  assert.match(section(renderHtml(unscored), 'scores'), /<td>Links<\/td><td>n\/a<\/td>/);
  assert.match(section(renderHtml(makeRun({ modules: {} })), 'scores'), /<p>No module was scored\.<\/p>/);
});

test('scores: a null score shows its note in place of the score', () => {
  const run = makeRun();
  run.modules.links = { ...run.modules.links, score: null, note: 'The crawl was blocked before any page could be read, so there is nothing to score.' };
  const out = section(renderHtml(run), 'scores');
  assert.match(out, /<td>Links<\/td><td class="nt">The crawl was blocked before any page could be read, so there is nothing to score\.<\/td><td class="n">80%<\/td>/);
  assert.match(out, /<td>SEO<\/td><td><b>78<\/b> \/ 100/);
  assert.ok(!out.includes('n/a'));
  assertSafeHtml(renderHtml(run));
});

test('scores: a null score without a note, as in older runs, shows n/a', () => {
  const run = makeRun();
  run.modules.links = { score: null, coverage: 0.8, checks_total: 10, checks_run: 8, checks_skipped: 2 };
  assert.match(section(renderHtml(run), 'scores'), /<td>Links<\/td><td>n\/a<\/td>/);
});

test('scores: a note is not shown next to a score that exists', () => {
  const run = makeRun();
  run.modules.seo = { ...run.modules.seo, note: 'should not appear' };
  assert.ok(!renderHtml(run).includes('should not appear'));
});

test('scope: pages the crawler could not read are counted, with the reason, only when there are some', () => {
  const scope = (crawl) => textOf(section(renderHtml(makeRun({ crawl })), 'scope'));
  assert.ok(!scope({}).includes('Pages not read'));
  assert.ok(!scope({ unreadable_pages: 0 }).includes('Pages not read'));
  const none = makeRun();
  delete none.crawl.unreadable_pages;
  assert.ok(!textOf(section(renderHtml(none), 'scope')).includes('Pages not read'));

  assert.match(scope({ unreadable_pages: 1 }), /Pages not read 1 page could not be read\. The crawler was refused there \(a firewall or bot challenge, a rate limit, or a robots\.txt rule reached through a redirect\), so it was left out of the checks and this audit is incomplete\./);
  assert.match(scope({ unreadable_pages: 12 }), /Pages not read 12 pages could not be read\..* so they were left out of the checks and this audit is incomplete\./);
  assert.match(section(renderHtml(makeRun({ crawl: { unreadable_pages: 2 } })), 'scope'), /<dt>Blocked<\/dt><dd>No\.<\/dd><dt>Pages not read<\/dt><dd>2 pages could not be read/);
});

test('summary: the factual summary says the audit is incomplete when pages could not be read', () => {
  assert.ok(!textOf(section(renderHtml(makeRun()), 'summary')).includes('could not be read'));
  assert.match(textOf(section(renderHtml(makeRun({ crawl: { unreadable_pages: 3 } })), 'summary')), /3 pages could not be read\..* this audit is incomplete\./);
});

test('a score that is not a number cannot reach the style attribute', () => {
  const run = makeRun();
  run.modules.seo.score = /** @type {any} */ ('50%;background:url(//evil.test/x)');
  run.modules.links.score = 9999;
  const out = renderHtml(run);
  assertSafeHtml(out);
  assert.ok(!out.includes('evil.test'));
  assert.match(out, /style="width:100%"/);
});

test('top fixes: cards ordered by severity with badges, count, recommendation, examples and documentation', () => {
  const out = section(renderHtml(makeRun()), 'top-fixes');
  const cards = out.split('<article class="card').slice(1);
  assert.equal(cards.length, 7);
  assert.match(cards[0], /^ sev-critical">\s*<h3><span class="rank">1\.<\/span>robots\.txt blocks the whole site <span class="badge sev-critical">Critical<\/span> <span class="badge confirmed">Confirmed<\/span><\/h3>/);
  assert.match(cards[1], /<span class="badge sev-high">High<\/span>/);
  assert.match(cards[1], /<code>seo\.title\.missing<\/code> &middot; 3 findings/);
  assert.match(cards[1], /<strong>What to do:<\/strong> Add a unique, descriptive title element/);
  assert.equal(cards[1].match(/<br><a class="u" href="https:\/\/example\.test\/(?:about|contact|pricing)"/g)?.length, 3);
  assert.match(cards[1], /Documentation: <a class="u" href="https:\/\/developers\.google\.com\/search\/docs\/appearance\/title-link" rel="noopener noreferrer nofollow">/);
  assert.match(cards[6], /<span class="badge sev-info">Info<\/span> <span class="badge likely">Likely<\/span>/);
  assert.match(out, /Confirmed means a measured fact\. Likely means/);
});

test('top fixes lists at most ten groups while all findings lists every group', () => {
  const findings = Array.from({ length: 12 }, (_, i) => makeFinding({ check_id: `seo.c${String(i).padStart(2, '0')}`, title: `Problem ${i}`, severity: 'medium', url: `https://example.test/${i}` }));
  const out = renderHtml(makeRun({ findings }));
  assert.equal(section(out, 'top-fixes').match(/<article class="card/g)?.length, 10);
  assert.equal(section(out, 'findings').match(/<article class="card/g)?.length, 12);
});

test('"no findings" is stated, not hidden', () => {
  const out = renderHtml(makeRun({ findings: [] }));
  assert.match(section(out, 'top-fixes'), /<p>No findings\. Every check that ran passed\.<\/p>/);
  assert.match(section(out, 'findings'), /<p>No findings\.<\/p>/);
});

test('all findings: each check shows its URLs with evidence, selector and line', () => {
  const out = section(renderHtml(makeRun()), 'findings');
  const broken = out.slice(out.indexOf('Broken internal link'));
  assert.match(broken, /<a class="u" href="https:\/\/example\.test\/blog" rel="noopener noreferrer nofollow">https:\/\/example\.test\/blog<\/a><\/div><div class="ev">/);
  assert.match(broken, /<span class="k">Observed<\/span><code>\{&quot;target&quot;:&quot;https:\/\/example\.test\/old-post&quot;,&quot;status&quot;:404\}<\/code>/);
  assert.match(broken, /<span class="k">Selector<\/span><code>a\[href=&quot;\/old-post&quot;\]<\/code><span class="k">Line<\/span>42/);
  assert.match(out, /<li><div>Whole site<\/div><div class="ev"><div><span class="k">Detail<\/span>No sitemap was listed/);
  assert.match(out, /<span class="k">Also<\/span><a class="u" href="https:\/\/example\.test\/services\/b"/);
});

test('all findings: up to maxUrlsPerCheck items and "+N more"', () => {
  const findings = Array.from({ length: 25 }, (_, i) => makeFinding({ url: `https://example.test/p${String(i).padStart(2, '0')}` }));
  const items = (out) => section(out, 'findings').match(/<li>/g)?.length;
  const run = makeRun({ findings });
  assert.equal(items(renderHtml(run)), 10);
  assert.match(renderHtml(run), /<p class="meta">\+15 more findings not shown\.<\/p>/);
  assert.equal(items(renderHtml(run, { maxUrlsPerCheck: 3 })), 3);
  assert.match(renderHtml(run, { maxUrlsPerCheck: 3 }), /\+22 more findings not shown\./);
  assert.equal(items(renderHtml(run, { maxUrlsPerCheck: 25 })), 25);
  assert.ok(!renderHtml(run, { maxUrlsPerCheck: 25 }).includes('more finding'));
  assert.match(renderHtml(makeRun({ findings: findings.slice(0, 2) }), { maxUrlsPerCheck: 1 }), /\+1 more finding not shown\./);
});

test('links: only http and https URLs become links, with rel noopener noreferrer nofollow', () => {
  const urls = ['https://example.test/ok', 'http://example.test/plain', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,<script>alert(1)</script>', 'ftp://example.test/x', '//example.test/x', '/relative', 'not a url'];
  const findings = urls.map((url) => makeFinding({ url, selector: url, doc_ref: url, related_urls: [url] }));
  const out = renderHtml(makeRun({ findings }));
  assertSafeHtml(out);
  const hrefs = [...out.matchAll(/<a [^>]*href="([^"]*)"[^>]*>/g)].map((m) => m[1]);
  assert.ok(hrefs.includes('https://example.test/ok') && hrefs.includes('http://example.test/plain'));
  assert.ok(hrefs.every((href) => /^https?:\/\//.test(href)), hrefs.join(' '));
  for (const text of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'ftp://example.test/x', '/relative', 'not a url']) {
    assert.ok(out.includes(`<span class="u">${text}</span>`), `${text} should be plain text`);
  }
  assert.ok(out.includes('<span class="u">data:text/html,&lt;script&gt;alert(1)&lt;/script&gt;</span>'));
  assert.equal(out.match(/rel="noopener noreferrer nofollow"/g)?.length, out.match(/<a /g)?.length);
});

test('suggestions are labelled as not scored, and only appear when given', () => {
  assert.ok(!renderHtml(makeRun()).includes('Suggestions'));
  assert.ok(!renderHtml(makeRun(), { recommendations: [] }).includes('Suggestions'));
  const out = section(renderHtml(makeRun(), { recommendations: [{ title: 'Rewrite titles', detail: 'Use the brand name.' }, { title: 'Add a sitemap', detail: 'List it in robots.txt.' }] }), 'suggestions');
  assert.match(out, /<h2>Suggestions \(not scored\)<\/h2><p class="note">Written from the findings by the model that ran the audit\./);
  assert.match(out, /<ol class="recs"><li><h3>Rewrite titles<\/h3><p>Use the brand name\.<\/p><\/li><li><h3>Add a sitemap<\/h3>/);
});

test('checks that did not run are listed with reasons, or all checks ran is stated', () => {
  const out = section(renderHtml(makeRun()), 'not-run');
  assert.match(out, /<td><code>links\.orphan\.sitemap_only<\/code><\/td><td>Skipped<\/td><td>Needs a complete crawl\./);
  assert.match(section(renderHtml(makeRun({ checks: [makeCheckStat({ id: 'seo.x', status: 'error', skip_reason: 'Check failed to run: boom' })] })), 'not-run'), /<td>Error<\/td><td>Check failed to run: boom<\/td>/);
  assert.match(section(renderHtml(makeRun({ checks: [makeCheckStat()] })), 'not-run'), /<p>All checks ran\.<\/p>/);
});

test('changes since the previous run: counts, score deltas, lists and caveats', () => {
  const run = makeRun({ run_id: 'now' });
  const base = makeRun({ run_id: 'before', findings: run.findings.slice(3), rules_version: '0.0.9', crawl: { truncated: true } });
  base.modules.seo.score = 70;
  const out = section(renderHtml(run, { comparison: compareRuns(base, run) }), 'changes');
  assert.match(out, /Compared with run <code>before<\/code>\./);
  assert.match(out, /<div class="fig"><b>0<\/b><span>Resolved<\/span><\/div><div class="fig"><b>3<\/b><span>New<\/span><\/div><div class="fig"><b>7<\/b><span>Still present<\/span><\/div>/);
  assert.match(out, /<td>SEO<\/td><td class="n">70<\/td><td class="n">78<\/td><td class="n">\+8<\/td>/);
  assert.match(out, /<h3>New \(3 findings\)<\/h3><ul><li>robots\.txt blocks the whole site \(<code>seo\.robots\.disallow_all<\/code>\): 1<\/li>/);
  assert.match(out, /<div class="warn"><strong>Caveats<\/strong><ul><li>The rules version changed from 0\.0\.9/);
  assert.ok(!out.includes('<h3>Resolved'), 'an empty list is not shown');

  const clean = makeRun({ run_id: 'now', findings: [] });
  const quiet = section(renderHtml(clean, { comparison: compareRuns(makeRun({ run_id: 'before' }), clean) }), 'changes');
  assert.match(quiet, /<h3>Resolved \(10 findings\)<\/h3>/);
  assert.ok(!quiet.includes('Caveats'));
});

test('method: crawl behaviour, confirmed and likely, versions and the no-prediction statement', () => {
  const out = section(renderHtml(makeRun({ plugin_version: '9.9.9', rules_version: '8.8.8' })), 'method');
  assert.match(out, /<strong>How the crawl works\.<\/strong> Seekwide fetches pages one at a time/);
  assert.match(out, /Confirmed means the problem is a measured fact\. Likely means a strong signal/);
  assert.match(out, /Seekwide 9\.9\.9, rules 8\.8\.8/);
  assert.match(out, /does not predict rankings or traffic/);
});

test('footer names the versions, the run and the date', () => {
  assert.match(renderHtml(makeRun({ created_at: '2024-03-05T10:00:00Z', plugin_version: '1.2.3', rules_version: '4.5.6', run_id: 'r-9' })), /<footer>Seekwide 1\.2\.3 &middot; rules 4\.5\.6 &middot; run <code>r-9<\/code> &middot; 2024-03-05<\/footer>/);
});

test('the report says which layers have no data and what the audit does not do', () => {
  const out = renderHtml(makeRun());
  assert.equal(out.match(/No data in this version/g)?.length, 3, 'the three layers this version cannot measure');
  assert.equal(out.match(/No data in this run/g)?.length, 1, 'the experience layer, which this run did not fill');
  assert.match(out, /Not covered: whether the pages are actually indexed\./);
  assert.match(out, /The layers marked &quot;No data&quot; were not measured at all\./);
});

test('the same arguments give byte-identical output, whatever the clock says', (t) => {
  const { run, options } = full();
  const first = renderHtml(structuredClone(run), structuredClone(options));
  t.mock.timers.enable({ apis: ['Date'], now: new Date('1999-01-01T00:00:00Z') });
  const second = renderHtml(structuredClone(run), structuredClone(options));
  t.mock.timers.setTime(new Date('2040-06-06T06:06:06Z').getTime());
  const third = renderHtml(structuredClone(run), structuredClone(options));
  assert.equal(second, first);
  assert.equal(third, first);
  assert.ok(!/1999|2040/.test(first));
});

test('rendering does not change the run or the options', () => {
  const { run, options } = full();
  const copies = structuredClone({ run, options });
  renderHtml(run, options);
  assert.deepEqual({ run, options }, copies);
});

test('a hand-edited severity or confidence cannot add attributes or classes', () => {
  const finding = makeFinding({ severity: /** @type {any} */ ('high" onmouseover="alert(1)'), confidence: /** @type {any} */ ('x" onclick="y') });
  const out = renderHtml(makeRun({ findings: [finding] }));
  assertSafeHtml(out);
  assert.match(out, /<article class="card sev-info">/);
});

for (const payload of PAYLOADS) {
  test(`hostile text in every field cannot inject HTML: ${JSON.stringify(payload).slice(0, 40)}`, () => {
    const { run, options } = hostileInput(payload);
    const out = renderHtml(run, { ...options, logoDataUri: PNG });
    assertSafeHtml(out);
    assert.ok(!/<script/i.test(out));
    assert.ok(!/\son(?:error|load|click|mouseover)\s*=/i.test(parseHtml(out).tags.map((tag) => Object.keys(tag.attrs).join(' ')).join(' ')));
  });
}

test('a single hostile field at a time: each dynamic field is rendered escaped', () => {
  const payload = '"><img src=x onerror=alert(1)>';
  const escaped = '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;';
  const cases = {
    title: (run) => { run.findings[1].title = payload; },
    url: (run) => { run.findings[1].url = payload; },
    selector: (run) => { run.findings[1].selector = payload; },
    observed: (run) => { run.findings[1].evidence.observed = payload; },
    expected: (run) => { run.findings[1].evidence.expected = payload; },
    detail: (run) => { run.findings[1].evidence.detail = payload; },
    related: (run) => { run.findings[1].related_urls = [payload]; run.findings[1].check_id = 'seo.title.duplicate'; },
    recommendation: (run) => { run.findings[1].recommendation = payload; },
    docRef: (run) => { run.findings[1].doc_ref = payload; },
    checkId: (run) => { run.findings[1].check_id = payload; },
    skipReason: (run) => { run.checks[3].skip_reason = payload; },
    checkStatId: (run) => { run.checks[3].id = payload; },
    userAgent: (run) => { run.crawl.user_agent = payload; },
    robots: (run) => { run.crawl.robots_status = payload; },
    blocked: (run) => { run.crawl.blocked = { reason: payload, url: payload, status: 403 }; },
    startUrl: (run) => { run.start_url = payload; },
    siteOrigin: (run) => { run.site_origin = payload; run.start_url = payload; },
    pluginVersion: (run) => { run.plugin_version = payload; },
    rulesVersion: (run) => { run.rules_version = payload; },
    runId: (run) => { run.run_id = payload; },
    createdAt: (run) => { run.created_at = payload; },
    scoreNote: (run) => { run.modules.links.score = null; run.modules.links.note = payload; },
    moduleName: (run) => { run.modules[payload] = { score: 1, coverage: 1, checks_total: 1, checks_run: 1, checks_skipped: 0 }; },
    requested: (run) => { run.modules_requested = [payload]; },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const run = makeRun();
    mutate(run);
    const out = renderHtml(run);
    assertSafeHtml(out);
    assert.ok(out.includes(escaped.slice(0, 20)), `${name} was not rendered`);
  }
  for (const [name, options] of Object.entries({
    summary: { executiveSummary: payload },
    recommendationTitle: { recommendations: [{ title: payload, detail: 'd' }] },
    recommendationDetail: { recommendations: [{ title: 't', detail: payload }] },
    brand: { brandName: payload },
  })) {
    const out = renderHtml(makeRun(), options);
    assertSafeHtml(out);
    assert.ok(out.includes(escaped.slice(0, 20)), `${name} was not rendered`);
  }
});

test('a hostile comparison is escaped too', () => {
  const payload = '<script>alert(1)</script>';
  const run = makeRun({ run_id: 'now', start_url: `https://example.test/${payload}` });
  const base = makeRun({ run_id: payload, rules_version: payload, findings: [makeFinding({ check_id: payload, title: payload })] });
  const out = renderHtml(run, { comparison: compareRuns(base, run) });
  assertSafeHtml(out);
  assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
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

test('Core Web Vitals section: after the scores, with sources, a table of rated values and the legend', () => {
  const out = renderHtml(makeRun({ core_web_vitals: measured() }));
  assert.deepEqual(sectionIds(out), ['summary', 'scope', 'layers', 'scores', 'core-web-vitals', 'top-fixes', 'findings', 'not-run', 'method']);
  assertSafeHtml(out);
  const part = section(out, 'core-web-vitals');
  assert.match(part, /<h2>Core Web Vitals<\/h2>/);
  assert.match(part, /<dt>Lab data<\/dt><dd>PageSpeed Insights tested 2 of 2 pages on an emulated phone\.<\/dd>/);
  assert.match(part, /<dt>Field data<\/dt><dd>The Chrome UX Report has data from real Chrome users on phones for the site as a whole and 1 tested page, collected 2026-10-12 to 2026-11-08\.<\/dd>/);
  assert.deepEqual([...part.matchAll(/<th class="n">([^<]+)<\/th>/g)].map((m) => m[1]), ['LCP (field)', 'INP (field)', 'CLS (field)', 'LCP (lab)', 'CLS (lab)', 'TBT (lab)']);
  const rows = part.slice(0, part.indexOf('</tbody>')).split('<tr>').slice(2).map(textOf).map((row) => row.trim());
  assert.deepEqual(rows, [
    `Whole site ${SITE} 3.140 s Needs improvement 150 ms Good 0.31 Poor — — —`.replace(/—/g, '&mdash;'),
    `${SITE}/ Start page 2.100 s Good 150 ms Good 0.05 Good 4.312 s Poor 0.104 Needs improvement 650 ms Poor`,
    `${SITE}/blog/a One of 3 pages under /blog/ &mdash; &mdash; &mdash; 1.800 s Good 0.02 Good 120 ms Good`,
  ]);
  assert.match(part, /<td class="n">4\.312 s<br><span class="rt rt-poor">Poor<\/span><\/td>/);
  assert.match(part, /<td class="n">3\.140 s<br><span class="rt rt-mid">Needs improvement<\/span><\/td>/);
  assert.match(part, /<td class="n">150 ms<br><span class="rt rt-good">Good<\/span><\/td>/);
  assert.ok(part.includes(`<a class="u" href="${SITE}/blog/a" rel="noopener noreferrer nofollow">${SITE}/blog/a</a>`));
  assert.match(part, /<p class="meta">Field values are the 75th percentile/);
  assert.match(section(out, 'layers'), /<h3>Experience<\/h3><span class="pill">Measured in this run<\/span>/);
  assert.match(section(out, 'method'), /<strong>How Core Web Vitals are measured\.<\/strong>/);
});

test('Core Web Vitals section without a key: lab columns only, with the reason for the missing field data', () => {
  const out = renderHtml(makeRun({ core_web_vitals: labOnly() }));
  const part = section(out, 'core-web-vitals');
  assert.deepEqual([...part.matchAll(/<th class="n">([^<]+)<\/th>/g)].map((m) => m[1]), ['LCP (lab)', 'CLS (lab)', 'TBT (lab)']);
  assert.ok(textOf(part).includes(`Field data ${NO_KEY}`));
  assert.ok(!part.includes('<ul class="meta">'), 'the reason is on the status line, so it is not listed again');
  const noted = section(renderHtml(makeRun({ core_web_vitals: { ...labOnly(), notes: ['PageSpeed Insights tested 1 of 2 pages.'] } })), 'core-web-vitals');
  assert.match(noted, /<ul class="meta"><li>PageSpeed Insights tested 1 of 2 pages\.<\/li><\/ul>/);
  assertSafeHtml(out);
});

test('Core Web Vitals section when Google refused: the reasons and no table', () => {
  const out = renderHtml(makeRun({ core_web_vitals: refused() }));
  const part = section(out, 'core-web-vitals');
  assert.ok(!part.includes('<table'));
  assert.ok(textOf(part).includes(`Lab data ${REFUSED}`));
  assert.match(section(out, 'layers'), /<h3>Experience<\/h3><span class="pill">No data in this run<\/span>/);
  assertSafeHtml(out);
});

test('a run without a measurement has no Core Web Vitals section', () => {
  assert.ok(!sectionIds(renderHtml(makeRun())).includes('core-web-vitals'));
  assert.ok(!sectionIds(renderHtml(makeRun({ core_web_vitals: null }))).includes('core-web-vitals'));
});
