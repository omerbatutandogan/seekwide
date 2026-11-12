// The anchor-text checks: links.anchor.empty and links.anchor.generic.

/** @import { CheckDef, CheckResult, LinkRecord, PageRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { GENERIC_ANCHORS, normalizeAnchorText } from './generic-anchors.js';
import { linkSelector } from './helpers.js';

/** The day the crawlable-links page was last read against the anchor checks. */
export const LAST_VERIFIED = '2026-11-12';
export const DOC_LINKS = 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable';

/**
 * True for a link the anchor-text checks leave out: one hidden from screen
 * readers (`aria-hidden="true"` on it or around it, which marks a copy such as
 * a heading permalink or a card's image link), or one that only points into
 * the page itself (an empty href or a fragment: `#`, `#id`), which leads to no
 * other page.
 * @param {LinkRecord} link
 * @param {PageRecord} page
 * @returns {boolean}
 */
export function outOfScope(link, page) {
  if (link.aria_hidden === true) return true;
  const href = link.href.trim();
  return link.url === page.url && (href === '' || href.includes('#'));
}

/** @param {string} text */
const isGeneric = (text) => GENERIC_ANCHORS.has(normalizeAnchorText(text));

/**
 * The targets of a page's links that pass a test, among the links the checks
 * look at: a link hidden from screen readers, or one into the page itself
 * (`#main`, a skip link), names no page.
 * @param {PageRecord} page
 * @param {(link: LinkRecord) => boolean} test
 * @returns {Set<string>}
 */
function targetsWhere(page, test) {
  /** @type {Set<string>} */
  const targets = new Set();
  for (const link of page.links) if (link.url !== null && !outOfScope(link, page) && test(link)) targets.add(link.url);
  return targets;
}

/** @param {LinkRecord} link @returns {boolean} The link has text, an aria-label or a title. */
const named = (link) => link.text.trim() !== '' || link.aria_label !== null || (link.title_attr ?? null) !== null;
/** @param {LinkRecord} link @returns {boolean} The link's text or aria-label describes where it goes. */
const descriptive = (link) => (link.text.trim() !== '' && !isGeneric(link.text)) || (link.aria_label !== null && !isGeneric(link.aria_label));

/** @type {CheckDef} */
export const empty = {
  id: 'links.anchor.empty',
  module: 'links',
  engine: 'code',
  title: 'Link with no anchor text',
  description:
    'Looks at links that have a URL but no visible text, no image alt text, no aria-label and no title attribute, when no other link on the page to the same address has any. Visitors, screen readers and Google get no description of where the link goes. Links hidden from screen readers with aria-hidden and links to a place on the same page are not counted.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOC_LINKS,
  last_verified: LAST_VERIFIED,
  recommendation:
    'Add descriptive text inside the link, or alt text to an image inside it. For an icon-only link, add an aria-label that says where the link goes.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      const namedTargets = targetsWhere(page, named);
      for (const link of page.links) {
        if (link.url === null || outOfScope(link, page)) continue;
        const selector = linkSelector(link);
        if (named(link) || namedTargets.has(link.url)) {
          results.push({ status: 'pass', url: page.url, selector });
          continue;
        }
        results.push({
          status: 'fail',
          url: page.url,
          selector,
          line: link.line,
          evidence: {
            observed: { text: '', aria_label: null, title_attr: null, target_url: clip(link.url) },
            expected: 'Visible text, image alt text, an aria-label or a title attribute',
            detail: `The link to ${clip(link.url)} has no text, no image alt text, no aria-label and no title attribute, and no other link to it on this page has one.`,
          },
        });
      }
    }
    return results;
  },
};

/** @type {CheckDef} */
export const generic = {
  id: 'links.anchor.generic',
  module: 'links',
  engine: 'code',
  title: 'Generic link text',
  description:
    'Looks at links whose whole text is a generic phrase such as "click here" or "read more", using lists for English, Turkish, German, Spanish and French. Generic text says nothing about the page it links to when read on its own. A link with a descriptive aria-label, or whose address another link on the page names with descriptive text, is not counted; neither are links to a place on the same page.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOC_LINKS,
  last_verified: LAST_VERIFIED,
  recommendation:
    'Replace the text with words that describe the destination, such as the name of the page. Read the link text on its own: it should still make sense.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      const describedTargets = targetsWhere(page, descriptive);
      for (const link of page.links) {
        if (link.url === null || link.text.trim() === '' || outOfScope(link, page)) continue;
        const selector = linkSelector(link);
        if (descriptive(link) || describedTargets.has(link.url)) {
          results.push({ status: 'pass', url: page.url, selector });
          continue;
        }
        results.push({
          status: 'fail',
          url: page.url,
          selector,
          line: link.line,
          evidence: {
            observed: { text: clip(link.text), target_url: clip(link.url) },
            expected: 'Text that describes the page the link goes to',
            detail: `The link text "${clip(link.text)}" is generic, and no other link to ${clip(link.url)} on this page describes it.`,
          },
        });
      }
    }
    return results;
  },
};
