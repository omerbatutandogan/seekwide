// The http:// probe: does the site send plain-http visitors to https?

import { LIMITS } from '../config.js';
import { followRedirects } from '../net/polite.js';
import { isInternalUrl, originOf } from '../util/url.js';
import { refusalOf } from './chain.js';

/** @import { FetchResult, HttpProbe, RedirectHop } from '../types.js' */
/** @import { safeFetch } from '../net/safe-fetch.js' */

/**
 * Request the http:// home page and follow its redirects by hand while they
 * stay on http:// on the site, each request only when its origin's robots.txt
 * allows it.
 *
 * Guarantees: no request is sent that robots.txt does not allow; the result is
 * null when a request is not allowed, fails, or ends in a refusal of the crawler
 * (429 or a bot challenge), since none of those says how the site treats
 * visitors; other statuses, 4xx and 5xx included, are answers; a URL seen twice
 * ends the probe at once with `enforced: false`; `enforced` is true when the
 * probe ends on an https:// URL (which is not requested).
 *
 * @param {string} probeUrl  For example "http://example.com/".
 * @param {{fetch: (url: string, options: Parameters<typeof safeFetch>[1]) => Promise<FetchResult>,
 *          robotsFor: (origin: string) => Promise<{summary: {status: string}, isAllowed: (url: string) => boolean}>,
 *          siteHost: string, includeSubdomains: boolean}} deps
 * @returns {Promise<HttpProbe|null>}
 */
export async function probeHttp(probeUrl, { fetch, robotsFor, siteHost, includeSubdomains }) {
  /** Where the probe stops without a request: off http:// or off the site. @param {string} target */
  const leaves = (target) => !target.startsWith('http:') || !isInternalUrl(target, siteHost, includeSubdomains);
  /** @param {number} status @param {string} finalUrl @returns {HttpProbe} */
  const answer = (status, finalUrl) => ({ url: probeUrl, status, final_url: finalUrl, enforced: finalUrl.startsWith('https:') });
  /** @type {import('../net/polite.js').RedirectOutcome<'leaves'|'refused'>} */
  const chain = await followRedirects(probeUrl, {
    // The probe stops at the redirect that reaches the limit, without requesting its target.
    maxHops: LIMITS.maxRedirects - 1,
    request: (current) => fetch(current, { maxRedirects: 0, maxBytes: 1024 }),
    before: async (current, hop) => {
      if (hop > 0 && leaves(current)) return 'leaves';
      const robots = await robotsFor(/** @type {string} */ (originOf(current)));
      return robots.summary.status === 'unreachable' || !robots.isAllowed(current) ? 'refused' : undefined;
    },
  });
  if (chain.kind === 'stopped') return chain.value === 'refused' ? null : answer(/** @type {RedirectHop} */ (chain.hops.at(-1)).status, chain.url);
  if (chain.kind === 'unsent') return null;
  const { result } = chain;
  if (result.error !== null) return null;
  if (chain.kind === 'loop') return { url: probeUrl, status: result.status, final_url: /** @type {string} */ (chain.target), enforced: false };
  if (chain.kind === 'too_many') return answer(result.status, /** @type {string} */ (chain.target));
  return refusalOf(result) !== null ? null : answer(result.status, chain.url);
}
