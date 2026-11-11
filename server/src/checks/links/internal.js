/** @import { CheckContext, CheckDef, CheckResult, PageRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { isRedirectRecord, isUnverifiable } from '../page-helpers.js';
import { distinctInternalTargets, linkSelector } from './helpers.js';

const LAST_VERIFIED = '2026-11-11';

/**
 * How a crawled link target ended, for evidence text.
 * @param {PageRecord} record
 * @returns {string}
 */
function describeEnd(record) {
  const redirected = record.final_url !== record.url;
  const answer =
    record.final_status === 0
      ? `could not be fetched${record.fetch_error ? ` (${record.fetch_error})` : ''}`
      : `answered ${record.final_status}`;
  return redirected
    ? `${clip(record.url)} redirects to ${clip(record.final_url)}, which ${answer}.`
    : `${clip(record.url)} ${answer}.`;
}

/** Why the audit could not read a URL, in plain words. */
const REFUSED = {
  bot_challenge: 'the site challenged the crawler',
  rate_limited: 'the site rate-limited the crawler',
  robots_disallowed: 'robots.txt does not allow the crawler to request the URL, or could not be read',
};

/**
 * Where a redirecting link target leads, for evidence text.
 * @param {PageRecord} record
 * @returns {string}
 */
function describeRedirect(record) {
  const start = `${clip(record.url)} answers ${record.status} and redirects to ${clip(record.final_url)}`;
  if (record.final_external) return `${start}, which is on another site.`;
  if (isUnverifiable(record)) {
    const why = REFUSED[/** @type {keyof typeof REFUSED} */ (record.fetch_error)];
    return `${start}, which the audit could not read (${why}).`;
  }
  return `${start}.`;
}

/**
 * True when the audit cannot say whether a link target is broken: the crawler
 * was refused (challenge, rate limit, robots.txt), or the target redirects to
 * another site, whose URL is checked with the external links instead.
 * @param {PageRecord} record
 * @returns {boolean}
 */
function isUnverifiableTarget(record) {
  return isUnverifiable(record) || (isRedirectRecord(record) && record.final_external);
}

/**
 * One result per distinct internal link target of each html page, for targets
 * that have a record and are units of the check.
 * @param {CheckContext} ctx
 * @param {(record: PageRecord) => boolean} isUnit  Whether a crawled target is a unit of the check.
 * @param {(record: PageRecord) => boolean} fails  Decides whether a unit fails.
 * @param {(record: PageRecord) => NonNullable<CheckResult['evidence']>} evidence
 * @returns {CheckResult[]}
 */
function crawledTargetResults(ctx, isUnit, fails, evidence) {
  /** @type {CheckResult[]} */
  const results = [];
  for (const page of ctx.htmlPages) {
    for (const target of distinctInternalTargets(page)) {
      const record = ctx.pageByUrl.get(target.url);
      if (!record || !isUnit(record)) continue;
      const first = target.links[0];
      /** @type {CheckResult} */
      const result = { status: 'pass', url: page.url, selector: linkSelector(first) };
      if (fails(record)) {
        result.status = 'fail';
        result.line = first.line;
        result.evidence = evidence(record);
      }
      results.push(result);
    }
  }
  return results;
}

/** @type {CheckDef} */
const broken = {
  id: 'links.internal.broken',
  module: 'links',
  engine: 'code',
  title: 'Internal link to a broken page',
  description:
    'Looks at internal links whose target was crawled and ended in an error status or could not be fetched, including targets whose redirect leads to an error. Targets the crawler was refused on, and targets that redirect to another site, are not counted. Google does not index URLs that return a 4xx status.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: 'https://developers.google.com/crawling/docs/troubleshooting/http-status-codes',
  last_verified: LAST_VERIFIED,
  recommendation:
    'Change the link to a working URL, or remove it. If the page moved, link to its new address.',
  run(ctx) {
    return crawledTargetResults(
      ctx,
      (record) => !isUnverifiableTarget(record),
      (record) => record.final_status === 0 || record.final_status >= 400,
      (record) => ({
        observed: {
          target_url: clip(record.url),
          status: record.status,
          final_status: record.final_status,
          fetch_error: record.fetch_error,
        },
        expected: 'A target that answers with a status below 400',
        detail: describeEnd(record),
      }),
    );
  },
};

