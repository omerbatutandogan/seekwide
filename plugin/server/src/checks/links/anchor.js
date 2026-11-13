/** @import { CheckDef, CheckResult } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { DOC_LINKS, LAST_VERIFIED, empty, generic } from './anchor-text.js';
import { linkSelector } from './helpers.js';

/** Schemes whose URL is a script to run, not an address: what it opens, if anything, is in the script. */
const SCRIPT_SCHEMES = new Set(['javascript', 'vbscript']);
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
/**
 * Statements of a script URL that open no page: nothing, a no-op, printing,
 * going back, closing the window, scrolling to the top. Compared lower-cased
 * and without spaces.
 */
const NO_DESTINATION = new Set([
  '', 'void(0)', 'void0', 'void(null)', 'undefined', 'false', 'returnfalse', 'print()', 'window.print()', 'self.print()',
  'history.back()', 'window.history.back()', 'history.go(-1)', 'window.history.go(-1)', 'close()', 'window.close()', 'self.close()',
  'scroll(0,0)', 'scrollto(0,0)', 'window.scroll(0,0)', 'window.scrollto(0,0)',
]);
/** A script longer than this is not read for its statements; it counts as one that may open a page. */
const MAX_SCRIPT_CHARS = 500;

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

/**
 * True when a `javascript:` or `vbscript:` href opens no page: every statement
 * of its code, percent-decoded as a browser decodes it, is one of
 * `NO_DESTINATION` (`javascript:;`, `javascript:void(0)`, `javascript:print()`,
 * `javascript:history.back()`). Such an element is a control that looks like a
 * link. Code that does anything else may open a page (`location=…`,
 * `goTo('products')`).
 * @param {string} href
 * @returns {boolean}
 */
export function leadsNowhere(href) {
  const text = href.replace(/[\t\n\r]/g, '').trim();
  let code = text.slice(text.indexOf(':') + 1);
  if (code.length > MAX_SCRIPT_CHARS) return false;
  try {
    code = decodeURIComponent(code);
  } catch {
    // A malformed escape is read as it stands.
  }
  return code.split(';').every((statement) => NO_DESTINATION.has(statement.replace(/\s+/g, '').toLowerCase()));
}

/**
 * What a link opens when that is not in its href as a web address, or null
 * when it is (or when it opens nothing). One rule covers every case: Google
 * asks that an `<a>` element's href resolve to a web address its crawlers can
 * request.
 * - `data`: the href carries the document itself.
 * - `script`: the href is a script that may open a page.
 * - `onclick`: the href is empty, or a script that opens nothing, and a
 *   script handler (`onclick`, another inline handler, a framework's click
 *   binding, a `data-href`) does whatever the link does.
 * A script that opens nothing on an element without such a handler is a
 * control that looks like a link (print, back, a menu toggle): it leads to no
 * page, so it is not a unit (`undefined`).
 * @param {{href: string, has_onclick: boolean, has_handler?: boolean}} link
 * @returns {'data'|'script'|'onclick'|null|undefined}
 */
export function hiddenDestination(link) {
  const scheme = hrefScheme(link.href);
  if (scheme === 'data') return 'data';
  const script = scheme !== null && SCRIPT_SCHEMES.has(scheme);
  const nowhere = script && leadsNowhere(link.href);
  if (script && !nowhere) return 'script';
  const handled = link.has_onclick || link.has_handler === true;
  if (nowhere && !handled) return undefined;
  return (link.href === '' || nowhere) && handled ? 'onclick' : null;
}

/** @type {CheckDef} */
const uncrawlable = {
  id: 'links.anchor.uncrawlable',
  module: 'links',
  engine: 'code',
  title: 'Link without a crawlable URL',
  description:
    'Looks at every <a> element on a page, internal or not, and flags those whose destination is not in the href as a web address: a data: URL, a javascript: or vbscript: URL whose script may open a page, or no href (or a script that does nothing) with an onclick or other script handler. Google asks for an href that resolves to a web address its crawlers can request, so the page these open may not be found through the link. A script link with no handler that only prints, goes back or does nothing is a control, not a link to a page, and is not counted.',
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
        const hidden = hiddenDestination(link);
        if (hidden === undefined) continue;
        const selector = linkSelector(link);
        if (hidden === null) {
          results.push({ status: 'pass', url: page.url, selector });
          continue;
        }
        const scheme = hrefScheme(link.href);
        results.push({
          status: 'fail',
          url: page.url,
          selector,
          line: link.line,
          evidence: {
            observed: { href: clip(link.href), has_onclick: link.has_onclick, ...(link.has_handler === true ? { has_handler: true } : {}) },
            expected: 'A real URL in the href attribute',
            detail: hidden !== 'onclick'
              ? `The href is a ${scheme}: URL.`
              : link.href === ''
                ? `The link has no href and opens its page through ${link.has_onclick ? 'an onclick handler' : 'a script handler'}.`
                : `The href is a ${scheme}: URL that does nothing itself, and the link relies on ${link.has_onclick ? 'an onclick handler' : 'a script handler'}.`,
          },
        });
      }
    }
    return results;
  },
};

/** The checks on `<a>` elements: crawlable URL, anchor text. */
export const anchorChecks = [uncrawlable, empty, generic];
