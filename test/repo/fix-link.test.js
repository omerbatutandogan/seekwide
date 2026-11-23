// Fixes of internal links: a link that goes through a redirect is pointed at
// the final address, a link to a broken page is changed or removed as the
// user decides, and the re-audit says what became of each.

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

import { buildContext, runChecks } from '../../plugin/server/src/checks/engine.js';
import { allChecks } from '../../plugin/server/src/checks/registry.js';
import { FIXABLE_CHECKS, planFixes } from '../../plugin/server/src/repo/fixes.js';
import { loadProjectSources } from '../../plugin/server/src/repo/sources.js';
import { verifyFixes } from '../../plugin/server/src/repo/verify.js';
import { compareRuns } from '../../plugin/server/src/store/compare.js';
import { makeCrawl, makeLink, makePage } from '../helpers/factories.js';
import { HTML_FIXTURE, NEXT_FIXTURE } from '../helpers/repo.js';
import { makeRun } from '../helpers/run-factory.js';

/** @import { CrawlResult, Finding, PageRecord } from '../../plugin/server/src/types.js' */

const SITE = 'https://example.test';
const DEPLOYED = 'https://www.example.com';

/** @param {string} path @param {Partial<PageRecord>} [overrides] */
const page = (path, overrides = {}) => makePage({ url: `${SITE}${path}`, ...overrides });
/** @param {string} path @param {string} to @param {number} [status] */
const redirect = (path, to, status = 301) => page(path, {
  status, final_url: `${SITE}${to}`, final_status: 200, is_html: false, content_type: null, headers: {},
  redirect_chain: [{ url: `${SITE}${path}`, status, location: to }], titles: [], meta_descriptions: [], canonicals: [], headings: [],
});
/** @param {string} path */
const gone = (path) => page(path, { status: 404, final_status: 404, titles: [], canonicals: [], headings: [], indexability: { indexable: false, reasons: ['http_status'] } });
/** @param {string} href @param {number} line @param {string} [text] */
const link = (href, line, text = 'Read more') => makeLink({ href, url: new URL(href, SITE).href, internal: true, line, text });

/**
 * Run the checks on a crawl and give each finding the source file of its page.
 * @param {PageRecord[]} pages
 * @param {Record<string, string>} files  Page path → source file.
 */
function audit(pages, files) {
  const crawl = makeCrawl({ pages });
  const { findings } = runChecks(allChecks(), buildContext(crawl, {}), { detectedAt: '2026-11-24T00:00:00.000Z' });
  const withSource = findings.map((finding) => {
    const path = finding.url === null ? null : new URL(finding.url).pathname;
    return path !== null && Object.hasOwn(files, path) ? { ...finding, source: { file: files[path], line: finding.line, route: path } } : finding;
  });
  return { crawl, findings: withSource, run: makeRun({ findings: withSource, site_origin: SITE, start_url: `${SITE}/` }) };
}

/** @param {Finding[]} findings @param {string} checkId */
const of = (findings, checkId) => findings.filter((finding) => finding.check_id === checkId);

