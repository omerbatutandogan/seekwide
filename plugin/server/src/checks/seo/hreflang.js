// hreflang: the language and regional versions of a page, as its <link> tags
// in the head and its Link headers give them (Google reads a sitemap's too;
// those are not read in this version). Google ignores an annotation it cannot
// read, and the pair of two pages that do not both point to each other. Pure.

/** @import { CheckContext, CheckDef, CheckResult, HreflangRef, PageRecord } from '../../types.js' */

import { hreflangProblem } from '../../util/iso-codes.js';
import { sameCanonicalTarget } from '../../util/url.js';
import { DOCS, SEO } from './common.js';

/** The date Google's page on localized versions was read for these rules. */
export const HREFLANG_VERIFIED = '2026-11-24';

const BASE = { ...SEO, last_verified: HREFLANG_VERIFIED, doc_ref: DOCS.LOCALIZED_VERSIONS };

/** @param {HreflangRef} ref */
const isDefault = (ref) => ref.hreflang.trim().toLowerCase() === 'x-default';

/** @param {CheckContext} ctx */
const annotated = (ctx) => ctx.htmlPages.filter((page) => page.hreflang.length > 0);

/** @param {PageRecord} page @param {string} url  Whether one of the page's annotations names `url`. */
const names = (page, url) => page.hreflang.some((ref) => ref.url !== null && sameCanonicalTarget(ref.url, url));

/** @param {string} a @param {string} b */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The crawled page an annotation names, and whether it is that URL itself (not reached through a redirect).
 * @param {CheckContext} ctx @param {string} url
 */
function target(ctx, url) {
  const page = ctx.resolve(url);
  if (page === undefined) return null;
  return { page, direct: sameCanonicalTarget(page.url, url) };
}

/** What each problem means, for the evidence. */
const PROBLEM_TEXT = {
  format: 'not a language code, optionally followed by a script and a region code, separated by hyphens',
  region_only: 'a region code alone: Google does not derive the language from a country code',
  unknown_language: 'the first code is not an ISO 639-1 language code',
  unknown_script: 'the script code is not an ISO 15924 code',
  unknown_region: 'the region code is not an ISO 3166-1 alpha-2 code',
  reserved_region: 'EU, UN and UK have no effect in hreflang annotations; the United Kingdom is GB',
};

/** @type {CheckDef} */
const invalidCode = {
  ...BASE,
  id: 'seo.hreflang.invalid_code',
  title: 'An hreflang value is not a language code Google supports',
  description:
    'Reads each distinct hreflang value of each html page. Google supports only an ISO 639-1 language code, optionally followed by an ISO 15924 script code and an ISO 3166-1 alpha-2 region code (en, en-GB, zh-Hant, zh-Hans-US), in any case, and x-default. A region alone (GB), a region outside ISO 3166-1 (es-419) and the reserved EU, UN and UK are not supported.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  recommendation: 'Use the language code first, then the region if needed: en-GB for English in the United Kingdom, de for German anywhere, x-default for the fallback page.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of annotated(ctx)) {
      const values = [...new Set(page.hreflang.map((ref) => ref.hreflang.trim()))].sort(byText);
      for (const value of values) {
        const problem = hreflangProblem(value);
        if (problem === null) results.push({ status: 'pass', url: page.url, selector: value });
        else results.push({
          status: 'fail', url: page.url, selector: value,
          evidence: { observed: { hreflang: value, problem }, expected: 'An ISO 639-1 language code, then optionally an ISO 15924 script and an ISO 3166-1 alpha-2 region', detail: `The value is ${PROBLEM_TEXT[problem]}.` },
        });
      }
    }
    return results;
  },
};

/** @type {CheckDef} */
const notAbsolute = {
  ...BASE,
  id: 'seo.hreflang.not_absolute',
  title: 'An hreflang address is not a full URL',
  description: 'Reads the address of each hreflang annotation. Google: alternate URLs must be fully-qualified, including the transport method (http or https); //example.com/foo and /foo are not.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  recommendation: 'Write each alternate address in full, starting with https://.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of annotated(ctx)) {
      for (const href of [...new Set(page.hreflang.map((ref) => ref.href.trim()))].sort(byText)) {
        if (/^https?:\/\//i.test(href)) results.push({ status: 'pass', url: page.url, selector: href });
        else results.push({ status: 'fail', url: page.url, selector: href, evidence: { observed: href, expected: 'A URL starting with https:// or http://' } });
      }
    }
    return results;
  },
};

/** @type {CheckDef} */
const outsideHead = {
  ...BASE,
  id: 'seo.hreflang.outside_head',
  title: 'hreflang links are outside the head',
  description: 'Checks each html page with hreflang <link> tags that they are inside the parsed <head>. Google: the <link> tags must be inside a well-formed <head> section of the HTML. An element the head cannot hold, before them, ends the head early.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  recommendation: 'Move the hreflang <link> tags into the <head>, before any element that does not belong there (such as an <img> or a <div>), or send them as Link headers.',
  run(ctx) {
    return annotated(ctx).flatMap((page) => {
      const links = page.hreflang.filter((ref) => ref.source === 'html' && ref.in_head !== undefined);
      if (links.length === 0) return [];
      const outside = links.filter((ref) => ref.in_head === false);
      if (outside.length === 0) return [/** @type {CheckResult} */ ({ status: 'pass', url: page.url })];
      return [/** @type {CheckResult} */ ({
        status: 'fail', url: page.url,
        evidence: { observed: { outside_head: outside.length, links: links.length, first: outside[0].hreflang }, expected: 'Every hreflang <link> inside <head>' },
      })];
    });
  },
};

