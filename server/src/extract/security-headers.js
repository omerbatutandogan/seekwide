// The security headers of one response, read the way browsers read them. Pure.
// Values are parsed from the full header, not from the clipped copy kept on
// the record.

/** @import { FetchResult, SecurityHeaders } from '../types.js' */

import { headerValues } from './headers.js';

const REFERRER_POLICIES = new Set([
  'no-referrer', 'no-referrer-when-downgrade', 'same-origin', 'origin', 'strict-origin',
  'origin-when-cross-origin', 'strict-origin-when-cross-origin', 'unsafe-url',
]);
/** Legacy values a `<meta name="referrer">` still accepts (HTML standard). */
const META_REFERRER_ALIASES = new Map([
  ['never', 'no-referrer'], ['default', 'strict-origin-when-cross-origin'], ['always', 'unsafe-url'],
  ['origin-when-crossorigin', 'origin-when-cross-origin'],
]);

/**
 * `max-age` of a Strict-Transport-Security value (RFC 6797, 6.1): directive
 * names in any letter case, a value that may be quoted, each directive at
 * most once. Null when the value is invalid, which makes browsers ignore it.
 * @param {string} value
 * @returns {number|null}
 */
export function hstsMaxAge(value) {
  const seen = new Set();
  let maxAge = null;
  for (const part of value.split(';')) {
    const directive = part.trim();
    if (directive === '') continue;
    const match = /^([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*(?:=\s*(?:"([^"]*)"|([^\s"]*)))?$/.exec(directive);
    if (!match) return null;
    const name = match[1].toLowerCase();
    if (seen.has(name)) return null;
    seen.add(name);
    if (name === 'max-age') {
      const raw = match[2] ?? match[3] ?? '';
      if (!/^\d+$/.test(raw)) return null;
      maxAge = Number(raw);
    }
  }
  return maxAge;
}

/**
 * Directives of every enforced policy in the Content-Security-Policy header
 * lines (a line may hold several policies, separated by commas).
 * @param {string[]} lines
 * @returns {Map<string, string>[]}
 */
function cspPolicies(lines) {
  return lines.flatMap((line) => line.split(',')).map((policy) => {
    /** @type {Map<string, string>} */
    const directives = new Map();
    for (const raw of policy.split(';')) {
      const [name, ...sources] = raw.trim().split(/\s+/);
      const key = (name ?? '').toLowerCase();
      // The first occurrence of a directive counts; later ones are ignored (CSP 3).
      if (key !== '' && !directives.has(key)) directives.set(key, sources.join(' '));
    }
    return directives;
  }).filter((directives) => directives.size > 0);
}

/**
 * The policy a `<meta name="referrer">` sets, with the legacy values mapped as
 * the HTML standard maps them; null when the value is not a valid policy,
 * which leaves the policy as it was.
 * @param {string|null} content
 * @returns {string|null}
 */
export function metaReferrerPolicy(content) {
  if (content === null) return null;
  const value = content.trim().toLowerCase();
  const policy = META_REFERRER_ALIASES.get(value) ?? value;
  return REFERRER_POLICIES.has(policy) ? policy : null;
}

/**
 * The effective policy of a Referrer-Policy header: the last recognized
 * token wins (Referrer Policy, 8.1).
 * @param {string[]} lines
 * @returns {string|null}
 */
function headerReferrerPolicy(lines) {
  let policy = null;
  for (const token of lines.flatMap((line) => line.split(','))) {
    const value = token.trim().toLowerCase();
    if (REFERRER_POLICIES.has(value)) policy = value;
  }
  return policy;
}

/**
 * The security headers of a response, together with what the document said
 * in its `<head>`: a Content-Security-Policy `<meta http-equiv>` and a
 * `<meta name="referrer">`.
 *
 * - `hsts_max_age`: from the first Strict-Transport-Security header, which is
 *   the only one browsers read; null when there is none or it is invalid.
 * - `nosniff`: the first X-Content-Type-Options value is `nosniff`.
 * - `csp`: an enforced policy came in a header (`header`) or only in the
 *   document (`meta`); Content-Security-Policy-Report-Only enforces nothing.
 * - `frame_ancestors`: for each header policy that has a `frame-ancestors`
 *   directive, all its sources (at most 10 policies); a `<meta>` policy cannot set it.
 * - `x_frame_options`: the distinct X-Frame-Options values, lower-cased (at most 20).
 * - `referrer_policy`: the document's policy: the last valid
 *   `<meta name="referrer">` (`documentSays.metaReferrer`, already read with
 *   `metaReferrerPolicy`), else the header; null when neither sets one.
 * @param {FetchResult|null} result  Null for the document alone.
 * @param {{metaCsp: boolean, metaReferrer: string|null}} documentSays
 * @returns {SecurityHeaders}
 */
export function securityHeaders(result, documentSays) {
  const values = (/** @type {string} */ name) => (result === null ? [] : headerValues(result, name));
  const sts = values('strict-transport-security');
  const nosniff = values('x-content-type-options').flatMap((line) => line.split(','))[0];
  const policies = cspPolicies(values('content-security-policy'));
  // Kept whole: a source list is judged by every source in it. The response headers are at most 16 KB in all.
  const frameAncestors = policies.filter((directives) => directives.has('frame-ancestors'))
    .map((directives) => /** @type {string} */ (directives.get('frame-ancestors')));
  const xfo = [...new Set(values('x-frame-options').flatMap((line) => line.split(',')).map((value) => value.trim().toLowerCase()).filter(Boolean))];
  return {
    hsts_max_age: sts.length > 0 ? hstsMaxAge(sts[0]) : null,
    nosniff: nosniff !== undefined && nosniff.trim().toLowerCase() === 'nosniff',
    csp: policies.length > 0 ? 'header' : documentSays.metaCsp ? 'meta' : null,
    frame_ancestors: frameAncestors.slice(0, 10),
    x_frame_options: xfo.slice(0, 20).map((value) => value.slice(0, 60)),
    referrer_policy: metaReferrerPolicy(documentSays.metaReferrer) ?? headerReferrerPolicy(values('referrer-policy')),
  };
}

/** The headers of a response that was not read. */
export const NO_SECURITY_HEADERS = Object.freeze({
  hsts_max_age: null, nosniff: false, csp: null, frame_ancestors: [], x_frame_options: [], referrer_policy: null,
});