describe('planning internal link fixes in a plain HTML project', () => {
  /** @type {Awaited<ReturnType<typeof loadProjectSources>>} */
  let sources;
  before(async () => {
    sources = await loadProjectSources(HTML_FIXTURE);
  });
  /** @param {ReturnType<typeof audit>} audited @param {{siteUrl?: string|null, crawl?: CrawlResult|null}} [options] */
  const plan = (audited, options = {}) => planFixes({ run: audited.run, sources, crawl: options.crawl === undefined ? audited.crawl : options.crawl, siteUrl: options.siteUrl === undefined ? DEPLOYED : options.siteUrl });

  it('points a link that goes through a permanent redirect at the final address, in the form the href has', () => {
    const audited = audit([
      page('/', { links: [link('/old', 12), link('/old', 30, 'Old page')] }),
      redirect('/old', '/about.html'),
      page('/about.html'),
    ], { '/': 'index.html' });
    const { fixes, notFixable } = plan(audited);
    assert.deepEqual(notFixable.filter((entry) => entry.check_id.startsWith('links.')), []);
    const [fix] = fixes.filter((entry) => entry.type === 'internal_link');
    assert.deepEqual(
      { check_id: fix.check_id, action: fix.action, kind: fix.kind, file: fix.file, line: fix.line, new_href: fix.new_href, temporary: fix.temporary, external: fix.external, needs_site_url: fix.needs_site_url },
      { check_id: 'links.internal.redirect', action: 'retarget', kind: 'html', file: 'index.html', line: 12, new_href: '/about.html', temporary: false, external: false, needs_site_url: false },
    );
    assert.deepEqual(fix.current, { href: '/old', target_url: `${SITE}/old`, status: 301, final_url: `${SITE}/about.html`, final_status: 200, occurrences: 2 });
    assert.match(fix.how, /on line 12\. The page has 2 links with the same href/);
    assert.match(fix.how, /Change its href to new_href/);
    assert.doesNotMatch(fix.how, /\/old|about\.html/);
  });

  it('writes a full URL with the deployed address, never the local server\'s, and asks for the address when it is not known', () => {
    const audited = audit([page('/', { links: [link(`${SITE}/old`, 12)] }), redirect('/old', '/about.html'), page('/about.html')], { '/': 'index.html' });
    assert.equal(plan(audited).fixes.find((fix) => fix.type === 'internal_link')?.new_href, `${DEPLOYED}/about.html`);
    const unknown = plan(audited, { siteUrl: null }).fixes.find((fix) => fix.type === 'internal_link');
    assert.deepEqual([unknown?.new_href, unknown?.needs_site_url], [null, true]);
    assert.match(unknown?.how ?? '', /ask the user for it/);
  });

  it('says when a redirect is temporary, so that the user is asked before the link changes', () => {
    const audited = audit([page('/', { links: [link('/account', 12)] }), redirect('/account', '/account/overview', 302), page('/account/overview')], { '/': 'index.html' });
    const fix = plan(audited).fixes.find((entry) => entry.type === 'internal_link');
    assert.deepEqual([fix?.temporary, fix?.new_href], [true, '/account/overview']);
    assert.match(fix?.how ?? '', /The redirect is temporary .* ask the user whether the page moved for good/);
  });

  it('a link to a broken page gets no new href: the pages it could point to are offered, the closest addresses first', () => {
    const audited = audit([
      page('/', { links: [link('/blog/old-post', 14)] }),
      gone('/blog/old-post'),
      page('/blog/'), page('/blog/new-post'), page('/about.html'), page('/contact.html', { indexability: { indexable: false, reasons: ['noindex_meta'] } }),
    ], { '/': 'index.html' });
    const fix = plan(audited).fixes.find((entry) => entry.check_id === 'links.internal.broken');
    assert.deepEqual([fix?.action, fix?.new_href, fix?.line], ['replace_or_remove', null, 14]);
    assert.deepEqual(fix?.candidates, ['/blog/', '/blog/new-post', '/', '/about.html']);
    assert.match(fix?.how ?? '', /Ask the user what it should point to/);
    assert.match(fix?.how ?? '', /never choose for the user/);
  });

  it('names the other pages with the same link, so that one change in a shared file can be verified for all of them', () => {
    const audited = audit([
      page('/', { links: [link('/gone', 12)] }),
      page('/about.html', { links: [link('/gone', 9)] }),
      gone('/gone'),
    ], { '/': 'index.html', '/about.html': 'about.html' });
    const fixes = plan(audited).fixes.filter((entry) => entry.check_id === 'links.internal.broken');
    assert.deepEqual(fixes.map((fix) => [fix.file, fix.also_on]), [['index.html', [`${SITE}/about.html`]], ['about.html', [`${SITE}/`]]]);
  });

  it('refuses a link fix when the crawl is no longer stored or no longer has the link, instead of trusting the stored run', () => {
    const audited = audit([page('/', { links: [link('/gone', 12)] }), gone('/gone')], { '/': 'index.html' });
    const missingCrawl = plan(audited, { crawl: null }).notFixable.find((entry) => entry.check_id === 'links.internal.broken');
    assert.match(missingCrawl?.reason ?? '', /no longer stored/);
    const otherCrawl = makeCrawl({ pages: [page('/', { links: [link('/elsewhere', 12)] }), page('/elsewhere')] });
    const missingLink = plan(audited, { crawl: otherCrawl }).notFixable.find((entry) => entry.check_id === 'links.internal.broken');
    assert.match(missingLink?.reason ?? '', /no link on this page that matches the finding/);
  });
});

