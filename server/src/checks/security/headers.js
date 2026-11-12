/** @import { CheckContext, CheckDef, CheckResult, SecurityHeaders } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { VERIFIED, securedStartPage } from './helpers.js';

/** Referrer policies that send the full address of a page to every other site. */
const LEAKY_REFERRER_POLICIES = ['unsafe-url', 'no-referrer-when-downgrade'];
/** `frame-ancestors` sources that let any site frame the page. */
const ANY_FRAMER = new Set(['*', '*:*', 'http:', 'https:', 'http://*', 'https://*', 'http://*:*', 'https://*:*']);

/**
 * True when browsers refuse to show the page in a frame of any other site.
 * With one or more enforced header policies that have `frame-ancestors`, a
 * framer must pass every one of them, so framing is blocked when one policy
 * lists no source that matches any site (`*`, `http:`, `https:`); an empty
 * list allows no one. Such a policy makes browsers ignore X-Frame-Options.
 * Otherwise X-Frame-Options `DENY` or `SAMEORIGIN` blocks it, and so do
 * several values that include `deny`, `sameorigin` or `allowall` (HTML, 7.7).
 * @param {SecurityHeaders} headers
 * @returns {boolean}
 */
export function blocksFraming(headers) {
  if (headers.frame_ancestors.length > 0) {
    return headers.frame_ancestors.some((policy) => !policy.split(/\s+/).some((source) => ANY_FRAMER.has(source.toLowerCase())));
  }
  const values = headers.x_frame_options;
  if (values.length > 1) return values.some((value) => ['deny', 'sameorigin', 'allowall'].includes(value));
  return values[0] === 'deny' || values[0] === 'sameorigin';
}

/**
 * Build a check of the start page's headers. It has one unit, the start page,
 * when that is an html page; `applies` can narrow that further.
 * @param {Omit<CheckDef, 'module'|'engine'|'scope'|'requires'|'last_verified'|'run'> & {
 *   applies?: (ctx: CheckContext) => boolean,
 *   failure: (headers: SecurityHeaders) => {observed: unknown, expected: string, detail: string}|null,
 * }} spec
 * @returns {CheckDef}
 */
function headerCheck({ applies = () => true, failure, ...definition }) {
  return {
    ...definition,
    module: 'security',
    score_group: 'security_headers',
    engine: 'code',
    scope: 'site',
    requires: ['live_site'],
    last_verified: VERIFIED,
    run(ctx) {
      const start = securedStartPage(ctx);
      if (start === null || !applies(ctx)) return [];
      const failed = failure(start.security.headers);
      /** @type {CheckResult} */
      const result = failed === null ? { status: 'pass', url: start.url } : { status: 'fail', url: start.url, evidence: failed };
      return [result];
    },
  };
}

const NOT_RANKING = 'It protects visitors; Google does not use it for ranking.';

const hsts = headerCheck({
  id: 'security.headers.hsts_missing',
  title: 'Site does not tell browsers to use HTTPS only',
  description:
    `Checks that the start page of an https site sends Strict-Transport-Security with a max-age above 0, which makes browsers use https for the site from then on, so that a visitor's first plain-http request cannot be intercepted. Browsers read only the first such header and ignore an invalid one. ${NOT_RANKING}`,
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  doc_ref: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Strict-Transport-Security',
  recommendation:
    'Send Strict-Transport-Security: max-age=31536000 from the web server or CDN on every https response. Add includeSubDomains only when every subdomain works over https.',
  applies: (ctx) => ctx.site.https,
  failure: (headers) => (headers.hsts_max_age !== null && headers.hsts_max_age > 0 ? null : {
    observed: headers.hsts_max_age === 0 ? 'max-age=0' : 'No valid Strict-Transport-Security header',
    expected: 'Strict-Transport-Security with a max-age above 0',
    detail: headers.hsts_max_age === 0
      ? 'The start page sends Strict-Transport-Security with max-age=0, which tells browsers to forget the rule.'
      : 'The start page sends no Strict-Transport-Security header that browsers accept.',
  }),
});

