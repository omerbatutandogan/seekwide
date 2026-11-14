// HTML document → content fields of a PageRecord. Pure. This file walks the
// document and collects the visible text; html-elements.js reads each element.

/** @import { CanonicalRef, Heading, HreflangRef, ImageRecord, JsonLdBlock, LinkRecord, PageSecurity, SocialRecord, VideoEmbedRecord, VideoRecord } from '../types.js' */
/** @import { DomNode } from './dom.js' */
/** @import { Frame, HtmlState } from './html-elements.js' */

import { parse } from 'parse5';

import { LIMITS } from '../config.js';
import { sha1Hex } from '../util/hash.js';
import { collapseWhitespace } from '../util/strings.js';
import { HTML_NS, SVG_NS, findBaseUrl, isAriaHidden, parsedPart } from './dom.js';
import { reachedCaps, visitElement } from './html-elements.js';
import { enterLandmark } from './media.js';
import { streamedBoundaries } from './react-stream.js';
import { documentSecurity, emptySecurity } from './security.js';
import { emptySocial, socialRecord, socialState } from './social.js';
import { siteIdentity } from '../util/site-identity.js';

/** Elements whose text is not part of the visible body text. */
const HIDDEN_TEXT = new Set(['script', 'style', 'noscript', 'template']);
/** Elements that do not break a word: text on both sides runs together. */
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins',
  'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
const SPACE = Symbol('space');

/**
 * @typedef {Object} HtmlFields
 * @property {string|null} html_lang
 * @property {string[]} titles
 * @property {string[]} meta_descriptions
 * @property {string[]} meta_robots
 * @property {CanonicalRef[]} canonicals
 * @property {HreflangRef[]} hreflang
 * @property {Heading[]} headings
 * @property {string|null} viewport
 * @property {Record<string, string>} og
 * @property {Record<string, string>} twitter
 * @property {LinkRecord[]} links
 * @property {ImageRecord[]} images
 * @property {JsonLdBlock[]} jsonld
 * @property {string[]} mixed_content
 * @property {number} word_count
 * @property {string} text_hash
 * @property {string} text_excerpt
 * @property {PageSecurity} security
 * @property {VideoRecord[]} videos
 * @property {VideoEmbedRecord[]} video_embeds
 * @property {boolean} video_markup
 * @property {SocialRecord} social
 * @property {string[]} [limits_reached]  Set when a cap stopped the reading of the page (`PageRecord.limits_reached`).
 */

/**
 * Extract every content field of a PageRecord from a decoded HTML document.
 * Relative URLs resolve against the first `<base href>`, else `responseUrl`.
 * Line numbers are 1-based lines of `html`. Lists are capped (`CAPS`,
 * `MAX_LINKS`, `MAX_IMAGES`, `MAX_MIXED_CONTENT`) keeping the first entries.
 * `mixed_content` is empty when the page upgrades insecure requests, through
 * `context.upgradeInsecure` (the response header) or a CSP `<meta http-equiv>` in `<head>`.
 * The fallback of a React Suspense boundary that the page's streaming script
 * completes (react-stream.js) adds no heading and no visible text: the content
 * that replaces it is in the document too. Its links and images are kept,
 * because a crawler that runs no script sees them, and its text still counts
 * for the security signals, so that nothing can hide there.
 * The streamed boundaries' own hidden elements count as revealed in `security`,
 * and their content is read where the page's script moves it (at the template).
 * @param {string} html
 * A cap that stops the reading (the document's tags, a list, the security
 * scan's hosts) is named in `limits_reached`.
 * `social.head_end` counts bytes with `context.byteOffset`, which turns characters of `html` into bytes of the
 * response; without it, characters count as their UTF-8 bytes.
 * @param {{responseUrl: string, siteHost: string, includeSubdomains: boolean, deployedOrigin?: string|null, upgradeInsecure?: boolean,
 *          byteOffset?: (chars: number) => number}} context
 * @returns {HtmlFields}
 */
