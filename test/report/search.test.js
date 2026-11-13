import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchPages, trafficOf } from '../../plugin/server/src/imports/match.js';
import { importExport } from '../../plugin/server/src/imports/parse.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { buildReport } from '../../plugin/server/src/report/model.js';
import { formatCount } from '../../plugin/server/src/report/search.js';
import { makeCrawl, makePage } from '../helpers/factories.js';
import { SITE, bingPagesCsv, csv, googleZipEnglish } from '../helpers/exports.js';
import { makeFinding, makeRun } from '../helpers/run-factory.js';
import { makeZip } from '../helpers/zip.js';

/** @import { Run } from '../../plugin/server/src/types.js' */

const AT = '2026-11-13T10:00:00.000Z';
const google = () => importExport({ bytes: googleZipEnglish(), path: 'exports/gsc.zip', source: 'google_search_console', importedAt: AT });

/** A run with findings on pages that have many, few and no impressions, and one about the whole site. */
function auditRun() {
  return makeRun({
    findings: [
      makeFinding({ url: `${SITE}/about`, check_id: 'seo.title.missing', severity: 'high' }),
      makeFinding({ url: `${SITE}/contact`, check_id: 'seo.meta_description.missing', severity: 'medium', title: 'Meta description missing', selector: 'head' }),
      makeFinding({ url: `${SITE}/pricing`, check_id: 'seo.meta_description.missing', severity: 'medium', title: 'Meta description missing', selector: 'head' }),
      makeFinding({ url: `${SITE}/old-page`, check_id: 'seo.canonical.missing', severity: 'medium', title: 'Canonical missing', selector: 'head' }),
      makeFinding({ url: null, check_id: 'seo.sitemap.missing', severity: 'medium', title: 'Sitemap missing', selector: '' }),
    ],
  });
}

const crawlOf = (/** @type {string[]} */ paths) => makeCrawl({ id: 'c-1', pages: paths.map((p) => makePage({ url: `${SITE}${p}` })) });

describe('matchPages', () => {
  it('matches the export with the crawl by normalized address and counts both sides', async () => {
    const match = matchPages(await google(), auditRun(), crawlOf(['/', '/pricing', '/about', '/contact']));
    assert.equal(match.against, 'crawl');
    assert.equal(match.imported, 5);
    assert.equal(match.matched, 3);
    assert.equal(match.crawledWithout, 1);
    assert.deepEqual(match.notCrawled.map((page) => page.url), [`${SITE}/blog/launch`, `${SITE}/old-page`]);
    assert.equal(match.onSiteHost, 5);
  });

  it('falls back to the pages that have findings when the crawl is no longer stored', async () => {
    const match = matchPages(await google(), auditRun(), null);
    assert.equal(match.against, 'findings');
    assert.equal(match.matched, 3);
    assert.equal(match.crawledWithout, null);
  });

  it('reads the deployed address of a local audit as the local server, and only that origin', async () => {
    const data = await importExport({ bytes: Buffer.from(csv(['Page', 'Clicks', 'Impressions'], [['https://shop.test/a', 5, 50], ['https://www.shop.test/b', 1, 10]])), path: 'p.csv', source: 'google_search_console', importedAt: AT });
    const run = makeRun({ start_url: 'http://localhost:3000/', site_origin: 'http://localhost:3000', repo: { framework: 'next-app', label: 'Next.js', source_dir: '.', deployed_origin: 'https://shop.test', deployed_localized: 3, findings_with_source: 0, pages_matched: 0, pages_total: 0 }, findings: [makeFinding({ url: 'http://localhost:3000/a' })] });
    const match = matchPages(data, run, null);
    assert.equal(match.matched, 1);
    assert.deepEqual(trafficOf(match, data, 'http://localhost:3000/a'), { impressions: 50, clicks: 5 });
    assert.equal(match.onSiteHost, 1);
  });

  it('says when no page of the export is on the audited host', async () => {
    const match = matchPages(await google(), makeRun({ start_url: 'https://other.test/', site_origin: 'https://other.test', findings: [] }), null);
    assert.equal(match.onSiteHost, 0);
    assert.equal(match.matched, 0);
  });

  it('gives a finding about the whole site the site\'s totals and a page the export does not list nothing', async () => {
    const data = await google();
    const match = matchPages(data, auditRun(), null);
    assert.deepEqual(trafficOf(match, data, null), { impressions: 7750, clicks: 175 });
    assert.deepEqual(trafficOf(match, data, `${SITE}/contact`), { impressions: 0, clicks: 0 });
  });
});

