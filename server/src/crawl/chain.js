// Following redirects one hop at a time, with every hop checked against the
// site boundary and robots.txt, and turning the outcome into page records.

import { LIMITS } from '../config.js';
import { followRedirects } from '../net/polite.js';
import { isInternalUrl, looksLikeHtmlUrl, originOf } from '../util/url.js';
import { isBotChallenge } from './challenge.js';

/** @import { FetchResult, PageRecord, RedirectHop } from '../types.js' */

/** Bytes read when a HEAD for something that is not a page fails and GET is tried instead. */
const NON_PAGE_GET_BYTES = 16 * 1024;
/**
 * Extensions of URLs that are often files and sometimes pages ("/wiki/Next.js",
 * "/learn/node.js"). Such a URL is asked for with HEAD first and crawled only
 * when it answers HTML.
 */
const PAGE_OR_FILE = new Set(['js', 'json', 'xml', 'txt']);

/**
 * Whether `url` ends in an extension that may name a page or a file
 * (`PAGE_OR_FILE`): the crawler asks the server with HEAD before it fetches it.
 * @param {string} url  Absolute URL.
 * @returns {boolean}
 */
export function asksFirst(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return false;
  }
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  return dot !== -1 && PAGE_OR_FILE.has(last.slice(dot + 1).toLowerCase());
}

/**
 * Whether an answer to HEAD says the URL is an HTML page: 2xx with an HTML media type.
 * @param {FetchResult} result
 * @returns {boolean}
 */
function answersHtml(result) {
  const type = result.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() ?? '';
  return result.error === null && result.status >= 200 && result.status < 300 && (type === 'text/html' || type === 'application/xhtml+xml');
}

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
 * @property {boolean} [notPage]             The URL asked for (in 'page' mode) ends in an extension of `PAGE_OR_FILE`
 *   and the chain did not end in a page (an answer fetched as a page, or a URL with a page record): nothing is
 *   recorded for it.
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
 * crawler, one GET limited to 16 KB is sent instead. In 'page' mode a URL that
 * ends in an extension of `PAGE_OR_FILE` (`asksFirst`) is asked for with HEAD
 * too, the first URL included, and fetched as a page when the HEAD answers 2xx
 * with an HTML media type; a chain from such a first URL that does not end in
 * an HTML page is `notPage`.
 * In 'start' mode the chain may cross origins (each new origin's robots.txt is
 * read first), except that a local site may not leave its origin.
 *
 * @param {ChainContext} ctx
 * @returns {(url: string, mode: 'start'|'page') => Promise<ChainOutcome>}
 */
export function createChainFollower(ctx) {
  return async (url, mode) => {
    let headOnly = false;
    /** @typedef {{fields: Partial<Chain>} | {outcome: ChainOutcome}} Stop */
    /** @type {import('../net/polite.js').RedirectOutcome<Stop>} */
    const chain = await followRedirects(url, {
      maxHops: LIMITS.maxRedirects,
      request: async (current, hop) => {
        const ask = mode === 'page' && asksFirst(current);
        headOnly = ask || (hop > 0 && !looksLikeHtmlUrl(current));
        let result = await ctx.fetchPage(current, headOnly ? 'HEAD' : 'GET');
        if (ask && answersHtml(result)) {
          headOnly = false;
          result = await ctx.fetchPage(current, 'GET');
        } else if (headOnly && (result.error !== null || result.status >= 400) && refusalOf(result) === null) {
          // Some servers refuse HEAD; their GET answer is the real one. Read only its start.
          result = await ctx.fetchPage(current, 'GET', NON_PAGE_GET_BYTES);
        }
        return result;
      },
      before: async (target, hop) => (hop === 0 ? undefined : stopBefore(ctx, target, mode)),
    });
    /** @param {Partial<Chain>} fields @returns {Chain} */
    const end = (fields) => {
      const done = {
        kind: /** @type {const} */ ('chain'), hops: chain.hops, finalUrl: chain.url, result: null, finalExternal: false, fetchError: null,
        refusal: null, headOnly: false, known: null, ...fields,
      };
      const page = done.known !== null || (!done.headOnly && done.result !== null && done.result.error === null && done.refusal === null);
      return mode === 'page' && asksFirst(url) && !page
        ? { ...done, notPage: true } : done;
    };
    if (chain.kind === 'stopped') return 'outcome' in chain.value ? chain.value.outcome : end(chain.value.fields);
    if (chain.kind === 'unsent') throw new TypeError('createChainFollower: every request of a chain is sent');
    if (chain.kind === 'invalid') return end({ fetchError: 'invalid_url' });
    if (chain.kind === 'loop') return end({ finalUrl: /** @type {string} */ (chain.target), fetchError: 'redirect_loop' });
    if (chain.kind === 'too_many') return end({ finalUrl: /** @type {string} */ (chain.target), fetchError: 'too_many_redirects' });
    const { result } = chain;
    if (result.error !== null) return end({ result, headOnly, fetchError: result.error.code });
    const refusal = refusalOf(result);
    return end({ result, headOnly, refusal, fetchError: refusal });
  };
}

