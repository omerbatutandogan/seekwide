// The http:// probe: does the site send plain-http visitors to https?

import { LIMITS } from '../config.js';
import { isInternalUrl, normalizeUrl, originOf } from '../util/url.js';
import { refusalOf } from './chain.js';

/** @import { FetchResult, HttpProbe } from '../types.js' */
/** @import { safeFetch } from '../net/safe-fetch.js' */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

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
  let current = probeUrl;
  const seen = new Set([probeUrl]);
  for (let hops = 0; ; hops += 1) {
    const robots = await robotsFor(/** @type {string} */ (originOf(current)));
    if (robots.summary.status === 'unreachable' || !robots.isAllowed(current)) return null;
    const result = await fetch(current, { maxRedirects: 0, maxBytes: 1024 });
    if (result.error !== null) return null;
    const target = REDIRECT_STATUSES.has(result.status) ? normalizeUrl(result.headers.location ?? '', current) : null;
    if (target === null && refusalOf(result) !== null) return null;
    if (target !== null && seen.has(target)) return { url: probeUrl, status: result.status, final_url: target, enforced: false };
    const stop = target === null || !target.startsWith('http:') || hops + 1 >= LIMITS.maxRedirects ||
      !isInternalUrl(target, siteHost, includeSubdomains);
    if (stop) {
      const finalUrl = target ?? current;
      return { url: probeUrl, status: result.status, final_url: finalUrl, enforced: finalUrl.startsWith('https:') };
    }
    seen.add(target);
    current = target;
  }
}