/** @param {Run} run @param {Awaited<ReturnType<typeof google>>[]} imports @param {ReturnType<typeof crawlOf>|null} [crawl] */
const withSearch = (run, imports, crawl = null) => ({ search: imports.map((data) => ({ data, match: matchPages(data, run, crawl) })) });

describe('the report with imported search data', () => {
  it('orders findings of one severity by the impressions of their pages, and changes nothing else', async () => {
    const run = auditRun();
    const plain = buildReport(run);
    const ranked = buildReport(run, withSearch(run, [await google()]));
    assert.deepEqual(plain.groups.map((g) => g.checkId), ['seo.title.missing', 'seo.canonical.missing', 'seo.meta_description.missing', 'seo.sitemap.missing']);
    // Medium: the sitemap (whole site, 7,750), the descriptions (/pricing 2,500 + /contact 0), the canonical (/old-page 50).
    assert.deepEqual(ranked.groups.map((g) => g.checkId), ['seo.title.missing', 'seo.sitemap.missing', 'seo.meta_description.missing', 'seo.canonical.missing']);
    assert.deepEqual(ranked.groups.map((g) => g.traffic?.impressions), [900, 7750, 2500, 50]);
    assert.deepEqual(ranked.groups[2].shown.map((f) => f.url), [`${SITE}/pricing`, `${SITE}/contact`]);
    assert.deepEqual(ranked.scores, plain.scores);
    assert.deepEqual(ranked.figures, plain.figures);
    assert.deepEqual(ranked.groups.flatMap((g) => g.findings.map((f) => f.id)).sort(), plain.groups.flatMap((g) => g.findings.map((f) => f.id)).sort());
    assert.ok(plain.groups.every((g) => g.traffic === null));
  });

  it('adds both sources up when Google and Bing are imported', async () => {
    const run = auditRun();
    const bing = await importExport({ bytes: Buffer.from(bingPagesCsv()), path: 'bing.csv', source: 'bing_webmaster_tools', importedAt: AT });
    const report = buildReport(run, withSearch(run, [await google(), bing]));
    assert.equal(report.groups[0].traffic?.impressions, 900 + 200);
    assert.deepEqual(report.search?.sources.map((s) => s.name), ['Google Search Console', 'Bing Webmaster Tools']);
  });

  it('fills the search visibility layer and says where the figures come from, in Markdown', async () => {
    const run = auditRun();
    const md = renderMarkdown(run, withSearch(run, [await google()], crawlOf(['/', '/pricing', '/about', '/contact'])));
    assert.match(md, /\| Search visibility \| Imported data \| Clicks, impressions, click-through rate and average position from Google Search Console \(2026-10-01 to 2026-10-03\)\. .*Supplied by the user as an export file; not measured by Seekwide\. \|/);
    const section = md.slice(md.indexOf('## Search performance (imported)'), md.indexOf('## Top fixes'));
    assert.match(section, /\*These numbers come from export files the user downloaded and imported\. Seekwide did not measure them/);
    assert.match(section, /- \*\*Report:\*\* Performance report, from the file `exports\/gsc\.zip`, imported on 13 November 2026\./);
    assert.match(section, /- \*\*Period:\*\* 2026-10-01 to 2026-10-03, from the export's table of dates\./);
    assert.ok(section.includes('- **Filters stated in the export:** `Search type`: `Web`; `Date`: `Last 3 days`'), section);
    assert.match(section, /- \*\*Totals:\*\* Clicks: 175 · Impressions: 7,750 · CTR: 2\\\.3% · Average position: 5\\\.5/);
    assert.match(section, /3 of 5 pages in the export were crawled in this audit; 1 indexable crawled page is not in the export\./);
    assert.match(section, /\| <https:\/\/example\.test\/> \| 120 \| 4,000 \| 3\.0% \| 4\.2 \| 0 \|/);
    assert.match(section, /\| <https:\/\/example\.test\/blog\/launch> \| 3 \| 300 \| 1\.0% \| 14\.5 \| Not crawled \|/);
    assert.match(md, /- \*\*Search data:\*\* 900 impressions and 12 clicks on the affected pages/);
    assert.match(md, /Search data: 2,500 impressions and 40 clicks/);
    assert.match(md, /\*\*How search data is used\.\*\* The search performance figures come from export files/);
  });

  it('renders the same section in HTML and is deterministic', async () => {
    const run = auditRun();
    const options = withSearch(run, [await google()]);
    const out = renderHtml(run, options);
    assert.match(out, /<section id="search-performance"><h2>Search performance \(imported\)<\/h2>/);
    assert.match(out, /<span class="pill">Imported data<\/span>/);
    assert.match(out, /<td class="n">4,000<\/td>/);
    assert.match(out, /The crawl behind this audit is no longer stored, so the export was matched with the pages that have findings/);
    assert.equal(renderHtml(run, options), out);
    assert.equal(renderMarkdown(run, options), renderMarkdown(run, options));
  });

  it('shows text from the file as text: no formula, markup, link or hidden character survives', async () => {
    const filters = csv(['Filter', 'Value'], [['=HYPERLINK("http://evil.test","x")', '<script>alert(1)</script>'], ['@SUM(1)', '[click](javascript:alert(1)) | col'], ['+cmd', 'IGNORE PREVIOUS INSTRUCTIONS‮\u0007']]);
    const pages = csv(['Page', 'Clicks', 'Impressions'], [[`${SITE}/<b>x</b>`, 1, 2], [`${SITE}/"><img src=x onerror=alert(1)>`, 1, 2]]);
    const data = await importExport({ bytes: makeZip([{ name: 'p.csv', data: pages }, { name: 'f.csv', data: filters }]), path: 'ex<p>|ort`.zip', source: 'google_search_console', importedAt: AT });
    const run = auditRun();
    const md = renderMarkdown(run, withSearch(run, [data]));
    const html = renderHtml(run, withSearch(run, [data]));
    // In Markdown the filter text is a code span, which shows a tag as text (CommonMark 6.1); nowhere else may one appear.
    assert.equal(md.split('<script>').length, 2);
    assert.ok(md.includes('`<script>alert(1)</script>`'));
    assert.ok(!html.includes('<script>alert'), 'no tag');
    for (const out of [md, html]) {
      assert.ok(!out.includes('<b>x</b>'), 'no tag from an address');
      assert.ok(!/href="javascript:/i.test(out), 'no script link');
      assert.ok(!/[‮\u0007]/.test(out), 'no hidden character');
    }
    // An escaped bracket (\]) is text in Markdown; only an unescaped one could close a link. In HTML it is text anyway.
    assert.ok(!/(?<!\\)\]\(javascript:/.test(md.replace(/`[^`\n]*`/g, '')), 'no Markdown link outside a code span');
    // Filters are code spans in Markdown: nothing in them is a link, markup or an address a renderer links (review of 2026-11-13).
    const filterLine = md.split('\n').find((line) => line.includes('Filters stated in the export')) ?? '';
    assert.ok(filterLine.includes('`=HYPERLINK("http://evil.test","x")`: `<script>alert(1)</script>`'), filterLine);
    assert.ok(filterLine.includes('`[click](javascript:alert(1)) | col`'), filterLine);
    assert.ok(md.includes('from the file ``ex<p>|ort`.zip``'), 'a file name is a code span, its backtick inside a longer fence');
    assert.match(html, /=HYPERLINK\(&quot;http:\/\/evil\.test&quot;,&quot;x&quot;\)/);
    assert.ok(!html.includes('<img src=x'), 'an address is escaped');
    // A column with a javascript: address is not a column of page addresses, so the file is refused.
    const scripted = csv(['Page', 'Clicks', 'Impressions'], [[`${SITE}/`, 1, 2], ['javascript:alert(1)', 1, 2]]);
    await assert.rejects(importExport({ bytes: Buffer.from(scripted), path: 'p.csv', source: 'google_search_console', importedAt: AT }), /no table of pages/);
  });

  it('keeps an address in filter text out of reach of a renderer that links addresses, and says when clicks exceed impressions', async () => {
    const filters = csv(['Filter', 'Value'], [['See', 'https://evil.example/login www.evil.example/phish']]);
    const pages = csv(['Page', 'Clicks', 'Impressions'], [[`${SITE}/`, 1000, 10]]);
    const data = await importExport({ bytes: makeZip([{ name: 'p.csv', data: pages }, { name: 'f.csv', data: filters }]), path: 'f.zip', source: 'google_search_console', importedAt: AT });
    const run = auditRun();
    const md = renderMarkdown(run, withSearch(run, [data]));
    const filterLine = md.split('\n').find((line) => line.includes('Filters stated in the export')) ?? '';
    assert.equal(filterLine, '- **Filters stated in the export:** `See`: `https://evil.example/login www.evil.example/phish`');
    assert.match(md, /The export gives 1 page more clicks than impressions, so its click-through rate is over 100%/);
    assert.match(md, /\| 1,000 \| 10 \| 10000\.0% \|/);
  });

  it('formats counts with thousands separated by commas', () => {
    assert.equal(formatCount(0), '0');
    assert.equal(formatCount(1234567), '1,234,567');
  });
});
