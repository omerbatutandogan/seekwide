// Builders for `Run` objects (plugin/server/src/types.js) that look like real audit
// output, for tests of storage, reports and tools.

/** @import { CheckStat, Finding, ModuleScore, Run } from '../../plugin/server/src/types.js' */

import { RULES_VERSION, SCHEMA_VERSION } from '../../plugin/server/src/config.js';
import { shortId } from '../../plugin/server/src/util/hash.js';

const SITE = 'https://example.test';
const CREATED_AT = '2026-11-11T14:03:22.000Z';

/**
 * One failing finding. By default: a page whose title is missing. The id is
 * derived from the check id, URL and selector, as the engine does.
 * @param {Partial<Finding>} [overrides]
 * @returns {Finding}
 */
export function makeFinding(overrides = {}) {
  const checkId = overrides.check_id ?? 'seo.title.missing';
  const url = overrides.url === undefined ? `${SITE}/about` : overrides.url;
  const selector = overrides.selector === undefined ? 'head > title' : overrides.selector;
  return {
    id: shortId(checkId, url ?? '', selector ?? ''),
    check_id: checkId,
    module: checkId.split('.')[0],
    engine: 'code',
    title: 'Title missing',
    severity: 'high',
    weight: 4,
    impact: 3,
    effort: 1,
    confidence: 'confirmed',
    status: 'fail',
    url,
    selector,
    line: null,
    evidence: { observed: 'No <title> element with text', expected: 'One <title> with text' },
    related_urls: [],
    recommendation: 'Add a unique, descriptive title element to the head of the page.',
    fix: null,
    doc_ref: 'https://developers.google.com/search/docs/appearance/title-link',
    detected_at: CREATED_AT,
    ...overrides,
  };
}

/**
 * @param {Partial<CheckStat>} [overrides]
 * @returns {CheckStat}
 */
export function makeCheckStat(overrides = {}) {
  return { id: 'seo.title.missing', module: 'seo', status: 'run', skip_reason: null, applicable: 20, passed: 17, failed: 3, ...overrides };
}

/**
 * Findings across both modules and several severities, including a site-level
 * finding (no URL), a weight-0 info finding and one with related URLs.
 * @returns {Finding[]}
 */
