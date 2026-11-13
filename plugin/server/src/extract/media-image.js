// One `<img>` of an HTML document → its ImageRecord, with the fields the media
// checks need for their exceptions (CHECKS-SPEC "Media module"). Pure.

/** @import { ImageRecord } from '../types.js' */
/** @import { DomNode } from './dom.js' */
/** @import { Frame, HtmlState } from './html-elements.js' */

import { LIMITS } from '../config.js';
import { clip } from '../util/strings.js';
import { normalizeUrl } from '../util/url.js';
import { attr, isAriaHidden, isHtmlElement, lineOf, textOf, tokens } from './dom.js';

const MAX_SRCSET_URLS = 20;
/** Only the start of a `style` or `srcset` attribute is read; the declarations that matter here are short. */
const MAX_ATTRIBUTE_CHARS = 4000;
const MODERN_TYPES = new Set(['image/avif', 'image/webp']);
/** Attributes through which a script framework sets an image's alt text when it renders the page. */
const ALT_BINDINGS = [':alt', 'v-bind:alt', 'x-bind:alt', '[alt]', '[attr.alt]'];
/** Wrappers an image may sit in and still be the only content of a figure. */
const FIGURE_WRAPPERS = new Set(['a', 'picture', 'span', 'div']);
const MAX_FIGURE_CHILDREN = 50;
/** `<source>` elements of a `<picture>` that are read; a picture has a few, one per format or width. */
const MAX_PICTURE_SOURCES = 20;

/**
 * What a `<picture>` offers, read once for all the images in it.
 * @typedef {Object} PictureSummary
 * @property {boolean} sources  It has a `<source srcset>`.
 * @property {boolean} modern   One of the sources read is of type AVIF or WebP.
 * @property {string[]} urls    The raw candidate URLs of the sources read.
 */

/**
 * @param {DomNode} picture
 * @returns {PictureSummary}
 */
function summarizePicture(picture) {
  /** @type {PictureSummary} */
  const summary = { sources: false, modern: false, urls: [] };
  let read = 0;
  for (const child of picture.childNodes ?? []) {
    if (read >= MAX_PICTURE_SOURCES) break;
    if (!isHtmlElement(child, 'source')) continue;
    const srcset = attr(child, 'srcset');
    if (srcset === null) continue;
    read += 1;
    summary.sources = true;
    summary.modern = summary.modern || MODERN_TYPES.has((attr(child, 'type') ?? '').slice(0, 100).split(';', 1)[0].trim().toLowerCase());
    if (summary.urls.length < MAX_PICTURE_SOURCES) summary.urls.push(...srcsetUrls(srcset).slice(0, MAX_PICTURE_SOURCES - summary.urls.length));
  }
  return summary;
}

/**
 * A size of 1 pixel or less: a number of 1 or less, in an attribute or in an inline `px` (or unitless 0) value.
 * @param {string|null|undefined} value
 */
function tiny(value) {
  if (value === null || value === undefined) return false;
  const match = /^\s*(\d+(?:\.\d+)?)(px)?\s*$/.exec(value.slice(0, 40));
  return match !== null && Number(match[1]) <= 1;
}

/**
 * True when a utility class gives the image an aspect ratio or both sizes
 * (`aspect-video`, `aspect-[4/3]`, `size-full`, `w-40 h-12`), in any variant
 * (`md:aspect-square`). Only the class names are read, never a style sheet.
 * @param {string|null} value
 */
function classSized(value) {
  let width = false;
  let height = false;
  for (const token of tokens(value === null ? null : value.slice(0, MAX_ATTRIBUTE_CHARS)).slice(0, 100)) {
    const name = token.slice(token.lastIndexOf(':') + 1);
    if (name.endsWith('-auto')) continue;
    if (name.startsWith('aspect-') || name.startsWith('size-')) return true;
    width = width || name.startsWith('w-');
    height = height || name.startsWith('h-');
  }
  return width && height;
}

/**
 * The declarations of an inline `style`, lower-cased, without comments and
 * `!important`. Later declarations win, as in CSS.
 * @param {string|null} style
 * @returns {Map<string, string>}
 */
export function styleDeclarations(style) {
  /** @type {Map<string, string>} */
  const declarations = new Map();
  if (style === null) return declarations;
  let text = style.slice(0, MAX_ATTRIBUTE_CHARS).toLowerCase();
  // Comments are removed by scanning, never with a pattern that could backtrack.
  for (let start = text.indexOf('/*'); start !== -1; start = text.indexOf('/*', start)) {
    const end = text.indexOf('*/', start + 2);
    text = end === -1 ? text.slice(0, start) : `${text.slice(0, start)} ${text.slice(end + 2)}`;
  }
  for (const part of text.split(';')) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const name = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).replace('!important', '').trim();
    if (name !== '' && value !== '') declarations.set(name, value);
  }
  return declarations;
}

/**
 * The URLs of a `srcset` (or `imagesrcset`) value, as the HTML standard splits
 * candidates: a URL is a run without whitespace, a comma at its end closes the
 * candidate, and descriptors run to the next comma outside parentheses.
 * @param {string|null} value
 * @returns {string[]}  Raw URLs, at most 20.
 */