/**
 * Why the chain stops before requesting `target`, a redirect target, or
 * undefined when it may go on.
 * @param {ChainContext} ctx
 * @param {string} target
 * @param {'start'|'page'} mode
 * @returns {Promise<{fields: Partial<Chain>} | {outcome: ChainOutcome} | undefined>}
 */
async function stopBefore(ctx, target, mode) {
  const targetOrigin = /** @type {string} */ (originOf(target));
  if (mode === 'start') {
    if (ctx.loopbackOrigin !== null && targetOrigin !== ctx.loopbackOrigin) {
      return {
        outcome: {
          kind: 'fail',
          message: `The local site at ${ctx.loopbackOrigin} redirects to ${target}, which is another origin. ` +
            'Seekwide audits only the one local origin you asked for; start the crawl at the URL the site redirects to.',
        },
      };
    }
    const robots = await ctx.robotsFor(targetOrigin);
    if (robots.summary.status === 'unreachable') {
      return { outcome: { kind: 'block', reason: 'robots_unreachable', url: robots.summary.url, status: robots.summary.http_status, redirected_to: robots.refusedRedirect ?? null } };
    }
    return robots.isAllowed(target) ? undefined : { outcome: { kind: 'block', reason: 'robots_disallow', url: target, status: 0 } };
  }
  const { host, includeSubdomains } = ctx.site();
  if (!isInternalUrl(target, host, includeSubdomains)) return { fields: { finalExternal: true } };
  if (!(await ctx.robotsFor(targetOrigin)).isAllowed(target)) {
    ctx.noteRobotsBlocked(target);
    return { fields: { fetchError: 'robots_disallowed' } };
  }
  const existing = ctx.recordOf(target);
  if (existing !== undefined && existing.redirect_chain.length === 0) {
    return { fields: { known: { status: existing.final_status, fetchError: existing.fetch_error, finalExternal: existing.final_external } } };
  }
  return undefined;
}

/**
 * @typedef {Object} Extractor
 * @property {(input: {url: string, result: FetchResult, depth: number|null, discoveredVia: PageRecord['discovered_via'], siteHost: string, includeSubdomains?: boolean}) => PageRecord} extractPage
 * @property {(input: {url: string, hops: RedirectHop[], finalUrl: string, finalStatus: number, finalExternal: boolean, fetchError: string|null, depth: number|null, discoveredVia: PageRecord['discovered_via']}) => PageRecord} redirectRecord
 * @property {(input: {url: string, status: number, fetchError: string, depth: number|null, discoveredVia: PageRecord['discovered_via']}) => PageRecord} unreadableRecord
 */

/**
 * Records for one requested URL: its own record first, then the record of the
 * response at the end of a redirect chain when that URL is on the site, not yet
 * recorded and was fetched as a page. Hops in between get no record; a request
 * that failed at the end of a chain, or that was a HEAD for something that is
 * not a page, gives no record for its target. A chain that is `notPage` gives no record at all.
 *
 * @param {{url: string, chain: Chain, depth: number|null, discoveredVia: PageRecord['discovered_via'],
 *          extract: Extractor, siteHost: string, includeSubdomains: boolean, isRecorded: (url: string) => boolean}} input
 * @returns {PageRecord[]}
 */
export function recordsForChain({ url, chain, depth, discoveredVia, extract, siteHost, includeSubdomains, isRecorded }) {
  if (chain.notPage === true) return [];
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
