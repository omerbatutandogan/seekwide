// Canonical links: whether a page has one, how many, and where it sits.
// What the named URL is worth is checked in canonical-url.js.

/** @import { CheckDef } from '../../types.js' */

import { effectiveCanonicalUrls } from '../page-helpers.js';
import { clip } from '../../util/strings.js';
import { MAX_LISTED, SELECTOR, effectiveRefs, isStreamed } from './canonical-refs.js';
import { canonicalUrlChecks } from './canonical-url.js';
import { DOCS, SEO } from './common.js';

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
    // A page whose canonical was streamed into the body is reported by seo.canonical.streamed_in_body.
    return ctx.indexablePages.filter((page) => effectiveCanonicalUrls(page).length > 0 || !page.canonicals.some(isStreamed)).map((page) => {
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
      .filter((page) => page.canonicals.some((canonical) => canonical.source === 'html' && !isStreamed(canonical)))
      .map((page) => {
        const outside = page.canonicals.filter((canonical) => canonical.source === 'html' && !canonical.in_head && !isStreamed(canonical));
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
const streamedInBody = {
  ...SEO,
  id: 'seo.canonical.streamed_in_body',
  title: 'Next.js sent the canonical link in the body',
  description:
    'Looks at Next.js pages whose canonical link arrived in the <body> together with the title and description ("streaming metadata"). Google documents that a canonical link in the <body> is ignored, while Next.js states that crawlers which run JavaScript read streamed metadata correctly. The two do not settle it, so the finding is likely and not confirmed.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.CANONICAL,
  recommendation:
    'Make Next.js send the metadata in the <head>: return it without waiting (static metadata, or a generateMetadata that does not await slow data), or add the crawlers you care about to htmlLimitedBots in next.config. Then check the page in Search Console\'s URL inspection to see which canonical Google chose.',
  run(ctx) {
    return ctx.htmlPages
      .filter((page) => page.canonicals.some((canonical) => canonical.source === 'html'))
      .map((page) => {
        const streamed = page.canonicals.filter(isStreamed);
        if (streamed.length === 0) return { status: 'pass', url: page.url };
        return {
          status: 'fail',
          url: page.url,
          selector: SELECTOR,
          line: streamed[0].line,
          evidence: {
            observed: streamed.slice(0, MAX_LISTED).map((canonical) => clip(canonical.href)),
            expected: 'Canonical link elements inside <head>',
            detail: 'The server sent this page\'s title and canonical link in the <body> of a page that carries Next.js data scripts. A crawler that does not run JavaScript, like this one, finds them there.',
          },
        };
      });
  },
};

export const canonicalChecks = [missing, multiple, outsideHead, streamedInBody, ...canonicalUrlChecks];
