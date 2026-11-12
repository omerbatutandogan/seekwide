// Canonical links: whether the URL a page names is usable, absolute, indexable
// and on the audited site.

/** @import { CheckDef, CheckResult } from '../../types.js' */

import { effectiveCanonicalUrls, isNoindex, isRedirectRecord, isUnverifiable } from '../page-helpers.js';
import { clip } from '../../util/strings.js';
import { sameCanonicalTarget } from '../../util/url.js';
import { MAX_LISTED, SELECTOR, describeRef, effectiveRefs } from './canonical-refs.js';
import { DOCS, SEO } from './common.js';

const ABSOLUTE = /^https?:\/\//i;

/** @type {CheckDef} */
const invalid = {
  ...SEO,
  id: 'seo.canonical.invalid',
  title: 'Canonical URL is empty or invalid',
  description:
    'Checks that every canonical link and header holds a usable http or https URL. An empty, malformed or non-web value cannot be used as a canonical.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.CANONICAL,
  recommendation: 'Set the canonical href to the full https:// URL of the preferred page, or remove the empty canonical.',
  run(ctx) {
    return ctx.htmlPages
      .filter((page) => page.canonicals.length > 0)
      .map((page) => {
        const bad = page.canonicals.filter((canonical) => canonical.url === null);
        if (bad.length === 0) return { status: 'pass', url: page.url };
        return {
          status: 'fail',
          url: page.url,
          selector: SELECTOR,
          line: bad[0].line,
          evidence: {
            observed: bad.slice(0, MAX_LISTED).map(describeRef),
            expected: 'An absolute http:// or https:// URL',
          },
        };
      });
  },
};

/** @type {CheckDef} */
const relative = {
  ...SEO,
  id: 'seo.canonical.relative',
  title: 'Canonical URL is not absolute',
  description:
    'Checks that canonical links and headers use absolute URLs starting with http:// or https://. Google supports relative paths but recommends absolute URLs, because relative ones cause problems over time.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.CANONICAL,
  recommendation: 'Write the canonical href as a full URL including https:// and the host name.',
  run(ctx) {
    return ctx.htmlPages
      .filter((page) => page.canonicals.length > 0)
      .map((page) => {
        const notAbsolute = page.canonicals.filter((canonical) => !ABSOLUTE.test(canonical.href.trim()));
        if (notAbsolute.length === 0) return { status: 'pass', url: page.url };
        return {
          status: 'fail',
          url: page.url,
          selector: SELECTOR,
          line: notAbsolute[0].line,
          evidence: {
            observed: notAbsolute.slice(0, MAX_LISTED).map(describeRef),
            expected: 'A URL starting with https:// or http://',
          },
        };
      });
  },
};

/** @type {CheckDef} */
const targetNotOk = {
  ...SEO,
  id: 'seo.canonical.target_not_ok',
  title: 'Canonical URL points to a page that cannot be indexed',
  description:
    'Follows the canonical URL of each page that points elsewhere and checks that the target answers 200 with HTML and is not noindex. A canonical should name a working, indexable page.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.CANONICAL,
  recommendation: 'Point the canonical at the final, indexable URL of the preferred page, or at this page itself if it is the preferred version.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      const urls = effectiveCanonicalUrls(page);
      if (urls.length !== 1 || sameCanonicalTarget(urls[0], page.url)) continue;
      const target = ctx.pageByUrl.get(urls[0]);
      // A target the crawler was refused on has no status worth reporting.
      if (!target || (!isRedirectRecord(target) && isUnverifiable(target))) continue;
      /** @type {string[]} */
      const problems = [];
      // A redirect has no content of its own, so whether it is HTML says nothing.
      if (isRedirectRecord(target)) problems.push(`answers HTTP ${target.status} and redirects to ${clip(target.final_url)}`);
      else if (target.status !== 200) problems.push(`answers HTTP ${target.status}`);
      if (!target.is_html && !isRedirectRecord(target)) problems.push('is not an HTML page');
      if (isNoindex(target)) problems.push('is set to noindex');
      if (problems.length === 0) {
        results.push({ status: 'pass', url: page.url });
        continue;
      }
      results.push({
        status: 'fail',
        url: page.url,
        selector: SELECTOR,
        line: effectiveRefs(page)[0]?.line ?? null,
        evidence: {
          observed: { canonical: clip(target.url), status: target.status, is_html: target.is_html, noindex: isNoindex(target) },
          expected: 'A canonical target that answers 200 with HTML and is indexable',
          detail: `The canonical target ${problems.join(' and ')}.`,
        },
      });
    }
    return results;
  },
};

/** @type {CheckDef} */
const crossHost = {
  ...SEO,
  id: 'seo.canonical.cross_host',
  title: 'Canonical URL points to another host',
  description:
    'Checks whether a page\'s canonical URL is on a different host from the audited site. That is right for syndicated content, but it is often a CMS or hosting misconfiguration that hands the page\'s signals to another site.',
  severity: 'medium',
  weight: 2,
  impact: 3,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.CANONICAL_TROUBLESHOOTING,
  recommendation: 'If the other host is not the intended original, change the canonical to the URL of this page on your own site.',
  run(ctx) {
    return ctx.htmlPages
      .filter((page) => effectiveCanonicalUrls(page).length > 0)
      .map((page) => {
        // Another host name; the scheme, the port, "www." and a trailing dot do not make one.
        const foreign = effectiveCanonicalUrls(page).filter((url) => !ctx.identity.isSiteHost(url));
        if (foreign.length === 0) return { status: 'pass', url: page.url };
        const ref = effectiveRefs(page).find((canonical) => canonical.url === foreign[0]);
        return {
          status: 'fail',
          url: page.url,
          selector: SELECTOR,
          line: ref?.line ?? null,
          evidence: {
            observed: foreign.slice(0, MAX_LISTED).map((url) => clip(url)),
            expected: `A canonical URL on ${ctx.site.host}`,
          },
        };
      });
  },
};

export const canonicalUrlChecks = [invalid, relative, targetNotOk, crossHost];
