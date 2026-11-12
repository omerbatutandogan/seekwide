// robots.txt loading and evaluation for one origin.

import { PRODUCT_TOKEN } from '../config.js';
import { normalizeUrl, originOf } from '../util/url.js';
import { followRedirects } from './polite.js';
import { compileGroup, decidingRule, rulePath } from './robots-match.js';
import { agentToken, groupFor, parseRobotsTxt } from './robots-parse.js';
import { safeFetch } from './safe-fetch.js';

/** @import { RobotsSummary } from '../types.js' */
/** @import { ParsedRobots } from './robots-parse.js' */

/** Google and RFC 9309 read at least 500 KiB of a robots.txt file; rules after that are ignored. */
const MAX_ROBOTS_BYTES = 500 * 1024;
const PROBE_PATH = '/seekwide-probe-path';
/** RFC 9309 2.3.1.2 and Google: follow at least five redirects, then treat the file as absent. */
const MAX_ROBOTS_REDIRECTS = 5;

/**
 * A function that says whether a crawler with these product tokens (most
 * specific first) may fetch a URL of the file's origin: the group of the first
 * token that has one, else the `*` group. Rules are evaluated by
 * `robots-match.js`, in time linear in the path.
 * @param {ParsedRobots} parsed
 * @param {string[]} agents
 * @returns {(url: string) => boolean}
 */
function rulesFor(parsed, agents) {
  const group = compileGroup(groupFor(parsed, agents));
  return (url) => decidingRule(group, rulePath(url))?.allow ?? true;
}

/**
 * As `rulesFor`, for another crawler: a token the file names in a group that
 * has no rule at all, before any token with rules, is allowed everything
 * (RFC 9309). The crawler's own token keeps the reading of version 0.1.0, where
 * such a group fell back to `*`.
 * @param {ParsedRobots} parsed
 * @param {string[]} agents
 * @returns {(url: string) => boolean}
 */
function rulesForTokens(parsed, agents) {
  for (const agent of agents) {
    const token = agentToken(agent);
    if (parsed.groups.has(token)) break;
    if (parsed.named.has(token)) return () => true;
  }
  return rulesFor(parsed, agents);
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
 * `allowsAgents(url, agents)` answers the same question for another crawler,
 * given its product tokens most specific first (`["Googlebot-Image",
 * "Googlebot"]`): the group of the first token that has one, else `*`.
 *
 * @param {string} siteOrigin  for example "https://example.com"
 * @param {{fetch?: typeof safeFetch, fetchOptions?: Parameters<typeof safeFetch>[1], productToken?: string}} [options]
 * @returns {Promise<{summary: RobotsSummary, isAllowed: (url: string) => boolean, refusedRedirect: string|null,
 *   allowsAgents: (url: string, agents: string[]) => boolean}>}
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
  const chain = await followRedirects(url, { maxHops: MAX_ROBOTS_REDIRECTS, request: (target) => fetch(target, requestOptions) });
  if (chain.kind === 'stopped' || chain.kind === 'unsent') throw new TypeError('loadRobots: a robots.txt request must be sent');
  const current = chain.url;
  const { result } = chain;
  // A loop, or more than five redirects, means the file is absent; a redirect without a usable Location is a failure.
  const gaveUp = chain.kind === 'loop' || chain.kind === 'too_many';

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
    return { summary, isAllowed: (target) => !sameOrigin(target), refusedRedirect, allowsAgents: (target) => !sameOrigin(target) };
  }
  if (summary.status === 'missing') {
    return { summary, isAllowed: () => true, refusedRedirect: null, allowsAgents: () => true };
  }

  const text = (result.body ?? Buffer.alloc(0)).toString('utf8').replace(/^\uFEFF/, '');
  const parsed = parseRobotsTxt(text);

  const delay = groupFor(parsed, [productToken])?.crawlDelay;
  summary.crawl_delay_sec = typeof delay === 'number' && Number.isFinite(delay) && delay >= 0 ? delay : null;
  summary.disallows_all = disallowsAll(rulesFor(parsed, ['*']), origin);
  summary.disallows_all_googlebot = disallowsAll(rulesFor(parsed, ['Googlebot']), origin);
  const allows = rulesFor(parsed, [productToken]);

  const seen = new Set();
  for (const raw of parsed.sitemaps) {
    const normalized = normalizeUrl(raw, url);
    if (normalized === null || seen.has(normalized)) continue;
    seen.add(normalized);
    summary.sitemaps.push(normalized);
  }

  /** @type {Map<string, (url: string) => boolean>} */
  const byAgents = new Map();
  return {
    summary,
    isAllowed: (target) => !sameOrigin(target) || allows(target),
    refusedRedirect: null,
    allowsAgents: (target, agents) => {
      if (!sameOrigin(target)) return true;
      const key = agents.join('\n');
      let rules = byAgents.get(key);
      if (!rules) {
        rules = rulesForTokens(parsed, agents);
        byAgents.set(key, rules);
      }
      return rules(target);
    },
  };
}
