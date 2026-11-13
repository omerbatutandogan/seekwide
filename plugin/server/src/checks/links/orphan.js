/** @import { CheckDef, CheckResult } from '../../types.js' */

import { isInternalUrl } from '../../util/url.js';

/** @type {CheckDef} */
const sitemapOnly = {
  id: 'links.orphan.sitemap_only',
  module: 'links',
  engine: 'code',
  title: 'Sitemap URL that no page links to',
  description:
    'Looks at internal URLs listed in the XML sitemap and checks whether any other crawled page links to them, directly or through a redirect. Google advises that every page you care about has a link from at least one other page on your site.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 2,
  confidence: 'likely',
  scope: 'site',
  requires: ['full_crawl', 'sitemap'],
  doc_ref: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable',
  last_verified: '2026-11-11',
  recommendation:
    'Link to the page from a related page, such as a category, hub or article page. If the page is no longer wanted, remove it from the sitemap.',
  run(ctx) {
    const { crawl } = ctx;

    // A link to a redirect counts as a link to the redirect's destination.
    // A link from a page to itself, directly or through a redirect, does not count.
    /** @type {Set<string>} */
    const linked = new Set();
    for (const [target, refs] of ctx.inlinks) {
      const destination = ctx.resolve(target)?.url;
      for (const { from } of refs) {
        if (target !== from) linked.add(target);
        if (destination !== undefined && destination !== from) linked.add(destination);
      }
    }

    const startPageUrl = ctx.resolve(crawl.start_url)?.url;
    /** @type {CheckResult[]} */
    const results = [];
    for (const url of ctx.sitemapUrls) {
      if (url === crawl.start_url || url === startPageUrl) continue;
      if (!isInternalUrl(url, ctx.site.host, crawl.options.include_subdomains)) continue;
      if (linked.has(url)) {
        results.push({ status: 'pass', url });
        continue;
      }
      results.push({
        status: 'fail',
        url,
        evidence: {
          observed: { links_from_pages: 0, pages_checked: ctx.htmlPages.length },
          expected: 'At least one link from another crawled page',
          detail: `The URL is in the sitemap, but none of the ${ctx.htmlPages.length} crawled HTML pages link to it from another page, directly or through a redirect.`,
        },
      });
    }
    return results;
  },
};

/** The orphan-page checks. */
export const orphanChecks = [sitemapOnly];
