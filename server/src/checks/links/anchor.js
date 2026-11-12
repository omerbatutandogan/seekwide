/** @import { CheckDef, CheckResult } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { GENERIC_ANCHORS, normalizeAnchorText } from './generic-anchors.js';
import { linkSelector } from './helpers.js';

const LAST_VERIFIED = '2026-11-12';
const DOC_LINKS = 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable';

/**
 * Schemes whose URL is not a web address a crawler can send a request to: a
 * script to run (`javascript:`, `vbscript:`) or a document carried inside the
 * link (`data:`). Google asks for an href that resolves to such an address.
 * Schemes that hand the link to another program (`mailto:`, `tel:`) open no
 * page and are not counted.
 */
const NOT_A_WEB_ADDRESS = new Set(['javascript', 'vbscript', 'data']);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/**
 * The scheme of an href as a browser reads it, lower-cased, or null when it has none.
 * Browsers ignore spaces and control characters around a URL, and tabs and
 * line breaks inside it (WHATWG URL Standard), so `java\nscript:` is a
 * javascript: URL.
 * @param {string} href
 * @returns {string|null}
 */
export function hrefScheme(href) {
  const text = href.replace(/[\t\n\r]/g, '');
  let start = 0;
  while (start < text.length && text.charCodeAt(start) <= 0x20) start += 1;
  const match = SCHEME.exec(text.slice(start, start + 64));
  return match ? match[1].toLowerCase() : null;
}

/** @type {CheckDef} */
const uncrawlable = {
  id: 'links.anchor.uncrawlable',
  module: 'links',
  engine: 'code',
  title: 'Link without a crawlable URL',
  description:
    'Looks at every <a> element on a page, internal or not, and flags those whose href is a javascript:, vbscript: or data: URL, or that have no href and rely on an onclick handler. Google asks for an href that resolves to a web address its crawlers can request, so the page these open may not be found through the link.',
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
        const scheme = hrefScheme(link.href);
        const notAddress = scheme !== null && NOT_A_WEB_ADDRESS.has(scheme);
        const onclickOnly = link.href === '' && link.has_onclick;
        if (!notAddress && !onclickOnly) {
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
            detail: notAddress
              ? `The href is a ${scheme}: URL.`
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