describe('planning internal link fixes in a Next.js project', () => {
  it('names the page file and its layouts, and says the link may be in a shared component or built from data', async () => {
    const sources = await loadProjectSources(NEXT_FIXTURE);
    const audited = audit([page('/', { links: [link('/docs/start', 0)] }), redirect('/docs/start', '/docs/getting-started', 308), page('/docs/getting-started')], { '/': 'app/page.jsx' });
    const fix = planFixes({ run: audited.run, sources, crawl: audited.crawl, siteUrl: DEPLOYED }).fixes.find((entry) => entry.type === 'internal_link');
    assert.deepEqual([fix?.kind, fix?.file, fix?.line, fix?.layouts, fix?.new_href], ['next-app', 'app/page.jsx', null, ['app/layout.jsx'], '/docs/getting-started']);
    assert.match(fix?.how ?? '', /in a component they import/);
    assert.match(fix?.how ?? '', /built from data/);
  });
});

describe('verifying internal link fixes', () => {
  /** @param {ReturnType<typeof audit>} before @param {PageRecord[]} pages */
  function reaudit(before, pages) {
    const after = audit(pages, {});
    const run = makeRun({ run_id: 'after', findings: after.findings, checks: runChecks(allChecks(), buildContext(after.crawl, {}), { detectedAt: '2026-11-24T00:00:00.000Z' }).checks });
    const base = { ...before.run, run_id: 'base' };
    const ids = before.findings.filter((finding) => Object.hasOwn(FIXABLE_CHECKS, finding.check_id) && FIXABLE_CHECKS[finding.check_id].unit === 'link').map((finding) => finding.id);
    return verifyFixes({ base, run, crawl: after.crawl, findingIds: ids, comparison: compareRuns(base, run) }).verification.results;
  }
  const original = () => audit([page('/', { links: [link('/old', 12)] }), redirect('/old', '/new'), page('/new')], {});

  it('closed: the page was crawled again and links straight to the final address', () => {
    const [result] = reaudit(original(), [page('/', { links: [link('/new', 12)] }), page('/new')]);
    assert.deepEqual([result.check_id, result.outcome], ['links.internal.redirect', 'closed']);
  });

  it('open: the page still links through the redirect', () => {
    const [result] = reaudit(original(), [page('/', { links: [link('/old', 12)] }), redirect('/old', '/new'), page('/new')]);
    assert.equal(result.outcome, 'open');
  });

  it('unverified: the page still has the link, but the address it points to was not crawled', () => {
    const [result] = reaudit(original(), [page('/', { links: [link('/old', 12)] })]);
    assert.equal(result.outcome, 'unverified');
    assert.match(result.detail, /did not crawl the address it points to/);
  });

  it('replaced: the link now points to a page that is broken', () => {
    const [result] = reaudit(original(), [page('/', { links: [link('/nowhere', 12)] }), gone('/nowhere')]);
    assert.deepEqual([result.outcome, result.replaced_by.map((entry) => entry.check_id)], ['replaced', ['links.internal.broken']]);
  });

  it('the link checks look at one unit per link target of a page, which the re-audit relies on', () => {
    const crawl = makeCrawl({ pages: [page('/', { links: [link('/a', 1), link('/a', 2), link('/b', 3)] }), page('/a'), page('/b'), page('/none')] });
    const { checks } = runChecks(allChecks(), buildContext(crawl, {}), { detectedAt: '2026-11-24T00:00:00.000Z' });
    for (const id of Object.keys(FIXABLE_CHECKS).filter((key) => FIXABLE_CHECKS[key].unit === 'link')) {
      assert.equal(checks.find((check) => check.id === id)?.applicable, 2, id);
    }
  });
});
