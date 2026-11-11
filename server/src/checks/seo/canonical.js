/** @import { CanonicalRef, CheckDef, CheckResult, PageRecord } from '../../types.js' */

import { effectiveCanonicalUrls, isNoindex, isRedirectRecord, isUnverifiable } from '../page-helpers.js';
import { clip } from '../../util/strings.js';
import { hostKey } from '../../util/url.js';
import { DOCS, SEO } from './common.js';

const SELECTOR = 'link[rel=canonical]';
const ABSOLUTE = /^https?:\/\//i;
/** Canonicals quoted in evidence. */
const MAX_LISTED = 5;

/**
 * The canonicals search engines read: in `<head>` or a header, with a valid URL.
 * @param {PageRecord} page
 * @returns {CanonicalRef[]}
 */
function effectiveRefs(page) {
  return page.canonicals.filter((canonical) => canonical.in_head && canonical.url !== null);
}

/**
 * How a canonical is declared, for evidence.
 * @param {CanonicalRef} canonical
 * @returns {string}
 */
function describeRef(canonical) {
  return canonical.source === 'header' ? `Link header: ${clip(canonical.href)}` : `<link> href: ${clip(canonical.href)}`;
}

/** @type {CheckDef} */
const missing = {
  ...SEO,
  id: 'seo.canonical.missing',
  title: 'Page has no canonical URL',
  description:
    'Checks that every indexable page names its preferred URL with a rel="canonical" link in the <head> or a Link header. It is optional, but it tells search engines which URL to show when the same content is reachable at several addresses.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.CANONICAL,
  recommendation: 'Add <link rel="canonical" href="…"> to the <head> with the absolute URL of the version of this page you want in search results.',
  run(ctx) {
    return ctx.indexablePages.map((page) => {
      if (effectiveCanonicalUrls(page).length > 0) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        selector: SELECTOR,
        evidence: {
          observed:
            page.canonicals.length === 0
              ? 'No canonical link or header'
              : 'Canonical links exist but none is in the <head> with a valid URL',
          expected: 'A canonical link in the <head> or a canonical Link header',
        },
      };
    });
  },
};

/** @type {CheckDef} */
const multiple = {
  ...SEO,
  id: 'seo.canonical.multiple',
  title: 'Page names more than one canonical URL',
  description:
    'Checks whether a page\'s canonical links and headers point at different URLs. Google advises against naming different canonical URLs for the same page, because the signals conflict.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.CANONICAL,
  recommendation: 'Keep one canonical declaration and remove the others, or make every link element and header name the same URL.',
  run(ctx) {
    return ctx.htmlPages
      .filter((page) => effectiveCanonicalUrls(page).length > 0)
      .map((page) => {
        const urls = effectiveCanonicalUrls(page);
        if (urls.length === 1) return { status: 'pass', url: page.url };
        const second = effectiveRefs(page).find((canonical) => canonical.url === urls[1]);
        return {
          status: 'fail',
          url: page.url,
          selector: SELECTOR,
          line: second?.line ?? null,
          evidence: {
            observed: urls.slice(0, MAX_LISTED).map((url) => clip(url)),
            expected: 'One canonical URL',
            detail: `The page names ${urls.length} different canonical URLs.`,
          },
        };
      });
  },
};

/** @type {CheckDef} */
const outsideHead = {
  ...SEO,
  id: 'seo.canonical.outside_head',
  title: 'Canonical link is outside the head',
  description:
    'Checks that rel="canonical" link elements are inside <head>. Google accepts a canonical link only in the <head>, so one in the <body> is ignored.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.CANONICAL,
  recommendation: 'Move the canonical link into the <head>, and make sure no element that belongs in the <body> appears before it in the <head>.',
  run(ctx) {
    return ctx.htmlPages
      .filter((page) => page.canonicals.some((canonical) => canonical.source === 'html'))
      .map((page) => {
        const outside = page.canonicals.filter((canonical) => canonical.source === 'html' && !canonical.in_head);
        if (outside.length === 0) return { status: 'pass', url: page.url };
        return {
          status: 'fail',
          url: page.url,
          selector: SELECTOR,
          line: outside[0].line,
          evidence: {
            observed: outside.slice(0, MAX_LISTED).map((canonical) => clip(canonical.href)),
            expected: 'Canonical link elements inside <head>',
            detail:
              outside.length === 1
                ? 'A canonical link element is in the <body>.'
                : `${outside.length} canonical link elements are in the <body>.`,
          },
        };
      });
  },
};

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
      if (urls.length !== 1 || urls[0] === page.url) continue;
      const target = ctx.pageByUrl.get(urls[0]);
      // A target the crawler was refused on has no status worth reporting.
      if (!target || (!isRedirectRecord(target) && isUnverifiable(target))) continue;
      /** @type {string[]} */
      const problems = [];
      if (target.status !== 200) problems.push(`answers HTTP ${target.status}`);
      if (!target.is_html) problems.push('is not an HTML page');
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
    const siteKey = hostKey(new URL(ctx.site.origin).hostname);
    return ctx.htmlPages
      .filter((page) => effectiveCanonicalUrls(page).length > 0)
      .map((page) => {
        const foreign = effectiveCanonicalUrls(page).filter((url) => hostKey(new URL(url).hostname) !== siteKey);
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

export const canonicalChecks = [missing, multiple, outsideHead, invalid, relative, targetNotOk, crossHost];
