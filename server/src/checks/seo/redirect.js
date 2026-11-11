/** @import { CheckDef } from '../../types.js' */

import { LIMITS } from '../../config.js';
import { isRedirectRecord, isUnverifiable } from '../page-helpers.js';
import { clip } from '../../util/strings.js';
import { DOCS, SEO } from './common.js';

/** @type {CheckDef} */
const chain = {
  ...SEO,
  id: 'seo.redirect.chain',
  title: 'Redirect goes through more than one hop',
  description:
    'Checks redirecting URLs for chains of two or more redirects. Each hop adds latency, and Google advises redirecting straight to the final destination.',
  severity: 'medium',
  weight: 2,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.REDIRECT_CHAINS,
  recommendation:
    'Point the first redirect directly at the final URL, and update internal links to use the final URL.',
  run(ctx) {
    return ctx.pages.filter(isRedirectRecord).map((page) => {
      const hops = page.redirect_chain.length;
      if (hops < 2) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        evidence: {
          observed: { hops, chain: page.redirect_chain.map((hop) => `${hop.status} ${clip(hop.url)}`) },
          expected: 'One redirect to the final URL',
          detail: `The URL passes through ${hops} redirects before reaching ${clip(page.final_url)}.`,
        },
      };
    });
  },
};

/** @type {CheckDef} */
const broken = {
  ...SEO,
  id: 'seo.redirect.broken',
  title: 'Redirect does not end on a working page',
  description:
    `Checks redirecting URLs for loops, chains of more than ${LIMITS.maxRedirects} hops, failed requests and error pages at the end of the chain. Search engines and visitors cannot reach content through such a redirect. Redirects that leave the site, or end where the crawler was refused, are not counted here.`,
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.HTTP_STATUS,
  recommendation:
    'Point the redirect at a URL that returns 200, or return 404 or 410 from the original URL if the content is gone.',
  run(ctx) {
    // A chain that leaves the site is checked with the external links; one that ends where the
    // crawler was refused says nothing about the site.
    const units = ctx.pages.filter((page) => isRedirectRecord(page) && !page.final_external && !isUnverifiable(page));
    return units.map((page) => {
      if (page.fetch_error === null && page.final_status < 400) return { status: 'pass', url: page.url };
      let detail;
      if (page.fetch_error === 'redirect_loop') detail = 'The redirects form a loop.';
      else if (page.fetch_error === 'too_many_redirects') detail = `The chain has more than ${LIMITS.maxRedirects} redirects, the most Googlebot follows.`;
      else if (page.fetch_error === 'invalid_url') detail = 'A redirect in the chain has no Location or points to a URL that is not http or https.';
      else if (page.fetch_error !== null) detail = `The request to ${clip(page.final_url)} at the end of the chain failed (${page.fetch_error}).`;
      else detail = `The redirect ends on ${clip(page.final_url)}, which answers HTTP ${page.final_status}.`;
      return {
        status: 'fail',
        url: page.url,
        evidence: {
          observed: { final_url: clip(page.final_url), final_status: page.final_status, fetch_error: page.fetch_error },
          expected: 'A redirect that ends on a URL answering 200',
          detail,
        },
      };
    });
  },
};

export const redirectChecks = [chain, broken];
