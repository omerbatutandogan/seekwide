// Following redirects one hop at a time, with every hop checked against the
// site boundary and robots.txt, and turning the outcome into page records.

import { LIMITS } from '../config.js';
import { isInternalUrl, looksLikeHtmlUrl, normalizeUrl, originOf } from '../util/url.js';
import { isBotChallenge } from './challenge.js';

/** @import { FetchResult, PageRecord, RedirectHop } from '../types.js' */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Bytes read when a HEAD for something that is not a page fails and GET is tried instead. */
const NON_PAGE_GET_BYTES = 16 * 1024;

/**
 * @typedef {Object} Chain
 * @property {'chain'} kind
 * @property {RedirectHop[]} hops            Redirects answered along the way, in order.
 * @property {string} finalUrl               URL the chain ended on (fetched or not).
 * @property {FetchResult|null} result       The answer at the end; null when the chain ended without a request there.
 * @property {boolean} finalExternal         The chain left the site; the target was not requested.
 * @property {string|null} fetchError        Why the chain did not end in a usable response.
 * @property {'bot_challenge'|'rate_limited'|null} refusal  The answer at the end refused the crawler.
 * @property {boolean} headOnly              The end was not a page: it was asked for with HEAD (or, when HEAD
 *   failed, a GET limited to 16 KB) and gets no content record.
 * @property {{status: number, fetchError: string|null, finalExternal: boolean}|null} known
 *   The chain reached a URL that already has a record; its outcome is taken from that record instead of a request.
 */

/** @typedef {Chain | {kind: 'block', reason: 'robots_unreachable'|'robots_disallow', url: string, status: number, redirected_to?: string|null} | {kind: 'fail', message: string}} ChainOutcome */

/**
 * @typedef {Object} ChainContext
 * @property {(url: string, method: 'GET'|'HEAD', maxBytes?: number) => Promise<FetchResult>} fetchPage
 *   One request without automatic redirects (paced, 429 retried).
 * @property {(url: string) => PageRecord|undefined} recordOf  The record already made for a URL, if any.
 * @property {(origin: string) => Promise<{summary: {status: string, url: string, http_status: number}, isAllowed: (url: string) => boolean, refusedRedirect?: string|null}>} robotsFor
 * @property {() => {host: string, includeSubdomains: boolean}} site
 * @property {(url: string) => void} noteRobotsBlocked
 * @property {string|null} loopbackOrigin   Set when auditing a local site: no other origin may be reached.
 */

/**
 * Why a response refused the crawler, if it did.
 * @param {FetchResult} result
 * @returns {'bot_challenge'|'rate_limited'|null}
 */
export function refusalOf(result) {
  if (isBotChallenge(result)) return 'bot_challenge';
  if (result.status === 429) return 'rate_limited';
  return null;
}

/**
 * Build the chain follower for one crawl.
 *
 * Guarantees: every hop is its own request through `fetchPage`; a hop target is
 * requested only when it is an http(s) URL, has not been seen in this chain,
 * is within `LIMITS.maxRedirects`, is on the site, is allowed by robots.txt and
 * has no record of its own response yet (a recorded page's outcome is reused; a
 * recorded redirect is requested again so the hops stay complete). A hop target
 * that does not look like a page is asked for with HEAD, so no body is
 * downloaded; when the HEAD fails or answers 400 or above without refusing the
 * crawler, one GET limited to 16 KB is sent instead.
 * In 'start' mode the chain may cross origins (each new origin's robots.txt is
 * read first), except that a local site may not leave its origin.
 *
 * @param {ChainContext} ctx
 * @returns {(url: string, mode: 'start'|'page') => Promise<ChainOutcome>}
 */