const nosniff = headerCheck({
  id: 'security.headers.nosniff_missing',
  title: 'Browsers may guess the type of the site\'s files',
  description:
    `Checks that the start page sends X-Content-Type-Options: nosniff, which stops browsers from treating a file as another type than the server declared, for example running an uploaded text file as a script. ${NOT_RANKING}`,
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  doc_ref: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/X-Content-Type-Options',
  recommendation: 'Send X-Content-Type-Options: nosniff on every response from the web server or CDN.',
  failure: (headers) => (headers.nosniff ? null : {
    observed: 'No X-Content-Type-Options: nosniff',
    expected: 'X-Content-Type-Options: nosniff',
    detail: 'The start page does not send X-Content-Type-Options with the value nosniff first.',
  }),
});

const framing = headerCheck({
  id: 'security.headers.framing_missing',
  title: 'Other sites can show the site in a frame',
  description:
    `Checks that the start page tells browsers not to show it inside another site's frame, with a frame-ancestors directive in a Content-Security-Policy header or with X-Frame-Options DENY or SAMEORIGIN. Without it, another site can overlay the page and trick visitors into clicking (clickjacking). A frame-ancestors directive in a <meta> tag is ignored by browsers. ${NOT_RANKING}`,
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  doc_ref: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors',
  recommendation:
    "Send Content-Security-Policy: frame-ancestors 'self' (or X-Frame-Options: SAMEORIGIN) from the web server or CDN. List the sites that may frame the page if there are any.",
  failure: (headers) => (blocksFraming(headers) ? null : {
    observed: { frame_ancestors: headers.frame_ancestors, x_frame_options: headers.x_frame_options },
    expected: "frame-ancestors in a Content-Security-Policy header, or X-Frame-Options DENY or SAMEORIGIN",
    detail: headers.frame_ancestors.length > 0
      ? `The start page's frame-ancestors directive (${clip(headers.frame_ancestors.join('; '))}) lets every site frame it.`
      : 'The start page sends neither a frame-ancestors directive nor an X-Frame-Options value that browsers apply.',
  }),
});

const csp = headerCheck({
  id: 'security.headers.csp_missing',
  title: 'Site has no Content Security Policy',
  description:
    `Checks that the start page has an enforced Content-Security-Policy, in a header or a <meta> tag. A policy limits where scripts and other resources may load from, which contains the damage of injected code. Content-Security-Policy-Report-Only enforces nothing and does not count. Writing a policy takes work and many sites have none, so this is informational. ${NOT_RANKING}`,
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 3,
  confidence: 'confirmed',
  doc_ref: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CSP',
  recommendation:
    'Start with a Content-Security-Policy-Report-Only header to learn what the site loads, then enforce a policy that allows only those sources.',
  failure: (headers) => (headers.csp !== null ? null : {
    observed: 'No enforced Content-Security-Policy',
    expected: 'A Content-Security-Policy header or <meta http-equiv="Content-Security-Policy">',
    detail: 'The start page has no enforced Content Security Policy.',
  }),
});

const referrer = headerCheck({
  id: 'security.headers.referrer_leaky',
  title: 'Site sends its full addresses to other sites',
  description:
    `Checks the start page's referrer policy. Without one, browsers send other sites only the origin; unsafe-url and no-referrer-when-downgrade send the full address of the page, path and query included, which can expose private details. ${NOT_RANKING}`,
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  doc_ref: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Referrer-Policy',
  recommendation: 'Remove the policy, or set Referrer-Policy: strict-origin-when-cross-origin, which is what browsers use by default.',
  failure: (headers) => (headers.referrer_policy === null || !LEAKY_REFERRER_POLICIES.includes(headers.referrer_policy) ? null : {
    observed: headers.referrer_policy,
    expected: 'strict-origin-when-cross-origin or a stricter policy, or none',
    detail: `The start page sets the referrer policy ${headers.referrer_policy}, which sends the full address of a page to the sites it links to or loads from.`,
  }),
});

/** Checks of the security headers of the start page. */
export const headerChecks = [hsts, nosniff, framing, csp, referrer];
