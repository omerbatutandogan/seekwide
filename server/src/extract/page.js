// PageRecord builders. The crawler follows redirects itself, one hop at a time,
// and composes the records of one URL from these three functions.
// All pure: no I/O, no clock, no randomness.

/** @import { FetchResult, Indexability, PageRecord, RedirectHop } from '../types.js' */
/** @import { HtmlFields } from './html.js' */

import { normalizeUrl } from '../util/url.js';
import { decodeBody, isHtmlResponse, mediaTypeOf } from './decode.js';
import { headerValues, parseLinkHeaders, parseXRobots, selectHeaders } from './headers.js';
import { CAPS, extractHtml, upgradesInsecureRequests } from './html.js';

const NOINDEX = ['noindex', 'none'];

/**
 * @typedef {Object} RecordBase
 * @property {string} url
 * @property {number|null} depth
 * @property {PageRecord['discovered_via']} discoveredVia
 */

/** @returns {HtmlFields} */
function emptyContent() {
  return {
    html_lang: null, titles: [], meta_descriptions: [], meta_robots: [], canonicals: [], hreflang: [],
    headings: [], viewport: null, og: {}, twitter: {}, links: [], images: [], jsonld: [], mixed_content: [],
    word_count: 0, text_hash: '', text_excerpt: '',
  };
}

/**
 * @param {string} raw
 * @returns {string}
 */
function recordUrl(raw) {
  return normalizeUrl(raw) ?? raw;
}

/**
 * Reasons in the documented order: fetch_error, redirect, status_<code>,
 * not_html, noindex_meta, noindex_header, canonical_elsewhere. A record with
 * no response (status 0), with an unusable response (`fetch_error`) or for a
 * followed redirect gets no status or not_html reason.
 * @param {Omit<PageRecord, 'indexability'>} record
 * @returns {Indexability}
 */
function indexabilityOf(record) {
  /** @type {string[]} */
  const reasons = [];
  if (record.fetch_error !== null || record.status === 0) reasons.push('fetch_error');
  if (record.redirect_chain.length > 0) {
    reasons.push('redirect');
  } else if (record.status !== 0 && record.fetch_error === null) {
    if (record.status !== 200) reasons.push(`status_${record.status}`);
    if (!record.is_html) reasons.push('not_html');
  }
  if (record.meta_robots.some((token) => NOINDEX.includes(token))) reasons.push('noindex_meta');
  if (record.x_robots.some((token) => NOINDEX.includes(token))) reasons.push('noindex_header');
  const effective = record.canonicals.filter((canonical) => canonical.in_head && canonical.url !== null);
  if (effective.length > 0 && effective.every((canonical) => canonical.url !== record.url)) {
    reasons.push('canonical_elsewhere');
  }
  return { indexable: reasons.length === 0, reasons };
}

/**
 * A record with every field in contract order and no content.
 * @param {RecordBase & {status: number, fetchError: string|null}} base
 * @param {Partial<PageRecord>} fields
 * @returns {PageRecord}
 */
function buildRecord(base, fields) {
  const url = recordUrl(base.url);
  /** @type {Omit<PageRecord, 'indexability'>} */
  const record = {
    url,
    status: base.status,
    final_url: url,
    final_status: base.status,
    final_external: false,
    redirect_chain: [],
    depth: base.depth,
    discovered_via: [...base.discoveredVia],
    content_type: null,
    headers: {},
    is_html: false,
    bytes: 0,
    fetch_ms: 0,
    fetch_error: base.fetchError,
    x_robots: [],
    ...emptyContent(),
    ...fields,
  };
  return { ...record, indexability: indexabilityOf(record) };
}

/**
 * The record for one response of any status, as answered by `url` itself
 * (`redirect_chain` is empty; the crawler builds redirect records with
 * `redirectRecord`).
 *
 * Guarantees: when `result.error` is set (or no response arrived) the record
 * has status 0, `fetch_error`, no headers and no content, whatever the result
 * carries. Otherwise HTML is extracted for every HTML response whatever its
 * status; a non-HTML response gets empty content fields but its
 * `X-Robots-Tag` and `Link` headers still apply. Strings are clipped and lists
 * capped as REVIEW-FIXES R8 and ARCHITECTURE.md 4.6 describe.
 * @param {{url: string, result: FetchResult, depth: number|null, discoveredVia: PageRecord['discovered_via'],
 *          siteHost: string, includeSubdomains?: boolean}} input
 * @returns {PageRecord}
 */
export function extractPage(input) {
  const { result } = input;
  if (result.error || result.status === 0) {
    return buildRecord(
      { ...input, status: 0, fetchError: result.error?.code ?? null },
      { fetch_ms: result.elapsedMs },
    );
  }

  const url = recordUrl(input.url);
  const responseUrl = normalizeUrl(result.finalUrl) === null ? url : result.finalUrl.trim();
  const contentType = result.headers?.['content-type'];
  const mediaType = mediaTypeOf(contentType);
  const isHtml = isHtmlResponse(mediaType, result.body);
  const upgradeInsecure = headerValues(result, 'content-security-policy').some(upgradesInsecureRequests);

  const content = isHtml && result.body && result.body.length > 0
    ? extractHtml(decodeBody(result.body, contentType).text, {
      responseUrl, siteHost: input.siteHost, includeSubdomains: input.includeSubdomains ?? false, upgradeInsecure,
    })
    : emptyContent();
  const fromHeaders = parseLinkHeaders(headerValues(result, 'link'), responseUrl);

  return buildRecord({ ...input, status: result.status, fetchError: null }, {
    content_type: mediaType,
    headers: selectHeaders(result.headers),
    is_html: isHtml,
    bytes: result.bytes,
    fetch_ms: result.elapsedMs,
    ...content,
    x_robots: parseXRobots(headerValues(result, 'x-robots-tag')),
    canonicals: [...content.canonicals, ...fromHeaders.canonicals].slice(0, CAPS.canonicals),
    hreflang: [...content.hreflang, ...fromHeaders.hreflang].slice(0, CAPS.hreflang),
  });
}

/**
 * The record for a URL that answered with a redirect: the first hop's 3xx
 * status, the whole chain, where it ended, and no content. `fetchError` is set
 * when the chain did not end in a usable response; `finalStatus` is then 0.
 * @param {{url: string, hops: RedirectHop[], finalUrl: string, finalStatus: number, finalExternal: boolean,
 *          fetchError: string|null, depth: number|null, discoveredVia: PageRecord['discovered_via']}} input
 * @returns {PageRecord}
 * @throws {TypeError} when `hops` is empty.
 */
export function redirectRecord(input) {
  if (!Array.isArray(input.hops) || input.hops.length === 0) {
    throw new TypeError('redirectRecord needs at least one redirect hop.');
  }
  return buildRecord({ ...input, status: input.hops[0].status, fetchError: input.fetchError }, {
    final_url: recordUrl(input.finalUrl),
    final_status: input.finalStatus,
    final_external: input.finalExternal,
    redirect_chain: input.hops.map((hop) => ({ url: hop.url, status: hop.status, location: hop.location })),
  });
}

/**
 * A record with no content for a URL the crawler could not read (a bot
 * challenge, persistent rate limiting): the response's status, `fetchError`,
 * and `indexability` `{indexable: false, reasons: ['fetch_error']}`.
 * @param {{url: string, status: number, fetchError: string, depth: number|null,
 *          discoveredVia: PageRecord['discovered_via']}} input
 * @returns {PageRecord}
 */
export function unreadableRecord(input) {
  return buildRecord(input, {});
}