export function createChainFollower(ctx) {
  return async (url, mode) => {
    /** @type {RedirectHop[]} */
    const hops = [];
    const seen = new Set([url]);
    let current = url;
    /** @param {Partial<Chain>} fields @returns {Chain} */
    const end = (fields) => ({
      kind: 'chain', hops, finalUrl: current, result: null, finalExternal: false, fetchError: null, refusal: null,
      headOnly: false, known: null, ...fields,
    });

    for (;;) {
      const headOnly = hops.length > 0 && !looksLikeHtmlUrl(current);
      let result = await ctx.fetchPage(current, headOnly ? 'HEAD' : 'GET');
      if (headOnly && (result.error !== null || result.status >= 400) && refusalOf(result) === null) {
        // Some servers refuse HEAD; their GET answer is the real one. Read only its start.
        result = await ctx.fetchPage(current, 'GET', NON_PAGE_GET_BYTES);
      }
      if (result.error !== null) return end({ result, headOnly, fetchError: result.error.code });
      if (!REDIRECT_STATUSES.has(result.status)) {
        const refusal = refusalOf(result);
        return end({ result, headOnly, refusal, fetchError: refusal });
      }

      const location = result.headers.location;
      const target = location === undefined ? null : normalizeUrl(location, current);
      hops.push({ url: current, status: result.status, location: target });
      if (target === null) return end({ fetchError: 'invalid_url' });
      if (seen.has(target)) return end({ finalUrl: target, fetchError: 'redirect_loop' });
      if (hops.length > LIMITS.maxRedirects) return end({ finalUrl: target, fetchError: 'too_many_redirects' });

      const targetOrigin = /** @type {string} */ (originOf(target));
      if (mode === 'start') {
        if (ctx.loopbackOrigin !== null && targetOrigin !== ctx.loopbackOrigin) {
          return {
            kind: 'fail',
            message: `The local site at ${ctx.loopbackOrigin} redirects to ${target}, which is another origin. ` +
              'Seekwide audits only the one local origin you asked for; start the crawl at the URL the site redirects to.',
          };
        }
        const robots = await ctx.robotsFor(targetOrigin);
        if (robots.summary.status === 'unreachable') {
          return { kind: 'block', reason: 'robots_unreachable', url: robots.summary.url, status: robots.summary.http_status, redirected_to: robots.refusedRedirect ?? null };
        }
        if (!robots.isAllowed(target)) return { kind: 'block', reason: 'robots_disallow', url: target, status: 0 };
      } else {
        const { host, includeSubdomains } = ctx.site();
        if (!isInternalUrl(target, host, includeSubdomains)) return end({ finalUrl: target, finalExternal: true });
        if (!(await ctx.robotsFor(targetOrigin)).isAllowed(target)) {
          ctx.noteRobotsBlocked(target);
          return end({ finalUrl: target, fetchError: 'robots_disallowed' });
        }
        const existing = ctx.recordOf(target);
        if (existing !== undefined && existing.redirect_chain.length === 0) {
          const known = { status: existing.final_status, fetchError: existing.fetch_error, finalExternal: existing.final_external };
          return end({ finalUrl: target, known });
        }
      }
      seen.add(target);
      current = target;
    }
  };
}

/**
 * @typedef {Object} Extractor
 * @property {(input: {url: string, result: FetchResult, depth: number|null, discoveredVia: PageRecord['discovered_via'], siteHost: string, includeSubdomains?: boolean, deployedOrigin?: string|null}) => PageRecord} extractPage
 * @property {(input: {url: string, hops: RedirectHop[], finalUrl: string, finalStatus: number, finalExternal: boolean, fetchError: string|null, depth: number|null, discoveredVia: PageRecord['discovered_via']}) => PageRecord} redirectRecord
 * @property {(input: {url: string, status: number, fetchError: string, depth: number|null, discoveredVia: PageRecord['discovered_via']}) => PageRecord} unreadableRecord
 */

/**
 * Records for one requested URL: its own record first, then the record of the
 * response at the end of a redirect chain when that URL is on the site, not yet
 * recorded and was fetched as a page. Hops in between get no record; a request
 * that failed at the end of a chain, or that was a HEAD for something that is
 * not a page, gives no record for its target.
 *
 * @param {{url: string, chain: Chain, depth: number|null, discoveredVia: PageRecord['discovered_via'],
 *          extract: Extractor, siteHost: string, includeSubdomains: boolean, isRecorded: (url: string) => boolean}} input
 * @returns {PageRecord[]}
 */
export function recordsForChain({ url, chain, depth, discoveredVia, extract, siteHost, includeSubdomains, isRecorded }) {
  /** @param {string} target @param {FetchResult} result @param {PageRecord['discovered_via']} via */
  const answer = (target, result, via) => (chain.refusal
    ? extract.unreadableRecord({ url: target, status: result.status, fetchError: chain.refusal, depth, discoveredVia: via })
    : extract.extractPage({ url: target, result, depth, discoveredVia: via, siteHost, includeSubdomains }));

  if (chain.hops.length === 0) return [answer(url, /** @type {FetchResult} */ (chain.result), discoveredVia)];

  const answered = chain.result !== null && chain.result.error === null;
  const { known } = chain;
  let finalStatus = answered && chain.refusal === null ? /** @type {FetchResult} */ (chain.result).status : 0;
  if (known !== null) finalStatus = known.fetchError === null ? known.status : 0;
  const records = [extract.redirectRecord({
    url,
    hops: chain.hops,
    finalUrl: chain.finalUrl,
    finalStatus,
    finalExternal: known !== null ? known.finalExternal : chain.finalExternal,
    fetchError: known !== null ? known.fetchError : chain.fetchError,
    depth,
    discoveredVia,
  })];
  if (answered && !chain.headOnly && isInternalUrl(chain.finalUrl, siteHost, includeSubdomains) && !isRecorded(chain.finalUrl)) {
    records.push(answer(chain.finalUrl, /** @type {FetchResult} */ (chain.result), ['redirect']));
  }
  return records;
}
