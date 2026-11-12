// The security module's signals for one page: what the document hides and
// loads (security-scan.js), its spam terms, topic words and writing systems
// (terms.js), and, added by extractPage, its security headers. Pure.

/** @import { Heading, PageSecurity, SecurityHeaders } from '../types.js' */
/** @import { DomNode } from './dom.js' */
/** @import { ScanContext } from './security-scan.js' */

import { scanDocument } from './security-scan.js';
import { NO_SECURITY_HEADERS, securityHeaders } from './security-headers.js';
import { scriptLetters, spamTermHits, topicHits, urlWords } from './terms.js';

export { MAX_EMBEDS, MAX_HIDDEN_HOSTS, MAX_TRACKED_HOSTS, MAX_VISIBLE_HOSTS } from './security-scan.js';

/**
 * The security part of a page record, as far as the document can tell.
 *
 * - `hidden_links`, `visible_hosts`, `embeds`: from `scanDocument`.
 * - `spam_terms`: matches in the visible text (hidden text included) and in
 *   the words of external link URLs. Titles and descriptions are left out:
 *   they repeat the headline, which the text already has.
 * - `topic_terms`: spam terms and topic words in the titles, descriptions and
 *   headings, which say what the page is about.
 * - `scripts`: letters per writing system in the visible text.
 * - `headers`: only what the document says (`<meta>` CSP and referrer);
 *   `extractPage` adds the response headers.
 * @param {DomNode} document
 * @param {ScanContext} context
 * @param {{titles: string[], metaDescriptions: string[], headings: Heading[], visibleText: string}} text
 * @returns {{security: PageSecurity, limits: string[]}}  `limits`: the scan's caps the page reached (`ScanResult`).
 */
export function documentSecurity(document, context, text) {
  const scan = scanDocument(document, context);
  const linkWords = context.links.filter((link) => !link.internal && link.url !== null).map((link) => urlWords(/** @type {string} */ (link.url)));
  const security = {
    hidden_links: scan.hidden_links,
    visible_hosts: scan.visible_hosts,
    embeds: scan.embeds,
    spam_terms: spamTermHits([text.visibleText, ...linkWords]),
    topic_terms: topicHits([...text.titles, ...text.metaDescriptions, ...text.headings.map((heading) => heading.text)]),
    scripts: scriptLetters(text.visibleText),
    headers: securityHeaders(null, { metaCsp: scan.meta_csp, metaReferrer: scan.meta_referrer }),
  };
  return { security, limits: scan.limits };
}

/**
 * A page with no document to read: nothing hidden, nothing loaded, no text.
 * @param {SecurityHeaders} [headers]
 * @returns {PageSecurity}
 */
export function emptySecurity(headers = { ...NO_SECURITY_HEADERS, frame_ancestors: [], x_frame_options: [] }) {
  return { hidden_links: [], visible_hosts: [], embeds: [], spam_terms: {}, topic_terms: {}, scripts: {}, headers };
}