/** @type {CheckDef} */
const redirect = {
  id: 'links.internal.redirect',
  module: 'links',
  engine: 'code',
  title: 'Internal link goes through a redirect',
  description:
    'Looks at internal links whose target redirects to a page that works, to another site, or to a page the audit could not read. The link still gets visitors there, but every visit costs an extra request and the link names a URL that is not the final one.',
  severity: 'low',
  weight: 2,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: 'https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes',
  last_verified: LAST_VERIFIED,
  recommendation: 'Change the link to point straight at the final URL given in the evidence.',
  run(ctx) {
    return crawledTargetResults(
      ctx,
      () => true,
      (record) =>
        isRedirectRecord(record) &&
        (record.final_external || isUnverifiable(record) || (record.final_status >= 200 && record.final_status <= 399)),
      (record) => ({
        observed: {
          target_url: clip(record.url),
          status: record.status,
          final_url: clip(record.final_url),
          final_status: record.final_status,
          final_external: record.final_external,
          fetch_error: record.fetch_error,
          hops: record.redirect_chain.length,
        },
        expected: `A link to ${clip(record.final_url)}`,
        detail: describeRedirect(record),
      }),
    );
  },
};

/** @type {CheckDef} */
const nofollow = {
  id: 'links.internal.nofollow',
  module: 'links',
  engine: 'code',
  title: 'Internal link marked nofollow',
  description:
    'Looks at internal links that carry rel="nofollow". Google generally does not follow links marked this way, and for pages on your own site it recommends a robots.txt disallow rule instead.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: 'https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links',
  last_verified: LAST_VERIFIED,
  recommendation:
    'Remove rel="nofollow" from internal links you want Google to follow. To stop Google fetching a page on your own site, use a robots.txt disallow rule instead.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      for (const target of distinctInternalTargets(page)) {
        const marked = target.links.filter((link) => link.rel.includes('nofollow'));
        if (marked.length === 0) {
          results.push({ status: 'pass', url: page.url, selector: linkSelector(target.links[0]) });
          continue;
        }
        results.push({
          status: 'fail',
          url: page.url,
          selector: linkSelector(marked[0]),
          line: marked[0].line,
          evidence: {
            observed: {
              target_url: clip(target.url),
              rel: marked[0].rel.map((token) => clip(token)),
              nofollow_links: marked.length,
              links_to_target: target.links.length,
            },
            expected: 'Internal links without rel="nofollow"',
            detail: `${marked.length} of ${target.links.length} link(s) to ${clip(target.url)} on this page have rel="nofollow".`,
          },
        });
      }
    }
    return results;
  },
};

/**
 * The https:// form of an http:// URL.
 * @param {string} url
 * @returns {string}
 */
function httpsVersion(url) {
  const parsed = new URL(url);
  parsed.protocol = 'https:';
  return parsed.href;
}

/** @type {CheckDef} */
const insecure = {
  id: 'links.internal.insecure',
  module: 'links',
  engine: 'code',
  title: 'Internal link uses http://',
  description:
    'On a site served over https, looks at internal links that still use an http:// URL. Visitors and crawlers that follow them start on an unencrypted address and depend on a redirect to reach the secure one.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: 'https://web.dev/articles/enable-https',
  last_verified: LAST_VERIFIED,
  recommendation: 'Change the link to the https:// version of the URL.',
  run(ctx) {
    if (!ctx.site.https) return [];
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      for (const target of distinctInternalTargets(page)) {
        const first = target.links[0];
        if (!target.url.startsWith('http://')) {
          results.push({ status: 'pass', url: page.url, selector: linkSelector(first) });
          continue;
        }
        const secure = httpsVersion(target.url);
        results.push({
          status: 'fail',
          url: page.url,
          selector: linkSelector(first),
          line: first.line,
          evidence: {
            observed: clip(target.url),
            expected: clip(secure),
            detail: `The site is served over https, but this link uses ${clip(target.url)}.`,
          },
        });
      }
    }
    return results;
  },
};

/** The internal-link checks. */
export const internalChecks = [broken, redirect, nofollow, insecure];