export function makeFindings() {
  return [
    makeFinding({ check_id: 'seo.robots.disallow_all', title: 'robots.txt blocks the whole site', severity: 'critical', weight: 5, impact: 3, effort: 1, url: `${SITE}/robots.txt`, selector: null, evidence: { observed: 'User-agent: *\nDisallow: /' }, recommendation: 'Remove the blanket Disallow rule from robots.txt.', doc_ref: 'https://developers.google.com/search/docs/crawling-indexing/robots/intro' }),
    makeFinding({ url: `${SITE}/about` }),
    makeFinding({ url: `${SITE}/contact` }),
    makeFinding({ url: `${SITE}/pricing` }),
    makeFinding({ check_id: 'links.internal.broken', title: 'Broken internal link', severity: 'high', impact: 3, effort: 2, url: `${SITE}/blog`, selector: 'a[href="/old-post"]', line: 42, evidence: { observed: { target: `${SITE}/old-post`, status: 404 }, expected: 'A link to a page that answers 200' }, recommendation: 'Update or remove the link, or restore the target page.', doc_ref: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable' }),
    makeFinding({ check_id: 'links.internal.broken', title: 'Broken internal link', severity: 'high', impact: 3, effort: 2, url: `${SITE}/blog/post-1`, selector: 'a[href="/gone"]', line: 17, evidence: { observed: { target: `${SITE}/gone`, status: 410 } }, recommendation: 'Update or remove the link, or restore the target page.', doc_ref: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable' }),
    makeFinding({ check_id: 'seo.title.duplicate', title: 'Duplicate title', severity: 'medium', weight: 3, impact: 2, effort: 1, url: `${SITE}/services/a`, selector: 'head > title', evidence: { observed: 'Our services', detail: 'Two pages share this title.' }, related_urls: [`${SITE}/services/b`], recommendation: 'Give each page a title of its own.' }),
    makeFinding({ check_id: 'seo.meta_description.missing', title: 'Meta description missing', severity: 'low', weight: 2, impact: 2, effort: 1, url: `${SITE}/about`, selector: 'meta[name=description]', evidence: { observed: 'No meta description' }, recommendation: 'Write a meta description that summarizes the page.', doc_ref: 'https://developers.google.com/search/docs/appearance/snippet' }),
    makeFinding({ check_id: 'seo.sitemap.missing', title: 'No XML sitemap found', severity: 'low', weight: 1, impact: 1, effort: 2, confidence: 'confirmed', url: null, selector: null, evidence: { detail: 'No sitemap was listed in robots.txt or found at /sitemap.xml.' }, recommendation: 'Publish an XML sitemap and reference it in robots.txt.', doc_ref: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview' }),
    makeFinding({ check_id: 'seo.title.too_long', title: 'Title may be cut off in results', severity: 'info', weight: 0, impact: 1, effort: 1, confidence: 'likely', url: `${SITE}/blog/post-1`, selector: 'head > title', evidence: { observed: { characters: 91, estimated_px: 702 }, expected: '580 px or less' }, recommendation: 'Shorten the title so the important words come first.' }),
  ];
}

/**
 * A complete run of the SEO and links modules on https://example.test with a
 * realistic mix of findings, scores and checks (two of them skipped).
 * Top-level fields in `overrides` replace the defaults; `crawl` is merged field by field.
 * @param {Partial<Omit<Run, 'crawl'>> & {crawl?: Partial<Run['crawl']>}} [overrides]
 * @returns {Run}
 */
export function makeRun(overrides = {}) {
  const { crawl, ...rest } = overrides;
  /** @type {Record<string, ModuleScore>} */
  const modules = {
    seo: { score: 78, coverage: 0.94, checks_total: 34, checks_run: 32, checks_skipped: 2, note: null },
    links: { score: 88, coverage: 0.8, checks_total: 10, checks_run: 8, checks_skipped: 2, note: null },
  };
  return {
    schema_version: SCHEMA_VERSION,
    rules_version: RULES_VERSION,
    plugin_version: '0.1.0-alpha.1',
    run_id: '2026-11-11T14-03-22Z',
    created_at: CREATED_AT,
    start_url: `${SITE}/`,
    site_origin: SITE,
    crawl: {
      id: 'c-20261111T140250Z-a1b2c3',
      pages_crawled: 25,
      html_pages: 23,
      indexable_pages: 21,
      unreadable_pages: 0,
      truncated: false,
      blocked: null,
      robots_status: 'ok',
      sitemap_urls: 24,
      max_pages: 25,
      user_agent: 'seekwide/0.1.0-alpha.1 (+https://github.com/omerbatutandogan/seekwide)',
      ...crawl,
    },
    modules_requested: ['seo', 'links'],
    modules,
    checks: [
      makeCheckStat(),
      makeCheckStat({ id: 'seo.title.duplicate', applicable: 20, passed: 18, failed: 2 }),
      makeCheckStat({ id: 'links.internal.broken', module: 'links', applicable: 60, passed: 58, failed: 2 }),
      makeCheckStat({ id: 'links.orphan.sitemap_only', module: 'links', status: 'skipped', skip_reason: 'Needs a complete crawl. This crawl stopped at the page limit or was blocked.', applicable: 0, passed: 0, failed: 0 }),
      makeCheckStat({ id: 'links.outbound.broken', module: 'links', status: 'skipped', skip_reason: 'Needs external link checks. They were not run.', applicable: 0, passed: 0, failed: 0 }),
    ],
    findings: makeFindings(),
    ...rest,
  };
}
