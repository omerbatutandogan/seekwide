/** @import { CheckDef } from '../../types.js' */

import { effectiveCanonicalUrls, isRedirectRecord, isUnverifiable } from '../page-helpers.js';
import { clip } from '../../util/strings.js';
import { DOCS, SEO } from './common.js';

/** @type {CheckDef} */
const missing = {
  ...SEO,
  id: 'seo.sitemap.missing',
  title: 'No XML sitemap found',
  description:
    'Checks whether the site has an XML sitemap, listed in robots.txt or at /sitemap.xml, when the crawl got far enough to look for one. A sitemap helps search engines find pages, especially on large or new sites.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'site',
  requires: [],
  doc_ref: DOCS.SITEMAP_OVERVIEW,
  recommendation:
    'Publish an XML sitemap that lists the pages you want in search results, and add a "Sitemap:" line with its full URL to robots.txt.',
  run(ctx) {
    const { sitemap, robots } = ctx.crawl;
    if (!sitemap.loaded) return [];
    if (sitemap.files.length > 0) return [{ status: 'pass', url: null }];
    return [
      {
        status: 'fail',
        url: null,
        evidence: {
          observed: { sitemap_files: 0, robots_sitemap_lines: robots.sitemaps.length },
          expected: 'At least one XML sitemap',
          detail:
            robots.sitemaps.length === 0
              ? 'robots.txt has no Sitemap line and /sitemap.xml was not found.'
              : 'None of the sitemaps listed in robots.txt could be read.',
        },
      },
    ];
  },
};

/** @type {CheckDef} */
const fileError = {
  ...SEO,
  id: 'seo.sitemap.file_error',
  title: 'Sitemap file cannot be read',
  description:
    'Checks that every sitemap file on the site answers 200 and is a valid XML sitemap or sitemap index. Search engines cannot use a file they cannot fetch or parse.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'site',
  requires: [],
  doc_ref: DOCS.SITEMAP_BUILD,
  recommendation:
    'Make the sitemap URL return 200 with a UTF-8 XML <urlset> or <sitemapindex> document, or remove the reference to it from robots.txt.',
  run(ctx) {
    return ctx.crawl.sitemap.files
      .filter((file) => file.type !== 'external' && file.type !== 'disallowed')
      .map((file) => {
        if (file.type !== 'unreachable' && file.type !== 'invalid') return { status: 'pass', url: file.url };
        return {
          status: 'fail',
          url: file.url,
          evidence: {
            observed: { type: file.type, http_status: file.status },
            expected: 'HTTP 200 with a valid XML sitemap',
            detail:
              file.type === 'unreachable'
                ? file.status === 0
                  ? 'The request for the sitemap got no response.'
                  : `The sitemap answered with HTTP ${file.status}.`
                : `The sitemap content is not a valid XML sitemap${file.error ? `: ${clip(file.error)}` : '.'}`,
          },
        };
      });
  },
};

/** @type {CheckDef} */
const urlNotOk = {
  ...SEO,
  id: 'seo.sitemap.url_not_ok',
  title: 'Sitemap lists a URL that does not answer 200',
  description:
    'Checks that every crawled URL listed in a sitemap answers 200. A sitemap should list only the final, working URLs you want in search results, not redirects or errors.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['sitemap'],
  doc_ref: DOCS.SITEMAP_BUILD,
  recommendation:
    'Replace redirecting URLs in the sitemap with their final URL and remove URLs that return errors.',
  run(ctx) {
    return ctx.pages
      .filter((page) => ctx.sitemapUrls.has(page.url) && (isRedirectRecord(page) || !isUnverifiable(page)))
      .map((page) => {
        if (page.status === 200) return { status: 'pass', url: page.url };
        const redirected = page.final_url !== page.url;
        return {
          status: 'fail',
          url: page.url,
          evidence: {
            observed: redirected ? { status: page.status, final_url: page.final_url } : { status: page.status },
            expected: 200,
            detail:
              page.status === 0
                ? `The request failed${page.fetch_error ? ` (${page.fetch_error})` : ''}.`
                : redirected
                  ? `The URL redirects with HTTP ${page.status} to ${clip(page.final_url)}.`
                  : `The URL answered with HTTP ${page.status}.`,
          },
        };
      });
  },
};

/** @type {CheckDef} */
const urlCanonicalized = {
  ...SEO,
  id: 'seo.sitemap.url_canonicalized',
  title: 'Sitemap lists a page that names another canonical URL',
  description:
    'Checks whether pages listed in a sitemap declare a different URL as canonical. The sitemap should list the canonical URL, so the two signals agree.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['sitemap'],
  doc_ref: DOCS.SITEMAP_BUILD,
  recommendation:
    'List the canonical URL in the sitemap instead of this one, or change the canonical link if this page is the version you want in search results.',
  run(ctx) {
    return ctx.htmlPages
      .filter((page) => ctx.sitemapUrls.has(page.url))
      .map((page) => {
        if (!page.indexability.reasons.includes('canonical_elsewhere')) return { status: 'pass', url: page.url };
        const first = page.canonicals.find((canonical) => canonical.in_head && canonical.url !== null);
        return {
          status: 'fail',
          url: page.url,
          selector: 'link[rel=canonical]',
          line: first?.line ?? null,
          evidence: {
            observed: effectiveCanonicalUrls(page).map((url) => clip(url)),
            expected: page.url,
            detail: 'The page is in the sitemap but its canonical link points to a different URL.',
          },
        };
      });
  },
};

export const sitemapChecks = [missing, fileError, urlNotOk, urlCanonicalized];
