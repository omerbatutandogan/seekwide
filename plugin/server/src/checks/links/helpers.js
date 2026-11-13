/** @import { LinkRecord, PageRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';

/**
 * One internal link target on a page, with every link on that page that points at it.
 * @typedef {Object} LinkTarget
 * @property {string} url              Normalized target URL.
 * @property {LinkRecord[]} links      Links to the target on the page, in document order (never empty).
 */

/**
 * The selector `a[href="<href>"]` for a raw href. The href is clipped first, then
 * `\` and `"` are escaped so a quote in an href cannot end the selector early.
 * @param {string} href
 * @returns {string}
 */
export function hrefSelector(href) {
  return `a[href="${clip(href).replace(/[\\"]/g, '\\$&')}"]`;
}

/**
 * The `selector` of a link result: `a[href="<raw href>"]`.
 * The same link always gives the same selector, which keeps finding ids stable.
 * @param {LinkRecord} link
 * @returns {string}
 */
export function linkSelector(link) {
  return hrefSelector(link.href);
}

/**
 * Distinct internal link targets of a page: distinct normalized `link.url` values
 * among links with `internal: true` and a non-null `url`. A page that links to
 * itself includes itself. Targets are ordered by their first appearance on the page.
 * @param {PageRecord} page
 * @returns {LinkTarget[]}
 */
export function distinctInternalTargets(page) {
  /** @type {Map<string, LinkTarget>} */
  const targets = new Map();
  for (const link of page.links) {
    if (!link.internal || link.url === null) continue;
    const target = targets.get(link.url);
    if (target) target.links.push(link);
    else targets.set(link.url, { url: link.url, links: [link] });
  }
  return [...targets.values()];
}

/**
 * Ascending string comparison by code unit, the same order the engine uses.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
