/** @import { CheckDef, PageRecord } from '../../types.js' */

import { isNoindex } from '../page-helpers.js';
import { clip } from '../../util/strings.js';
import { DOCS, SEO } from './common.js';

/**
 * Where the noindex instruction was found, for evidence.
 * @param {PageRecord} page
 * @returns {{meta_robots: string[], x_robots: string[]}}
 */
function noindexSources(page) {
  return { meta_robots: page.meta_robots.map((token) => clip(token)), x_robots: page.x_robots.map((token) => clip(token)) };
}

/**
 * @param {PageRecord} page
 * @returns {string}
 */
function noindexDetail(page) {
  const { reasons } = page.indexability;
  if (reasons.includes('noindex_meta') && reasons.includes('noindex_header')) {
    return 'Both a robots meta tag and an X-Robots-Tag header tell search engines not to index the page.';
  }
  if (reasons.includes('noindex_meta')) return 'A robots meta tag tells search engines not to index the page.';
  return 'An X-Robots-Tag header tells search engines not to index the page.';
}

/**
 * A failed result for a noindex page. When the noindex comes only from an
 * `X-Robots-Tag` line that gives Bing's `ai-training:` or `ai-grounding:`
 * first, Google's reading is not documented, so the finding is `likely` and says why.
 * @param {PageRecord} page
 * @returns {import('../../types.js').CheckResult}
 */
function noindexFailure(page) {
  // Likely only when every noindex of the header is one Google's reading is unclear for, and the meta tag gives none.
  const noindex = (/** @type {string[]} */ tokens) => tokens.filter((token) => token === 'noindex' || token === 'none').length;
  const unclear = !page.indexability.reasons.includes('noindex_meta') && noindex(page.x_robots_unclear ?? []) > 0
    && noindex(page.x_robots_unclear ?? []) >= noindex(page.x_robots);
  return {
    status: 'fail',
    url: page.url,
    ...(unclear ? { confidence: /** @type {const} */ ('likely') } : {}),
    evidence: {
      observed: noindexSources(page),
      expected: 'No noindex or none directive',
      detail: unclear
        ? `${noindexDetail(page)} The header line gives Bing's ai-training or ai-grounding directive first; Bing documents those as directives, Google documents nothing about them and might read the name as a user agent the noindex is meant for, so whether Google applies it is not certain.`
        : noindexDetail(page),
    },
  };
}

/** @type {CheckDef} */
const homepageNoindex = {
  ...SEO,
  id: 'seo.indexing.homepage_noindex',
  title: 'Home page is set to noindex',
  description:
    'Checks whether the start page carries a noindex rule in a robots meta tag or an X-Robots-Tag header. Google drops noindex pages from its search results.',
  severity: 'critical',
  weight: 5,
  impact: 3,
  effort: 1,
  confidence: 'confirmed',
  scope: 'site',
  requires: [],
  doc_ref: DOCS.NOINDEX,
  recommendation:
    'Remove "noindex" (and "none") from the robots meta tag and the X-Robots-Tag header of the home page.',
  run(ctx) {
    const start = ctx.resolve(ctx.crawl.start_url);
    if (!start || start.status !== 200 || !start.is_html) return [];
    if (!isNoindex(start)) return [{ status: 'pass', url: start.url }];
    return [noindexFailure(start)];
  },
};

/** @type {CheckDef} */
const noindexInSitemap = {
  ...SEO,
  id: 'seo.indexing.noindex_in_sitemap',
  title: 'Sitemap lists a noindex page',
  description:
    'Checks whether pages listed in a sitemap carry a noindex rule. A sitemap should list only pages you want in search results, so the two signals contradict each other.',
  severity: 'high',
  weight: 4,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['sitemap'],
  doc_ref: DOCS.SITEMAP_BUILD,
  recommendation:
    'Remove the page from the sitemap if it should stay out of search results; otherwise remove the noindex rule from the page.',
  run(ctx) {
    return ctx.htmlPages
      .filter((page) => ctx.sitemapUrls.has(page.url))
      .map((page) => {
        if (!isNoindex(page)) return { status: 'pass', url: page.url };
        return noindexFailure(page);
      });
  },
};

export const indexingChecks = [homepageNoindex, noindexInSitemap];
