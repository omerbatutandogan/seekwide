// Small read-only helpers over the parse5 default tree. Pure.

import { LIMITS } from '../config.js';
import { clip } from '../util/strings.js';

export const HTML_NS = 'http://www.w3.org/1999/xhtml';
export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Minimal view of a parse5 node; only the fields this module reads.
 * @typedef {Object} DomNode
 * @property {string} nodeName
 * @property {string} [tagName]
 * @property {string} [namespaceURI]
 * @property {{name: string, value: string}[]} [attrs]
 * @property {DomNode[]} [childNodes]
 * @property {DomNode|null} [parentNode]
 * @property {string} [value]   Text of a text node.
 * @property {string} [data]    Text of a comment node.
 * @property {DomNode} [content]  The inert contents of a `<template>`.
 * @property {{startLine: number}|null} [sourceCodeLocation]
 */

/** Elements whose text never contributes to anchor text, headings or titles. */
const NON_TEXT_ELEMENTS = new Set(['script', 'style', 'template', 'noscript']);

/**
 * @param {DomNode} node
 * @param {string} tag Lower-case tag name.
 * @returns {boolean} True for an element with this tag in the HTML namespace.
 */
export function isHtmlElement(node, tag) {
  return node.tagName === tag && node.namespaceURI === HTML_NS;
}

/**
 * @param {DomNode} node
 * @param {string} name
 * @returns {string|null} Attribute value, or null when the attribute is absent.
 */
export function attr(node, name) {
  if (!node.attrs) return null;
  for (const attribute of node.attrs) {
    if (attribute.name === name) return attribute.value;
  }
  return null;
}

/**
 * @param {DomNode} node
 * @returns {boolean} True when the element says `aria-hidden="true"` (any letter case).
 */
export function isAriaHidden(node) {
  return attr(node, 'aria-hidden')?.trim().toLowerCase() === 'true';
}

/**
 * @param {DomNode} node
 * @returns {number|null} 1-based line where the node starts in the decoded source.
 */
export function lineOf(node) {
  return node.sourceCodeLocation?.startLine ?? null;
}

/**
 * @param {string|null} value
 * @returns {string[]} Lower-cased, whitespace-separated tokens.
 */
export function tokens(value) {
  if (value === null) return [];
  return value.toLowerCase().split(/\s+/).filter((token) => token !== '');
}

/**
 * Text content of a subtree, without script, style, template and noscript
 * text. With `withAlt`, the `alt` of each contained `<img>` counts as text.
 * With `withLabels`, a non-empty `aria-label` on a contained element (an
 * `<svg role="img">` logo, an icon, an image) stands in for that element's
 * content, unless the element says `aria-hidden="true"`. The root's own
 * `aria-label` is never read.
 * Returned raw: callers collapse whitespace and clip.
 *
 * The walk stops once about `2 * clipLength` characters of collapsed text are
 * collected, or after visiting `8 * clipLength` nodes, and reads at most
 * `2 * clipLength` characters of any one text node, `alt` or label. So the cost of one call is
 * bounded whatever the subtree size, and nested headings stay linear.
 * The returned text is complete up to at least `clipLength` collapsed
 * characters unless a single text node holds more than that much whitespace.
 * @param {DomNode} root
 * @param {boolean} withAlt
 * @param {number} clipLength The length the caller clips the result to.
 * @param {boolean} [withLabels]
 * @returns {string}
 */
export function textOf(root, withAlt, clipLength, withLabels = false) {
  const wanted = 2 * clipLength;
  let nodeBudget = 8 * clipLength;
  let collected = 0;
  /** @type {string[]} */
  const parts = [];
  /** @param {string} value */
  const add = (value) => {
    const piece = value.length > wanted ? value.slice(0, wanted) : value;
    parts.push(piece);
    collected += piece.replace(/\s+/g, ' ').length;
  };
  /** @type {DomNode[]} */
  const stack = [...(root.childNodes ?? [])].reverse();
  while (stack.length > 0 && collected < wanted && nodeBudget > 0) {
    nodeBudget -= 1;
    const node = /** @type {DomNode} */ (stack.pop());
    if (node.nodeName === '#text') {
      add(node.value ?? '');
      continue;
    }
    if (!node.tagName || NON_TEXT_ELEMENTS.has(node.tagName)) continue;
    if (withLabels && attr(node, 'aria-hidden') !== 'true') {
      const label = attr(node, 'aria-label')?.trim();
      if (label) {
        add(` ${label.slice(0, wanted)} `);
        continue;
      }
    }
    if (withAlt && isHtmlElement(node, 'img')) {
      const alt = attr(node, 'alt');
      if (alt) add(` ${alt.slice(0, wanted)} `);
      continue;
    }
    const children = node.childNodes ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return parts.join('');
}

/**
 * Base URL for resolving relative references: the first `<base href>` in tree
 * order when it resolves to an http(s) URL, otherwise the response URL.
 * @param {DomNode} document
 * @param {string} responseUrl
 * @returns {string}
 */
export function findBaseUrl(document, responseUrl) {
  /** @type {DomNode[]} */
  const stack = [document];
  while (stack.length > 0) {
    const node = /** @type {DomNode} */ (stack.pop());
    if (isHtmlElement(node, 'base')) {
      const href = attr(node, 'href');
      if (href !== null) {
        try {
          const url = new URL(href.trim(), responseUrl);
          return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : responseUrl;
        } catch {
          return responseUrl;
        }
      }
    }
    const children = node.childNodes ?? [];
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]);
  }
  return responseUrl;
}

/**
 * Absolute `http:` URL for a subresource reference, or null when the reference
 * resolves to anything else.
 * @param {string|null} raw
 * @param {string} baseUrl
 * @returns {string|null}
 */
export function insecureUrl(raw, baseUrl) {
  if (raw === null || raw.trim() === '') return null;
  try {
    const url = new URL(raw.trim(), baseUrl);
    return url.protocol === 'http:' ? clip(url.href, LIMITS.maxStringLength) : null;
  } catch {
    return null;
  }
}

/**
 * At most this many tags of a document are parsed; the rest is left out, like
 * the part of a body beyond `LIMITS.maxBodyBytes`. parse5 builds the whole tree
 * before any list cap applies, and nested formatting tags cost it more than a
 * kilobyte each, so this bounds the memory one page can take (about 300 MB at
 * worst, far less for ordinary markup). Ordinary pages have a few thousand.
 */
export const MAX_PARSED_TAGS = 200_000;

/**
 * The start of `html` up to its `MAX_PARSED_TAGS`-th "<", or all of it.
 * @param {string} html
 * @returns {string}
 */
export function parsedPart(html) {
  let at = -1;
  for (let count = 0; count < MAX_PARSED_TAGS; count += 1) {
    at = html.indexOf('<', at + 1);
    if (at === -1) return html;
  }
  return html.slice(0, at);
}

/**
 * Characters the link, image and hreflang lists of one page may hold in all.
 * Each entry keeps a URL of up to 2048 characters and clipped texts, so the
 * count caps alone would let one page record grow to many megabytes.
 */
export const MAX_LIST_CHARS = 1_000_000;

/**
 * The characters of the strings an entry holds, those in its lists included.
 * @param {object} entry
 * @returns {number}
 */
export function textChars(entry) {
  let total = 0;
  for (const value of Object.values(entry)) {
    if (typeof value === 'string') total += value.length;
    else if (Array.isArray(value)) for (const item of value) if (typeof item === 'string') total += item.length;
  }
  return total;
}
