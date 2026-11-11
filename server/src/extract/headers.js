// Response headers that the audit reads: X-Robots-Tag, Link, and a selection
// of headers kept on every record. Pure.

/** @import { CanonicalRef, FetchResult, HreflangRef } from '../types.js' */

import { LIMITS } from '../config.js';
import { normalizeUrl } from '../util/url.js';
import { clip, collapseWhitespace } from '../util/strings.js';

/** Headers copied onto `PageRecord.headers`. */
const KEPT_HEADERS = [
  'content-type', 'content-language', 'content-length', 'content-encoding',
  'cache-control', 'expires', 'last-modified', 'etag', 'vary',
  'x-robots-tag', 'link', 'location', 'refresh', 'retry-after',
  'strict-transport-security', 'content-security-policy', 'server',
];

/** Most robots tokens kept from `X-Robots-Tag` headers (REVIEW-FIXES R8). */
export const MAX_HEADER_ROBOTS_TOKENS = 50;

/** Rules that look like `name: value` but are not user-agent prefixes. */
const VALUE_DIRECTIVES = new Set(['max-snippet', 'max-image-preview', 'max-video-preview', 'unavailable_after']);

/**
 * Every value of a header, one entry per header line.
 * @param {FetchResult} result
 * @param {string} name Lower-case header name.
 * @returns {string[]}
 */
export function headerValues(result, name) {
  const lines = result.headerLines?.[name];
  if (Array.isArray(lines) && lines.length > 0) return lines;
  const joined = result.headers?.[name];
  return typeof joined === 'string' ? [joined] : [];
}

/**
 * The headers in `KEPT_HEADERS` that the response carried, values clipped.
 * @param {Record<string, string>|undefined} headers
 * @returns {Record<string, string>}
 */
export function selectHeaders(headers) {
  /** @type {Record<string, string>} */
  const kept = {};
  if (!headers) return kept;
  for (const name of KEPT_HEADERS) {
    const value = headers[name];
    if (typeof value === 'string') kept[name] = clip(value, LIMITS.maxStringLength);
  }
  return kept;
}

/**
 * Directive tokens from `X-Robots-Tag` header lines that apply to every
 * crawler or to Googlebot, lower-cased, in header order. A `name:` prefix
 * scopes the directives after it to that user agent, unless the name is a
 * value directive such as `max-snippet:` or `unavailable_after:`. At most
 * `MAX_HEADER_ROBOTS_TOKENS` tokens are kept, the first ones.
 * @param {string[]} lines
 * @returns {string[]}
 */
export function parseXRobots(lines) {
  /** @type {string[]} */
  const tokens = [];
  for (const line of lines) {
    /** @type {string|null} */
    let agent = null;
    /** @type {string[]} */
    const parts = [];
    for (const raw of line.split(',')) {
      const part = collapseWhitespace(raw).toLowerCase();
      const previous = parts.at(-1);
      // RFC 850 dates in unavailable_after contain a comma ("Wednesday, 03-Nov-2027 ...").
      if (previous?.includes('unavailable_after:') && /^\d/.test(part)) {
        parts[parts.length - 1] = `${previous}, ${part}`;
        continue;
      }
      parts.push(part);
    }
    for (let part of parts) {
      const prefixed = /^([a-z0-9_.*-]+)\s*:\s*(.*)$/.exec(part);
      if (prefixed && !VALUE_DIRECTIVES.has(prefixed[1])) {
        agent = prefixed[1];
        part = prefixed[2];
      }
      if (part === '') continue;
      if (tokens.length >= MAX_HEADER_ROBOTS_TOKENS) return tokens;
      if (agent === null || agent === 'googlebot') tokens.push(clip(part, LIMITS.maxStringLength));
    }
  }
  return tokens;
}

/**
 * Parameters of one `Link` header entry, lower-cased names.
 * @param {string} text Everything after the `<uri>` part.
 * @returns {Map<string, string>}
 */
function linkParams(text) {
  /** @type {Map<string, string>} */
  const params = new Map();
  const pattern = /;\s*([a-z0-9*_-]+)\s*(?:=\s*(?:"([^"]*)"|([^;,\s]*)))?/gi;
  for (const match of text.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    if (!params.has(name)) params.set(name, match[2] ?? match[3] ?? '');
  }
  return params;
}

/**
 * Canonical and hreflang references from `Link` header lines. A line may carry
 * several comma-separated links. Relative URLs resolve against `baseUrl`.
 * @param {string[]} lines
 * @param {string} baseUrl
 * @returns {{canonicals: CanonicalRef[], hreflang: HreflangRef[]}}
 */
export function parseLinkHeaders(lines, baseUrl) {
  /** @type {CanonicalRef[]} */
  const canonicals = [];
  /** @type {HreflangRef[]} */
  const hreflang = [];
  for (const line of lines) {
    for (const match of line.matchAll(/<([^>]*)>([^<]*)/g)) {
      const href = match[1].trim();
      const params = linkParams(match[2]);
      const rel = (params.get('rel') ?? '').toLowerCase().split(/\s+/);
      const url = normalizeUrl(href, baseUrl);
      const clipped = clip(href, LIMITS.maxStringLength);
      if (rel.includes('canonical')) {
        canonicals.push({ href: clipped, url, source: 'header', in_head: true, line: null });
      }
      const lang = params.get('hreflang');
      if (rel.includes('alternate') && lang) {
        hreflang.push({ hreflang: clip(lang.trim(), LIMITS.maxStringLength), href: clipped, url, source: 'header' });
      }
    }
  }
  return { canonicals, hreflang };
}
