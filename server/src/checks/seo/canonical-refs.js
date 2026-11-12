// What the canonical checks share: the selector of their findings and the
// canonicals that count.

/** @import { CanonicalRef, PageRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';

export const SELECTOR = 'link[rel=canonical]';
/** Canonicals quoted in evidence. */
export const MAX_LISTED = 5;

/**
 * The canonicals search engines read: in `<head>` or a header, with a valid URL.
 * @param {PageRecord} page
 * @returns {CanonicalRef[]}
 */
export function effectiveRefs(page) {
  return page.canonicals.filter((canonical) => canonical.in_head && canonical.url !== null);
}

/**
 * How a canonical is declared, for evidence.
 * @param {CanonicalRef} canonical
 * @returns {string}
 */
export function describeRef(canonical) {
  return canonical.source === 'header' ? `Link header: ${clip(canonical.href)}` : `<link> href: ${clip(canonical.href)}`;
}

/**
 * True for a link element that Next.js streamed into the body with the page's metadata.
 * @param {CanonicalRef} canonical
 */
export const isStreamed = (canonical) => canonical.streamed === true;
