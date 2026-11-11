/** @import { CheckDef, CheckResult } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { GENERIC_ANCHORS, normalizeAnchorText } from './generic-anchors.js';
import { linkSelector } from './helpers.js';

const LAST_VERIFIED = '2026-11-11';
const DOC_LINKS = 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable';

/**
 * @param {string} href
 * @returns {boolean}
 */
function isJavascriptHref(href) {
  return href.trim().toLowerCase().startsWith('javascript:');
}

/** @type {CheckDef} */
const uncrawlable = {
  id: 'links.anchor.uncrawlable',
  module: 'links',
  engine: 'code',
  title: 'Link without a crawlable URL',
  description:
    'Looks at every <a> element on a page, internal or not, and flags those whose href is a javascript: URL, or that have no href and rely on an onclick handler. Google cannot reliably extract a URL from these, so the page they open may not be found through the link.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 2,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOC_LINKS,
  last_verified: LAST_VERIFIED,
  recommendation:
    'Put a real URL in the href attribute, for example href="/products". Keep any script as an extra onclick handler on that link.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      for (const link of page.links) {
        const selector = linkSelector(link);
        const scriptHref = isJavascriptHref(link.href);
        const onclickOnly = link.href === '' && link.has_onclick;
        if (!scriptHref && !onclickOnly) {
          results.push({ status: 'pass', url: page.url, selector });
          continue;
        }
        results.push({
          status: 'fail',
          url: page.url,
          selector,
          line: link.line,
          evidence: {
            observed: { href: clip(link.href), has_onclick: link.has_onclick },
            expected: 'A real URL in the href attribute',
            detail: scriptHref
              ? 'The href is a javascript: URL.'
              : 'The link has no href and opens its page through an onclick handler.',
          },
        });
      }
    }
    return results;
  },
};

/** @type {CheckDef} */
const empty = {
  id: 'links.anchor.empty',
  module: 'links',
  engine: 'code',
  title: 'Link with no anchor text',
  description:
    'Looks at links that have a URL but no visible text, no image alt text, no aria-label and no title attribute. Visitors, screen readers and Google get no description of where the link goes.',
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
      for (const link of page.links) {
        if (link.url === null) continue;
        const selector = linkSelector(link);
        if (link.text.trim() !== '' || link.aria_label !== null || (link.title_attr ?? null) !== null) {
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
            detail: `The link to ${clip(link.url)} has no text, no image alt text, no aria-label and no title attribute.`,
          },
        });
      }
    }
    return results;
  },
};

/** @type {CheckDef} */
const generic = {
  id: 'links.anchor.generic',
  module: 'links',
  engine: 'code',
  title: 'Generic link text',
  description:
    'Looks at links whose whole text is a generic phrase such as "click here" or "read more", using lists for English, Turkish, German, Spanish and French. Generic text says nothing about the page it links to when read on its own.',
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
      for (const link of page.links) {
        if (link.url === null || link.text.trim() === '') continue;
        const selector = linkSelector(link);
        if (!GENERIC_ANCHORS.has(normalizeAnchorText(link.text))) {
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
            detail: `The link text "${clip(link.text)}" is generic.`,
          },
        });
      }
    }
    return results;
  },
};

/** The checks on `<a>` elements: crawlable URL, anchor text. */
export const anchorChecks = [uncrawlable, empty, generic];