export function extractHtml(html, context) {
  const markup = parsedPart(html);
  const document = /** @type {DomNode} */ (/** @type {unknown} */ (parse(markup, { sourceCodeLocationInfo: true })));
  const baseUrl = findBaseUrl(document, context.responseUrl);

  /** @type {HtmlFields} */
  const out = {
    html_lang: null, titles: [], meta_descriptions: [], meta_robots: [], canonicals: [], hreflang: [],
    headings: [], viewport: null, og: {}, twitter: {}, links: [], images: [], jsonld: [], mixed_content: [],
    word_count: 0, text_hash: '', text_excerpt: '', security: emptySecurity(), videos: [], video_embeds: [], video_markup: false,
    social: emptySocial(),
  };
  /** @type {HtmlState} */
  const state = {
    out, baseUrl, https: context.responseUrl.startsWith('https:'), siteHost: context.siteHost, includeSubdomains: context.includeSubdomains,
    listChars: 0, upgradeInsecure: context.upgradeInsecure ?? false, nextFlight: false, bodyTitle: false, preloadImages: new Set(), pictures: new WeakMap(),
    social: socialState(),
  };
  /** @type {string[]} */
  const text = [];
  /** Text of replaced fallback content, for the security signals only. @type {string[]} */
  const replacedText = [];
  const streamed = streamedBoundaries(document);

  /** @type {(Frame|typeof SPACE)[]} */
  const stack = [{ node: document, head: false, body: false, hidden: false, replaced: false, ariaHidden: false, chrome: false, sectioned: false }];
  while (stack.length > 0) {
    const item = /** @type {Frame|typeof SPACE} */ (stack.pop());
    if (item === SPACE) {
      text.push(' ');
      continue;
    }
    const { node } = item;
    if (node.nodeName === '#text') {
      if (item.body && !item.hidden) (item.replaced ? replacedText : text).push(node.value ?? '');
      continue;
    }
    let frame = item;
    if (node.tagName) {
      const html = node.namespaceURI === HTML_NS;
      if (html) visitElement(node, item, state);
      frame = {
        node,
        head: item.head || (html && node.tagName === 'head'),
        body: item.body || (html && node.tagName === 'body'),
        hidden: item.hidden || node.namespaceURI === SVG_NS || (html && HIDDEN_TEXT.has(node.tagName)),
        replaced: item.replaced,
        ariaHidden: item.ariaHidden || (html && isAriaHidden(node)),
        ...(html ? enterLandmark(node, item) : { chrome: item.chrome, sectioned: item.sectioned }),
      };
      if (!(html && INLINE.has(node.tagName))) {
        text.push(' ');
        stack.push(SPACE);
      }
    }
    // Template contents live in a separate fragment and are never walked: they are inert.
    const children = node.childNodes ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      stack.push({
        node: child, head: frame.head, body: frame.body, hidden: frame.hidden, replaced: frame.replaced || streamed.replaced.has(child), ariaHidden: frame.ariaHidden,
        chrome: frame.chrome, sectioned: frame.sectioned,
      });
    }
  }

  if (state.upgradeInsecure) out.mixed_content = [];
  // Next.js can append a page's metadata to <body> ("streaming metadata"): the title, the
  // description and the canonical link arrive there together. Such a canonical is still outside
  // the head; `streamed` only says why, so the finding can explain it.
  if (state.nextFlight && state.bodyTitle) {
    for (const canonical of out.canonicals) {
      if (canonical.source === 'html' && !canonical.in_head) canonical.streamed = true;
    }
  }
  const toBytes = context.byteOffset ?? ((/** @type {number} */ chars) => Buffer.byteLength(markup.slice(0, chars), 'utf8'));
  out.social = socialRecord(state.social, document, toBytes, state.nextFlight && state.bodyTitle);
  const visible = collapseWhitespace(text.join(''));
  out.word_count = visible.match(WORD)?.length ?? 0;
  out.text_hash = visible === '' ? '' : sha1Hex(visible.toLowerCase());
  out.text_excerpt = visible.slice(0, LIMITS.textExcerptChars);
  const served = replacedText.length === 0 ? visible : collapseWhitespace(`${text.join('')} ${replacedText.join('')}`);
  const identity = siteIdentity({ siteHost: context.siteHost, includeSubdomains: context.includeSubdomains, deployedOrigin: context.deployedOrigin ?? null });
  const read = documentSecurity(document, { baseUrl, identity, links: out.links, revealed: streamed.revealed }, {
    titles: out.titles, metaDescriptions: out.meta_descriptions, headings: out.headings, visibleText: served,
  });
  out.security = read.security;
  const reached = [...(markup.length < html.length ? ['tags'] : []), ...reachedCaps(state), ...read.limits.map((name) => `security.${name}`)];
  if (reached.length > 0) out.limits_reached = reached;
  return out;
}
