// robots.txt loading and evaluation for one origin.

import robotsParser from 'robots-parser';

import { PRODUCT_TOKEN } from '../config.js';
import { normalizeUrl, originOf } from '../util/url.js';
import { compiledGroup, decidingRule, rulePath } from './robots-match.js';
import { safeFetch } from './safe-fetch.js';

/** @import { RobotsSummary } from '../types.js' */

/**
 * The parts of a robots-parser instance this module uses.
 * @typedef {{isAllowed(url: string, ua?: string): boolean|undefined, getCrawlDelay(ua?: string): number|undefined, getSitemaps(): string[]}} RobotsRules
 */

/** Google and RFC 9309 read at least 500 KiB of a robots.txt file; rules after that are ignored. */
const MAX_ROBOTS_BYTES = 500 * 1024;
const PROBE_PATH = '/seekwide-probe-path';
/** RFC 9309 2.3.1.2 and Google: follow at least five redirects, then treat the file as absent. */
const MAX_ROBOTS_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * A function that says whether `agent` may fetch a URL of the file's origin.
 * The rules robots-parser read are evaluated by `robots-match.js`, in time
 * linear in the path; robots-parser's own matcher is used only if its rules
 * are not held the way the pinned version holds them.
 * @param {RobotsRules} parser
 * @param {string} agent
 * @returns {(url: string) => boolean}
 */
function rulesFor(parser, agent) {
  const group = compiledGroup(parser, agent);
  if (group === null) return (url) => parser.isAllowed(url, agent) !== false;
  return (url) => decidingRule(group, rulePath(url))?.allow ?? true;
}

/**
 * @param {(url: string) => boolean} allows
 * @param {string} origin
 * @returns {boolean}
 */
function disallowsAll(allows, origin) {
  return !allows(`${origin}/`) && !allows(`${origin}${PROBE_PATH}`);
}

/**
 * Load and parse `<origin>/robots.txt`.
 *
 * Guarantees: `isAllowed` answers true for every URL on another origin; for
 * this origin it follows the rules for `productToken` when the file was read
 * ('ok'), allows everything when the file is absent ('missing', a 4xx other
 * than 429), and allows nothing when the file could not be read
 * ('unreachable': 429, 5xx, another status, a redirect without a valid
 * http(s) Location, or a network error).
 *
 * Redirects are followed by hand, one `fetch` call with `maxRedirects: 0` per
 * hop, so the caller's pacing applies to every hop. More than five redirects,
 * or a loop, means 'missing' (RFC 9309 2.3.1.2). Whatever URL the file came
 * from, its rules apply to `siteOrigin`. `http_status` is the last status received.
 * `refusedRedirect` is the address a redirect led to when that request was
 * refused as an address that may not be contacted (`blocked_address`), so a
 * caller can say why the file could not be read; null otherwise.
 *
 * @param {string} siteOrigin  for example "https://example.com"
 * @param {{fetch?: typeof safeFetch, fetchOptions?: Parameters<typeof safeFetch>[1], productToken?: string}} [options]
 * @returns {Promise<{summary: RobotsSummary, isAllowed: (url: string) => boolean, refusedRedirect: string|null}>}
 */
export async function loadRobots(siteOrigin, options = {}) {
  const origin = typeof siteOrigin === 'string' ? originOf(siteOrigin) : null;
  if (origin === null || origin === 'null') throw new TypeError(`loadRobots needs an http(s) origin, got ${String(siteOrigin)}`);
  const { fetch = safeFetch, fetchOptions = {}, productToken = PRODUCT_TOKEN } = options;
  const url = `${origin}/robots.txt`;

  const maxBytes = Math.min(fetchOptions.maxBytes ?? MAX_ROBOTS_BYTES, MAX_ROBOTS_BYTES);
  const requestOptions = {
    ...fetchOptions,
    method: /** @type {const} */ ('GET'),
    maxBytes,
    maxRedirects: 0,
    headers: { ...fetchOptions.headers, accept: 'text/plain,*/*;q=0.5' },
  };
  let current = url;
  const visited = new Set([url]);
  let gaveUp = false;
  let result = await fetch(current, requestOptions);
  for (let hops = 0; result.error === null && REDIRECT_STATUSES.has(result.status); hops += 1) {
    const target = normalizeUrl(result.headers.location ?? '', current);
    if (target === null) break;
    if (visited.has(target) || hops + 1 > MAX_ROBOTS_REDIRECTS) {
      gaveUp = true;
      break;
    }
    visited.add(target);
    current = target;
    result = await fetch(current, requestOptions);
  }

  /** @type {RobotsSummary} */
  const summary = {
    status: 'unreachable',
    http_status: result.status,
    url,
    sitemaps: [],
    crawl_delay_sec: null,
    disallows_all: false,
    disallows_all_googlebot: false,
  };

  const status = result.status;
  const refusedRedirect = current !== url && result.error?.code === 'blocked_address' ? current : null;
  if (gaveUp) {
    summary.status = 'missing';
  } else if (result.error === null && status >= 200 && status < 300) {
    summary.status = 'ok';
  } else if (result.error === null && status >= 400 && status < 500 && status !== 429) {
    summary.status = 'missing';
  }

  /** @param {string} target */
  const sameOrigin = (target) => originOf(target) === origin;

  if (summary.status === 'unreachable') {
    return { summary, isAllowed: (target) => !sameOrigin(target), refusedRedirect };
  }
  if (summary.status === 'missing') {
    return { summary, isAllowed: () => true, refusedRedirect: null };
  }

  const text = (result.body ?? Buffer.alloc(0)).toString('utf8').replace(/^\uFEFF/, '');
  // robots-parser is CommonJS; its type declaration does not describe the default import correctly.
  const parser = /** @type {RobotsRules} */ (/** @type {any} */ (robotsParser)(url, text));

  const delay = parser.getCrawlDelay(productToken);
  summary.crawl_delay_sec = typeof delay === 'number' && Number.isFinite(delay) && delay >= 0 ? delay : null;
  summary.disallows_all = disallowsAll(rulesFor(parser, '*'), origin);
  summary.disallows_all_googlebot = disallowsAll(rulesFor(parser, 'Googlebot'), origin);
  const allows = rulesFor(parser, productToken);

  const seen = new Set();
  for (const raw of parser.getSitemaps()) {
    const normalized = normalizeUrl(raw, url);
    if (normalized === null || seen.has(normalized)) continue;
    seen.add(normalized);
    summary.sitemaps.push(normalized);
  }

  return {
    summary,
    isAllowed: (target) => !sameOrigin(target) || allows(target),
    refusedRedirect: null,
  };
}
