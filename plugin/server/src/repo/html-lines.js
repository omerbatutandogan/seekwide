// Plain HTML: on which line of the source file a finding's element is.

/** @import { PageRecord } from '../types.js' */
/** @import { DomNode } from '../extract/dom.js' */

import { parse } from 'parse5';
import { attr, isHtmlElement, lineOf } from '../extract/dom.js';

/**
 * Lines of the elements that findings without a line of their own refer to.
 * @typedef {Object} HtmlAnchors
 * @property {number|null} html             The `<html>` start tag; null when the file has none.
 * @property {number|null} head             The `<head>` start tag; null when the file has none.
 * @property {number|null} title            The first `<title>`.
 * @property {number|null} metaDescription  The first `<meta name="description">`.
 * @property {number|null} metaRobots       The first `<meta name="robots">` or `<meta name="googlebot">`.
 */

/**
 * Find the anchor lines of an HTML source. Lines are 1-based lines of `html`.
 * An element the parser only implied (a file without a `<head>` tag) has no line.
 * @param {string} html
 * @returns {HtmlAnchors}
 */
export function htmlAnchors(html) {
  const document = /** @type {DomNode} */ (/** @type {unknown} */ (parse(html, { sourceCodeLocationInfo: true })));
  /** @type {HtmlAnchors} */
  const anchors = { html: null, head: null, title: null, metaDescription: null, metaRobots: null };
  /** @type {DomNode[]} */
  const stack = [document];
  while (stack.length > 0) {
    const node = /** @type {DomNode} */ (stack.pop());
    if (isHtmlElement(node, 'html')) anchors.html ??= lineOf(node);
    else if (isHtmlElement(node, 'head')) anchors.head ??= lineOf(node);
    else if (isHtmlElement(node, 'title')) anchors.title ??= lineOf(node);
    else if (isHtmlElement(node, 'meta')) {
      const name = attr(node, 'name')?.trim().toLowerCase();
      if (name === 'description') anchors.metaDescription ??= lineOf(node);
      else if (name === 'robots' || name === 'googlebot') anchors.metaRobots ??= lineOf(node);
    }
    const children = node.childNodes ?? [];
    // Pushed in reverse so that elements are visited in document order.
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return anchors;
}

/**
 * The anchor line for a check whose findings carry no line: the element the
 * check is about when the file has it, otherwise the place it would go.
 * @param {string} checkId
 * @param {HtmlAnchors} anchors
 * @returns {number|null}
 */
export function anchorLine(checkId, anchors) {
  if (checkId.startsWith('seo.title.')) return anchors.title ?? anchors.head;
  if (checkId.startsWith('seo.meta_description.')) return anchors.metaDescription ?? anchors.head;
  if (checkId.startsWith('seo.indexing.')) return anchors.metaRobots;
  if (checkId === 'seo.html.lang_missing') return anchors.html;
  if (checkId === 'seo.canonical.missing' || checkId === 'seo.mobile.viewport_missing' || checkId === 'seo.social.og_incomplete') return anchors.head;
  return null;
}

const ELEMENT_LISTS = /** @type {const} */ (['links', 'images', 'headings', 'jsonld', 'canonicals']);

/**
 * The element lists both records are compared and indexed by. Canonicals from
 * a `Link` header are left out: a file has no headers.
 * @param {PageRecord} record
 */
function elementLists(record) {
  return { ...record, canonicals: record.canonicals.filter((canonical) => canonical.source === 'html') };
}

/**
 * True when the page the server sent has the content of the file: the same
 * titles, the same visible text and the same number of links, images,
 * headings, JSON-LD blocks and canonical links. A server may add something
 * invisible (a live-reload script); anything else means the file is not what
 * was served, and no line of it can be trusted.
 * @param {PageRecord} served  The crawled record.
 * @param {PageRecord} source  The record extracted from the file.
 * @returns {boolean}
 */
export function sameDocument(served, source) {
  if (served.status !== 200 || !served.is_html || !source.is_html) return false;
  if (served.text_hash !== source.text_hash || served.titles.length !== source.titles.length) return false;
  if (served.titles.some((title, index) => title !== source.titles[index])) return false;
  const a = elementLists(served);
  const b = elementLists(source);
  return ELEMENT_LISTS.every((list) => a[list].length === b[list].length);
}

/**
 * Translate a line of the served page into a line of the source file: the
 * elements that start on that served line are looked up by their position in
 * the file's own lists. Null when no recorded element starts on the line, or
 * when the elements found there do not agree on one line of the file.
 * Only meaningful when `sameDocument(served, source)` is true.
 * @param {number} servedLine
 * @param {PageRecord} served
 * @param {PageRecord} source
 * @returns {number|null}
 */
export function sourceLine(servedLine, served, source) {
  const a = elementLists(served);
  const b = elementLists(source);
  /** @type {Set<number|null>} */
  const lines = new Set();
  for (const list of ELEMENT_LISTS) {
    a[list].forEach((element, index) => {
      if (element.line === servedLine) lines.add(b[list][index]?.line ?? null);
    });
  }
  const [only] = [...lines];
  return lines.size === 1 && only !== null ? only : null;
}
