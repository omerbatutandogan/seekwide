/** @import { CheckContext, CheckDef, CheckResult, PageRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { isRedirectRecord, isUnverifiable } from '../page-helpers.js';
import { distinctInternalTargets, linkSelector } from './helpers.js';
import { nofollow } from './nofollow.js';

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

/** Redirect statuses that say the move is temporary: Google reads them as a weak signal. */
const TEMPORARY = new Set([302, 303, 307]);

/**
 * True when every hop of a redirect record is temporary (302, 303 or 307).
 * @param {PageRecord} record
 * @returns {boolean}
 */
function isTemporary(record) {
  return record.redirect_chain.length > 0 && record.redirect_chain.every((hop) => TEMPORARY.has(hop.status));
}

/** Query parameters through which a login or consent page is told where to send the visitor back, compared lower-cased without `_` and `-`. */
const RETURN_PARAMETERS = new Set([
  'next', 'return', 'returnto', 'returnurl', 'returnpath', 'redirect', 'redirectto', 'redirecturl', 'redirecturi', 'continue',
  'destination', 'back', 'backurl', 'camefrom', 'callbackurl',
]);

/**
 * True when a redirect ends on the site at a page whose return parameter
 * names the target itself (`/login?next=%2Fdashboard`,
 * `?redirect_to=https://…/account/`): a gate such as a login page that sends
 * the visitor back afterwards. A link to the target is then the right link.
 * The parameter's value must be a path or an http(s) URL on the target's
 * host; paths are compared without a trailing slash.
 * @param {PageRecord} record
 * @returns {boolean}
 */
function returnsToTarget(record) {
  let final;
  let target;
  try {
    final = new URL(record.final_url);
    target = new URL(record.url);
  } catch {
    return false;
  }
  if (record.final_external || final.host !== target.host) return false;
  const path = (/** @type {string} */ value) => value.replace(/\/+$/, '') || '/';
  const wanted = path(target.pathname);
  for (const [name, value] of final.searchParams) {
    if (!RETURN_PARAMETERS.has(name.toLowerCase().replace(/[-_]/g, '')) || value.length > 2048 || !/^(?:\/|https?:\/\/)/i.test(value)) continue;
    try {
      const named = new URL(value, final);
      if (named.host === target.host && path(named.pathname) === wanted) return true;
    } catch {
      // Not a URL.
    }
  }
  return false;
}

/**
 * One result per distinct internal link target of each html page, for targets
 * that have a record and are units of the check.
 * @param {CheckContext} ctx
 * @param {(record: PageRecord) => boolean} isUnit  Whether a crawled target is a unit of the check.
 * @param {(record: PageRecord) => boolean} fails  Decides whether a unit fails.
 * @param {(record: PageRecord) => NonNullable<CheckResult['evidence']>} evidence
 * @param {(record: PageRecord) => CheckResult['confidence']} [confidence]  Lowers a failed unit's confidence.
 * @returns {CheckResult[]}
 */
function crawledTargetResults(ctx, isUnit, fails, evidence, confidence = () => undefined) {
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
        const lowered = confidence(record);
        if (lowered !== undefined) result.confidence = lowered;
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
    'Looks at internal links whose target redirects to a page that works, to another site, or to a page the audit could not read. The link still gets visitors there, but every visit costs an extra request and the link names a URL that is not the final one. A temporary redirect (302, 303 or 307) is reported as likely, because a site can mean it (a login, a region, a cart), and one that leads to a page carrying the link\'s own address, such as a login page that sends the visitor back, is not counted.',
  severity: 'low',
  weight: 2,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: 'https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes',
  last_verified: '2026-11-12',
  recommendation: 'Change the link to point straight at the final URL given in the evidence. If the redirect is temporary on purpose (a login, a region, a cart), the link can stay.',
  run(ctx) {
    return crawledTargetResults(
      ctx,
      (record) => !(isTemporary(record) && returnsToTarget(record)),
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
        detail: isTemporary(record)
          ? `${describeRedirect(record)} The redirect is temporary (${[...new Set(record.redirect_chain.map((hop) => hop.status))].join(', ')}), which a site can mean (a login, a region, a cart); if the page moved for good, link to the final URL.`
          : describeRedirect(record),
      }),
      (record) => (isTemporary(record) ? 'likely' : undefined),
    );
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