export function srcsetUrls(value) {
  if (value === null) return [];
  const text = value.slice(0, MAX_ATTRIBUTE_CHARS);
  /** @type {string[]} */
  const urls = [];
  const space = (/** @type {string} */ c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
  let i = 0;
  while (i < text.length && urls.length < MAX_SRCSET_URLS) {
    while (i < text.length && (space(text[i]) || text[i] === ',')) i += 1;
    const start = i;
    while (i < text.length && !space(text[i])) i += 1;
    let url = text.slice(start, i);
    let closed = false;
    while (url.endsWith(',')) {
      url = url.slice(0, -1);
      closed = true;
    }
    if (url !== '') urls.push(url);
    if (closed) continue;
    for (let depth = 0; i < text.length; i += 1) {
      if (text[i] === '(') depth += 1;
      else if (text[i] === ')') depth = Math.max(0, depth - 1);
      else if (text[i] === ',' && depth === 0) break;
    }
  }
  return urls;
}

/**
 * Hidden by its own markup: the `hidden` attribute (not `until-found`) or `display: none` inline.
 * @param {DomNode} node
 * @param {Map<string, string>} style
 */
export function hiddenByMarkup(node, style) {
  const hidden = attr(node, 'hidden');
  return (hidden !== null && hidden.trim().toLowerCase() !== 'until-found') || style.get('display') === 'none';
}

/**
 * True when the image is the only content of a `<figure>` whose `<figcaption>`
 * has text: the figure holds nothing but the caption and this image, which may
 * sit in up to three wrappers (a link, a `<picture>` with its sources, a span
 * or div) that hold nothing else. The HTML standard names the bare case; a
 * linked thumbnail with a caption is the same figure.
 * @param {DomNode} node
 */
function onlyContentOfCaptionedFigure(node) {
  let content = node;
  let figure = node.parentNode;
  for (let depth = 0; figure && !isHtmlElement(figure, 'figure'); depth += 1) {
    if (depth >= 3 || !figure.tagName || !FIGURE_WRAPPERS.has(figure.tagName) || !holdsOnly(figure, content)) return false;
    content = figure;
    figure = figure.parentNode;
  }
  if (!figure) return false;
  let caption = false;
  const children = figure.childNodes ?? [];
  if (children.length > MAX_FIGURE_CHILDREN) return false;
  for (const child of children) {
    if (child === content || (child.nodeName === '#text' && (child.value ?? '').trim() === '')) continue;
    if (!isHtmlElement(child, 'figcaption')) return false;
    caption = caption || textOf(child, true, LIMITS.maxStringLength).trim() !== '';
  }
  return caption;
}

/**
 * True when a wrapper holds `content` and nothing else but whitespace (and, in a `<picture>`, its sources).
 * Stops at the first child that is anything else, so a wrapper with many children costs one or two steps.
 * @param {DomNode} wrapper
 * @param {DomNode} content
 */
function holdsOnly(wrapper, content) {
  for (const child of wrapper.childNodes ?? []) {
    if (child === content || (child.nodeName === '#text' && (child.value ?? '').trim() === '')) continue;
    if (wrapper.tagName === 'picture' && isHtmlElement(child, 'source')) continue;
    return false;
  }
  return true;
}

/**
 * @param {string|null} value
 * @returns {string|null}
 */
function lowerOrNull(value) {
  const trimmed = value?.trim().toLowerCase() ?? '';
  return trimmed === '' ? null : clip(trimmed, LIMITS.maxStringLength);
}

/**
 * The record of one `<img>`: its attributes, and what the media checks need for
 * their exceptions (other text alternatives, hiding, an inline or utility-class
 * size, the priority hint and a preload, a captioned figure, `<picture>` sources).
 * @param {DomNode} node
 * @param {Frame} frame
 * @param {HtmlState} state
 * @returns {ImageRecord}
 */
export function imageRecord(node, frame, state) {
  const src = attr(node, 'src');
  const url = src === null ? null : normalizeUrl(src, state.baseUrl);
  const parent = node.parentNode;
  const picture = parent && isHtmlElement(parent, 'picture') ? parent : null;
  let summary = picture ? state.pictures.get(picture) : undefined;
  if (picture && !summary) {
    summary = summarizePicture(picture);
    state.pictures.set(picture, summary);
  }
  const srcset = attr(node, 'srcset');
  const style = styleDeclarations(attr(node, 'style'));
  /** @param {string} name */
  const optional = (name) => {
    const value = attr(node, name);
    return value === null ? null : clip(value, LIMITS.maxStringLength);
  };
  const width = style.get('width');
  const height = style.get('height');
  const aspect = style.get('aspect-ratio');
  // The candidates are compared with preloads only when the page has one: normalizing them costs.
  const preloaded = state.preloadImages.size > 0
    && [src, ...srcsetUrls(srcset), ...(summary?.urls ?? [])].some((raw) => raw !== null && state.preloadImages.has(normalizeUrl(raw, state.baseUrl) ?? ''));
  return {
    src: clip(src ?? '', LIMITS.maxStringLength),
    url,
    alt: optional('alt'),
    width: optional('width'),
    height: optional('height'),
    loading: optional('loading'),
    has_srcset: srcset !== null || summary?.sources === true,
    line: lineOf(node),
    aria_hidden: frame.ariaHidden || isAriaHidden(node),
    role: tokens((attr(node, 'role') ?? '').slice(0, LIMITS.maxStringLength))[0] ?? null,
    named: ['aria-label', 'aria-labelledby', 'title'].some((name) => (attr(node, name) ?? '').trim() !== '')
      || ALT_BINDINGS.some((name) => attr(node, name) !== null),
    hidden: hiddenByMarkup(node, style),
    pixel: [attr(node, 'width'), attr(node, 'height'), width, height].some(tiny),
    style_sized: (aspect !== undefined && aspect !== 'auto')
      || (width !== undefined && height !== undefined && width !== 'auto' && height !== 'auto')
      || style.get('position') === 'absolute' || style.get('position') === 'fixed',
    class_sized: classSized(attr(node, 'class')),
    chrome: frame.chrome === true,
    fetchpriority: lowerOrNull(attr(node, 'fetchpriority')),
    preloaded,
    figure_caption: onlyContentOfCaptionedFigure(node),
    picture_sources: summary?.sources === true,
    modern_source: summary?.modern === true,
  };
}