/** @type {CheckDef} */
const selfMissing = {
  ...BASE,
  id: 'seo.hreflang.self_missing',
  title: 'A page with hreflang does not list itself',
  description: 'Checks each html page that names other language versions with hreflang that one of its annotations names the page itself. Google: each language version must list itself as well as all other language versions.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  recommendation: 'Add an hreflang annotation for the page\'s own language that points to the page\'s own URL, next to the others.',
  run(ctx) {
    return annotated(ctx).flatMap((page) => {
      if (!page.hreflang.some((ref) => !isDefault(ref))) return [];
      if (names(page, page.url)) return [/** @type {CheckResult} */ ({ status: 'pass', url: page.url })];
      return [/** @type {CheckResult} */ ({
        status: 'fail', url: page.url,
        evidence: { observed: { annotations: page.hreflang.length, values: [...new Set(page.hreflang.map((ref) => ref.hreflang))].slice(0, 10) }, expected: `An annotation that points to ${page.url}` },
      })];
    });
  },
};

/** @type {CheckDef} */
const noReturn = {
  ...BASE,
  id: 'seo.hreflang.no_return',
  title: 'An alternate page does not point back',
  description: 'For each hreflang annotation that names another crawled html page directly (not through a redirect), checks that the page it names has an annotation pointing back. Google: if two pages don\'t both point to each other, the tags will be ignored. An alternate page that was not crawled is not judged.',
  severity: 'medium',
  weight: 3,
  impact: 3,
  effort: 2,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  recommendation: 'Give every language version the same complete set of hreflang annotations, each version listing all the others and itself.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of annotated(ctx)) {
      const urls = [...new Set(page.hreflang.flatMap((ref) => (ref.url === null || sameCanonicalTarget(ref.url, page.url) ? [] : [ref.url])))].sort(byText);
      for (const url of urls) {
        const found = target(ctx, url);
        if (found === null || !found.direct || found.page.status !== 200 || !found.page.is_html) continue;
        if (names(found.page, page.url)) results.push({ status: 'pass', url: page.url, selector: url });
        else results.push({
          status: 'fail', url: page.url, selector: url, related_urls: [url],
          evidence: { observed: { alternate: url, its_annotations: found.page.hreflang.length }, expected: `${url} has an hreflang annotation pointing to ${page.url}` },
        });
      }
    }
    return results;
  },
};

/** @type {CheckDef} */
const targetNotOk = {
  ...BASE,
  id: 'seo.hreflang.target_not_ok',
  title: 'An hreflang annotation names a page that redirects, fails or is not indexable',
  description: 'For each hreflang annotation that names a crawled URL, checks that the URL answers 200 with an indexable page. Google\'s page does not say what happens otherwise, so this is information: the pair needs the alternate page to point back, and a redirected or excluded page is not the version a searcher should be sent to.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  recommendation: 'Point each annotation at the final, indexable address of the alternate page.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of annotated(ctx)) {
      const urls = [...new Set(page.hreflang.flatMap((ref) => (ref.url === null ? [] : [ref.url])))].sort(byText);
      for (const url of urls) {
        const found = target(ctx, url);
        if (found === null) continue;
        const ok = found.direct && found.page.status === 200 && found.page.indexability.indexable;
        if (ok) results.push({ status: 'pass', url: page.url, selector: url });
        else results.push({
          status: 'fail', url: page.url, selector: url, related_urls: [url],
          evidence: {
            observed: { alternate: url, ...(found.direct ? {} : { redirects_to: found.page.url }), status: found.page.status, indexable: found.page.indexability.indexable },
            expected: 'An alternate URL that answers 200 with an indexable page',
          },
        });
      }
    }
    return results;
  },
};

/** @type {CheckDef} */
const xDefaultMissing = {
  ...BASE,
  id: 'seo.hreflang.x_default_missing',
  title: 'No page names a fallback version with x-default',
  description: 'When the crawled pages use hreflang, looks for an x-default annotation on any of them. Google suggests a fallback page for unmatched languages, such as a language picker; it is a suggestion, so this is information.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'site',
  requires: [],
  recommendation: 'Add an hreflang="x-default" annotation to each version, pointing to the page for visitors whose language no version matches.',
  run(ctx) {
    const pages = annotated(ctx);
    if (pages.length === 0) return [];
    const start = ctx.resolve(ctx.site.start_url)?.url ?? pages[0].url;
    if (pages.some((page) => page.hreflang.some(isDefault))) return [{ status: 'pass', url: start }];
    return [{ status: 'fail', url: start, evidence: { observed: { pages_with_hreflang: pages.length, x_default: 0 }, expected: 'An x-default annotation' } }];
  },
};

export const hreflangChecks = [invalidCode, notAbsolute, outsideHead, selfMissing, noReturn, targetNotOk, xDefaultMissing];
