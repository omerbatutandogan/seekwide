// HTML document → content fields of a PageRecord. Pure.

/** @import { CanonicalRef, Heading, HreflangRef, ImageRecord, JsonLdBlock, LinkRecord } from '../types.js' */
/** @import { DomNode } from './dom.js' */

import { parse } from 'parse5';

import { LIMITS } from '../config.js';
import { sha1Hex } from '../util/hash.js';
import { clip, collapseWhitespace } from '../util/strings.js';
import { isInternalUrl, normalizeUrl } from '../util/url.js';
import { HTML_NS, SVG_NS, attr, findBaseUrl, insecureUrl, isHtmlElement, lineOf, textOf, tokens } from './dom.js';
import { parseJsonLd } from './jsonld.js';

/** Script types a browser runs as JavaScript. */
const SCRIPT_TYPES = new Set(['', 'text/javascript', 'module']);
/** How the inline data scripts of a Next.js App Router page begin. */
const NEXT_FLIGHT = /^\s*\(?\s*self\.__next_f\s*(=|\.push\()/;

export const MAX_LINKS = 5000;
export const MAX_IMAGES = 2000;
export const MAX_MIXED_CONTENT = 20;
/** Per-page caps on lists, in document order (REVIEW-FIXES R8). */
export const CAPS = Object.freeze({
  titles: 20, meta_descriptions: 20, canonicals: 20, hreflang: 500, headings: 500, jsonld: 100, meta_robots: 50,
});
const LONG_TEXT = 1000;
const MAX_SOCIAL_KEYS = 50;

/** Elements whose text is not part of the visible body text. */
const HIDDEN_TEXT = new Set(['script', 'style', 'noscript', 'template']);
/** Elements that do not break a word: text on both sides runs together. */
const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'del', 'dfn', 'em', 'font', 'i', 'ins',
  'kbd', 'label', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);
/** Subresource elements checked for mixed content, with the attribute that loads them. */
const SUBRESOURCE_ATTR = new Map([
  ['img', 'src'], ['script', 'src'], ['iframe', 'src'], ['video', 'src'], ['audio', 'src'],
  ['source', 'src'], ['embed', 'src'], ['object', 'data'],
]);
const HEADING_LEVELS = new Map([['h1', 1], ['h2', 2], ['h3', 3], ['h4', 4], ['h5', 5], ['h6', 6]]);
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
 */

/**
 * @template T
 * @param {T[]} list
 * @param {number} max
 * @returns {boolean} True while `list` has room for another entry.
 */
function hasRoom(list, max) {
  return list.length < max;
}

/**
 * True when a Content-Security-Policy value contains `upgrade-insecure-requests`.
 * @param {string|null|undefined} policy
 * @returns {boolean}
 */
export function upgradesInsecureRequests(policy) {
  if (!policy) return false;
  return policy.split(/[;,]/).some((directive) => directive.trim().toLowerCase().split(/\s+/)[0] === 'upgrade-insecure-requests');
}

/**
 * @typedef {Object} Frame
 * @property {DomNode} node
 * @property {boolean} head  Inside `<head>`.
 * @property {boolean} body  Inside `<body>`.
 * @property {boolean} hidden  Text here is not visible body text.
 */

/**
 * @param {Record<string, string>} target
 * @param {string} key
 * @param {string|null} value
 */
function setFirst(target, key, value) {
  if (key === '' || value === null || Object.hasOwn(target, key)) return;
  if (Object.keys(target).length >= MAX_SOCIAL_KEYS) return;
  target[clip(key, LIMITS.maxStringLength)] = clip(collapseWhitespace(value), LIMITS.maxStringLength);
}

/**
 * Extract every content field of a PageRecord from a decoded HTML document.
 * Relative URLs resolve against the first `<base href>`, else `responseUrl`.
 * Line numbers are 1-based lines of `html`. Lists are capped (`CAPS`,
 * `MAX_LINKS`, `MAX_IMAGES`, `MAX_MIXED_CONTENT`) keeping the first entries.
 * `mixed_content` is empty when the page upgrades insecure requests, through
 * `context.upgradeInsecure` (the response header) or a CSP `<meta http-equiv>` in `<head>`.
 * @param {string} html
 * @param {{responseUrl: string, siteHost: string, includeSubdomains: boolean, upgradeInsecure?: boolean}} context
 * @returns {HtmlFields}
 */
export function extractHtml(html, context) {
  const document = /** @type {DomNode} */ (/** @type {unknown} */ (parse(html, { sourceCodeLocationInfo: true })));
  const baseUrl = findBaseUrl(document, context.responseUrl);
  const https = context.responseUrl.startsWith('https:');
  let upgradeInsecure = context.upgradeInsecure ?? false;
  let nextFlight = false;
  let bodyTitle = false;

  /** @type {HtmlFields} */
  const out = {
    html_lang: null, titles: [], meta_descriptions: [], meta_robots: [], canonicals: [], hreflang: [],
    headings: [], viewport: null, og: {}, twitter: {}, links: [], images: [], jsonld: [], mixed_content: [],
    word_count: 0, text_hash: '', text_excerpt: '',
  };
  /** @type {string[]} */
  const text = [];

  /** @param {string|null} raw */
  const addMixed = (raw) => {
    if (!https || out.mixed_content.length >= MAX_MIXED_CONTENT) return;
    const url = insecureUrl(raw, baseUrl);
    if (url !== null && !out.mixed_content.includes(url)) out.mixed_content.push(url);
  };

  /**
   * @param {DomNode} node
   * @param {Frame} frame
   */
  const visit = (node, frame) => {
    const tag = /** @type {string} */ (node.tagName);
    const line = lineOf(node);
    if (tag === 'html') {
      const lang = attr(node, 'lang')?.trim();
      if (lang) out.html_lang = clip(lang, LIMITS.maxStringLength);
    } else if (tag === 'title') {
      if (frame.body) bodyTitle = true;
      if (hasRoom(out.titles, CAPS.titles)) out.titles.push(clip(collapseWhitespace(textOf(node, false, LONG_TEXT)), LONG_TEXT));
    } else if (tag === 'meta') {
      const name = attr(node, 'name')?.trim().toLowerCase() ?? '';
      const property = attr(node, 'property')?.trim().toLowerCase() ?? '';
      const content = attr(node, 'content');
      const httpEquiv = attr(node, 'http-equiv')?.trim().toLowerCase();
      if (httpEquiv === 'content-security-policy' && frame.head && upgradesInsecureRequests(content)) upgradeInsecure = true;
      if (name === 'description') {
        if (hasRoom(out.meta_descriptions, CAPS.meta_descriptions)) out.meta_descriptions.push(clip(collapseWhitespace(content ?? ''), LONG_TEXT));
      } else if (name === 'robots' || name === 'googlebot') {
        for (const token of (content ?? '').split(',')) {
          const value = collapseWhitespace(token).toLowerCase();
          if (value !== '' && hasRoom(out.meta_robots, CAPS.meta_robots)) out.meta_robots.push(clip(value, LIMITS.maxStringLength));
        }
      } else if (name === 'viewport' && out.viewport === null) {
        out.viewport = clip(collapseWhitespace(content ?? ''), LIMITS.maxStringLength);
      }
      for (const key of [property, name]) {
        if (key.startsWith('og:')) setFirst(out.og, key.slice(3), content);
        else if (key.startsWith('twitter:')) setFirst(out.twitter, key.slice(8), content);
      }
    } else if (tag === 'link') {
      const rel = tokens(attr(node, 'rel'));
      const href = attr(node, 'href');
      if (rel.includes('canonical') && href !== null && hasRoom(out.canonicals, CAPS.canonicals)) {
        const url = normalizeUrl(href, baseUrl);
        out.canonicals.push({ href: clip(href, LIMITS.maxStringLength), url, source: 'html', in_head: frame.head, line });
      }
      const lang = attr(node, 'hreflang')?.trim();
      if (rel.includes('alternate') && lang && href !== null && hasRoom(out.hreflang, CAPS.hreflang)) {
        out.hreflang.push({
          hreflang: clip(lang, LIMITS.maxStringLength), href: clip(href, LIMITS.maxStringLength),
          url: normalizeUrl(href, baseUrl), source: 'html',
        });
      }
      if (rel.includes('stylesheet')) addMixed(href);
    } else if (tag === 'a') {
      if (out.links.length < MAX_LINKS) {
        const href = attr(node, 'href');
        const url = href === null ? null : normalizeUrl(href, baseUrl);
        out.links.push({
          href: clip(href ?? '', LIMITS.maxStringLength),
          url,
          text: clip(collapseWhitespace(textOf(node, true, LIMITS.maxStringLength, true)), LIMITS.maxStringLength),
          aria_label: clip(attr(node, 'aria-label')?.trim() ?? '', LIMITS.maxStringLength) || null,
          title_attr: clip(attr(node, 'title')?.trim() ?? '', LIMITS.maxStringLength) || null,
          rel: tokens(attr(node, 'rel')),
          internal: url !== null && isInternalUrl(url, context.siteHost, context.includeSubdomains),
          has_onclick: attr(node, 'onclick') !== null,
          line,
        });
      }
    } else if (tag === 'img') {
      if (out.images.length < MAX_IMAGES) {
        const src = attr(node, 'src');
        const parent = node.parentNode;
        const pictureSrcset = parent && isHtmlElement(parent, 'picture')
          && (parent.childNodes ?? []).some((child) => isHtmlElement(child, 'source') && attr(child, 'srcset') !== null);
        /** @param {string} name */
        const optional = (name) => {
          const value = attr(node, name);
          return value === null ? null : clip(value, LIMITS.maxStringLength);
        };
        out.images.push({
          src: clip(src ?? '', LIMITS.maxStringLength),
          url: src === null ? null : normalizeUrl(src, baseUrl),
          alt: optional('alt'),
          width: optional('width'),
          height: optional('height'),
          loading: optional('loading'),
          has_srcset: attr(node, 'srcset') !== null || Boolean(pictureSrcset),
          line,
        });
      }
    } else if (HEADING_LEVELS.has(tag) && hasRoom(out.headings, CAPS.headings)) {
      const level = /** @type {Heading['level']} */ (HEADING_LEVELS.get(tag));
      out.headings.push({ level, text: clip(collapseWhitespace(textOf(node, true, LIMITS.maxStringLength)), LIMITS.maxStringLength), line });
    } else if (tag === 'script') {
      const type = (attr(node, 'type') ?? '').split(';', 1)[0].trim().toLowerCase();
      // The inline scripts that carry a Next.js App Router page's data ("flight" chunks).
      if (!nextFlight && attr(node, 'src') === null && SCRIPT_TYPES.has(type) && NEXT_FLIGHT.test(node.childNodes?.[0]?.value ?? '')) nextFlight = true;
      if (type === 'application/ld+json' && hasRoom(out.jsonld, CAPS.jsonld)) {
        const source = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
        out.jsonld.push(parseJsonLd(source, line));
      }
    }
    const sourceAttr = SUBRESOURCE_ATTR.get(tag);
    if (sourceAttr) addMixed(attr(node, sourceAttr));
  };

  /** @type {(Frame|typeof SPACE)[]} */
  const stack = [{ node: document, head: false, body: false, hidden: false }];
  while (stack.length > 0) {
    const item = /** @type {Frame|typeof SPACE} */ (stack.pop());
    if (item === SPACE) {
      text.push(' ');
      continue;
    }
    const { node } = item;
    if (node.nodeName === '#text') {
      if (item.body && !item.hidden) text.push(node.value ?? '');
      continue;
    }
    let frame = item;
    if (node.tagName) {
      const html = node.namespaceURI === HTML_NS;
      if (html) visit(node, item);
      frame = {
        node,
        head: item.head || (html && node.tagName === 'head'),
        body: item.body || (html && node.tagName === 'body'),
        hidden: item.hidden || node.namespaceURI === SVG_NS || (html && HIDDEN_TEXT.has(node.tagName)),
      };
      if (!(html && INLINE.has(node.tagName))) {
        text.push(' ');
        stack.push(SPACE);
      }
    }
    // Template contents live in a separate fragment and are never walked: they are inert.
    const children = node.childNodes ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      stack.push({ node: children[i], head: frame.head, body: frame.body, hidden: frame.hidden });
    }
  }

  if (upgradeInsecure) out.mixed_content = [];
  // Next.js can append a page's metadata to <body> ("streaming metadata"): the title, the
  // description and the canonical link arrive there together. Such a canonical is still outside
  // the head; `streamed` only says why, so the finding can explain it.
  if (nextFlight && bodyTitle) {
    for (const canonical of out.canonicals) {
      if (canonical.source === 'html' && !canonical.in_head) canonical.streamed = true;
    }
  }
  const visible = collapseWhitespace(text.join(''));
  out.word_count = visible.match(WORD)?.length ?? 0;
  out.text_hash = visible === '' ? '' : sha1Hex(visible.toLowerCase());
  out.text_excerpt = visible.slice(0, LIMITS.textExcerptChars);
  return out;
}
