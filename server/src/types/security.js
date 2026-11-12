// Signals the security module reads from a page (ARCHITECTURE.md 4.14). No runtime code.

export {};

/**
 * The first link of a page to one other host that visitors cannot see (`extract/security-scan.js`).
 * @typedef {Object} HiddenLinkRecord
 * @property {number} index           Position of the link in `PageRecord.links`.
 * @property {string} url             Normalized URL, clipped.
 * @property {string} host            `hostKey` of the URL's host.
 * @property {string} text            The link's text, clipped.
 * @property {string} how             'display:none', 'hidden attribute', 'visibility:hidden', 'font-size:0', 'off-screen',
 *   'zero size' or 'one-character link'.
 * @property {string|null} element    The hiding element and the attribute that hides it, for example `div[style="display:none"]`,
 *   clipped; null for a one-character link.
 * @property {number|null} element_line
 * @property {number|null} line       Line of the link.
 * @property {number} count           How many links of the page to this host visitors cannot see.
 */

/**
 * A script or frame loaded from another host.
 * @typedef {Object} EmbedRecord
 * @property {'script'|'iframe'} tag
 * @property {string} url             Normalized URL of `src`.
 * @property {string} host            `hostKey` of the URL's host.
 * @property {string|null} hidden     For a frame: how the markup hides it ('zero size' for a width or height of 2 pixels or
 *   less, or one of the `HiddenLinkRecord.how` values); null when it is not hidden, and always for a script.
 * @property {number|null} line
 */

/**
 * @typedef {Object} TermHits
 * @property {number} count           Matches in the text.
 * @property {string[]} terms         The first five distinct terms matched.
 */

/**
 * The security headers of a response, read as browsers read them (`extract/security-headers.js`).
 * @typedef {Object} SecurityHeaders
 * @property {number|null} hsts_max_age  `max-age` of the first Strict-Transport-Security header; null when absent or invalid.
 * @property {boolean} nosniff         The first X-Content-Type-Options value is `nosniff`.
 * @property {'header'|'meta'|null} csp  Where an enforced Content-Security-Policy came from.
 * @property {string[]} frame_ancestors  For each header policy with a `frame-ancestors` directive, its sources.
 * @property {string[]} x_frame_options  Distinct X-Frame-Options values, lower-cased.
 * @property {string|null} referrer_policy  The document's referrer policy from `<meta name="referrer">` or the header; null when neither sets one.
 */

/**
 * What the security module reads from one page (`extract/security.js`).
 * @typedef {Object} PageSecurity
 * @property {HiddenLinkRecord[]} hidden_links  One per host that the page does not also link to visibly, at most 200 hosts, in document order.
 * @property {string[]} visible_hosts  Hosts of the page's links to other hosts that visitors can see, at most 1000.
 * @property {EmbedRecord[]} embeds    Scripts and frames from other hosts, at most 200, in document order.
 * @property {Record<string, TermHits>} spam_terms  Per category (`pharma`, `gambling`, `counterfeit`) with one or more matches in the
 *   whole visible text and the words of external link URLs.
 * @property {Record<string, TermHits>} topic_terms  Spam terms and topic words per category in the titles, meta descriptions and headings.
 * @property {Record<string, number>} scripts  Letters per writing system in the first 50,000 characters of the visible text.
 * @property {SecurityHeaders} headers
 */
