/** @import { CheckDef } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { DOCS, SEO } from './common.js';

/** Mixed-content URLs quoted in evidence; the full count is reported separately. */
const MAX_LISTED = 10;

/** @type {CheckDef} */
const siteNotHttps = {
  ...SEO,
  id: 'seo.https.site_not_https',
  title: 'Site is not served over HTTPS',
  description:
    'Checks whether the audited site ends up on an https:// origin. HTTPS protects the integrity and privacy of the connection between visitors and the site.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 3,
  confidence: 'confirmed',
  scope: 'site',
  requires: [],
  doc_ref: DOCS.HTTPS,
  recommendation:
    'Install a TLS certificate, serve every page over https://, and redirect http:// URLs to their https:// versions with a 301.',
  run(ctx) {
    if (ctx.site.https) return [{ status: 'pass', url: ctx.site.origin }];
    return [
      {
        status: 'fail',
        url: ctx.site.origin,
        evidence: { observed: ctx.site.origin, expected: 'An https:// origin', detail: 'The site is served over plain HTTP.' },
      },
    ];
  },
};

/** @type {CheckDef} */
const notEnforced = {
  ...SEO,
  id: 'seo.https.not_enforced',
  title: 'HTTP version of the site does not redirect to HTTPS',
  description:
    'Requests the http:// version of the start URL and checks that it ends on https://. Without that redirect, visitors and search engines can reach an insecure copy of the site.',
  severity: 'high',
  weight: 4,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'site',
  requires: [],
  doc_ref: DOCS.HTTPS_REDIRECT,
  recommendation:
    'Redirect every http:// request to the same path on https:// with a 301, and consider adding an HSTS header.',
  run(ctx) {
    const probe = ctx.crawl.http_probe;
    if (!ctx.site.https || probe === null) return [];
    if (probe.enforced) return [{ status: 'pass', url: probe.url }];
    return [
      {
        status: 'fail',
        url: probe.url,
        evidence: {
          observed: { status: probe.status, final_url: clip(probe.final_url) },
          expected: 'A redirect that ends on an https:// URL',
          detail: `The http:// request ended on ${clip(probe.final_url)} with HTTP ${probe.status}.`,
        },
      },
    ];
  },
};

/** @type {CheckDef} */
const mixedContent = {
  ...SEO,
  id: 'seo.https.mixed_content',
  title: 'HTTPS page loads resources over HTTP',
  description:
    'Checks https:// pages for images, scripts, stylesheets, frames and media loaded from http:// URLs. Browsers block or warn about this mixed content.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 2,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.MIXED_CONTENT,
  recommendation:
    'Load each listed resource from an https:// URL, or host it on your own site, and update the references in the page.',
  run(ctx) {
    return ctx.htmlPages
      .filter((page) => page.url.startsWith('https://'))
      .map((page) => {
        if (page.mixed_content.length === 0) return { status: 'pass', url: page.url };
        const count = page.mixed_content.length;
        return {
          status: 'fail',
          url: page.url,
          evidence: {
            observed: page.mixed_content.slice(0, MAX_LISTED).map((url) => clip(url)),
            expected: 'Only https:// resources',
            detail:
              count === 1
                ? 'The page loads 1 resource over HTTP.'
                : `The page loads ${count} resources over HTTP${count > MAX_LISTED ? `; the first ${MAX_LISTED} are listed` : ''}.`,
          },
        };
      });
  },
};

export const httpsChecks = [siteNotHttps, notEnforced, mixedContent];
