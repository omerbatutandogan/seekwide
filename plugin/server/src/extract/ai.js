// What the ai module reads on a page during extraction: the directives Bing
// reads (robots and bingbot meta tags), elements marked data-nosnippet, the
// scripts in the body and an empty application mount element. Pure; called
// for every element of the walk in html.js, in constant time per element.

/** @import { AiPageRecord } from '../types.js' */
/** @import { DomNode } from './dom.js' */

import { LIMITS } from '../config.js';
import { clip, collapseWhitespace } from '../util/strings.js';
import { attr } from './dom.js';

/** Directive tokens kept per page, as for `meta_robots`. */
export const MAX_BING_TOKENS = 50;
/** Elements counted, at most. */
const MAX_COUNT = 1000;
/** The ids single-page application frameworks mount into: React (create-react-app, Vite), Next.js, Vue, Nuxt. */
const MOUNT_IDS = new Set(['root', '__next', 'app', '__nuxt']);

/**
 * @typedef {Object} AiState
 * @property {string[]} bingbot
 * @property {number} nosnippetElements
 * @property {string[]} nosnippetText  Visible text inside data-nosnippet elements, collected by the walk.
 * @property {boolean|null} h1Nosnippet
 * @property {number} bodyScripts
 * @property {string|null} emptyMount
 */

/** @returns {AiState} */
export function aiState() {
  return { bingbot: [], nosnippetElements: 0, nosnippetText: [], h1Nosnippet: null, bodyScripts: 0, emptyMount: null };
}

/**
 * The AI record of a page with no HTML content: nothing found.
 * @returns {AiPageRecord}
 */
export function emptyAi() {
  return { bingbot: [], nosnippet_elements: 0, nosnippet_words: 0, nosnippet_h1: null, body_scripts: 0, empty_mount: null };
}

/**
 * The elements on which Google honours `data-nosnippet` (robots meta tag page, read 2026-11-14: "not a span, div, or
 * section" is NOT VALID). Bing applies it to any element; only these count, so a mark Google ignores is never reported.
 */
const NOSNIPPET_TAGS = new Set(['span', 'div', 'section']);

/**
 * True when an element is a `span`, `div` or `section` that carries
 * `data-nosnippet` (any value; the attribute is what counts).
 * @param {DomNode} node
 * @returns {boolean}
 */
export function hasNosnippet(node) {
  return NOSNIPPET_TAGS.has(node.tagName ?? '') && (node.attrs ?? []).some(({ name }) => name === 'data-nosnippet');
}

/**
 * True when an element holds nothing but whitespace and comments.
 * @param {DomNode} node
 * @returns {boolean}
 */
function isEmpty(node) {
  return (node.childNodes ?? []).every((child) => child.nodeName === '#comment' || (child.nodeName === '#text' && (child.value ?? '').trim() === ''));
}

/**
 * Directive tokens of a robots-style `content` value, lower-cased, split at commas.
 * @param {string|null} content
 * @returns {string[]}
 */
export function directiveTokens(content) {
  return (content ?? '').split(',').map((token) => collapseWhitespace(token).toLowerCase()).filter((token) => token !== '');
}

/**
 * Read one HTML element for the ai module.
 * @param {DomNode} node
 * @param {{body: boolean, nosnippet: boolean, replaced: boolean}} frame  Where the element is (the frame it is entered with).
 * @param {AiState} state
 */
export function visitAi(node, frame, state) {
  const tag = node.tagName;
  if (tag === 'meta') {
    const name = attr(node, 'name')?.trim().toLowerCase();
    if (name === 'robots' || name === 'bingbot') {
      for (const token of directiveTokens(attr(node, 'content'))) {
        if (state.bingbot.length < MAX_BING_TOKENS) state.bingbot.push(clip(token, LIMITS.maxStringLength));
      }
    }
    return;
  }
  if (!frame.body) return;
  if (tag === 'script') {
    if (state.bodyScripts < MAX_COUNT) state.bodyScripts += 1;
    return;
  }
  if (hasNosnippet(node) && state.nosnippetElements < MAX_COUNT) state.nosnippetElements += 1;
  if (tag === 'h1' && !frame.replaced && state.h1Nosnippet === null) state.h1Nosnippet = frame.nosnippet || hasNosnippet(node);
  // An application shell mounts into an element right under <body>; an empty widget deeper in a server-rendered page is not one.
  if (state.emptyMount === null && node.parentNode?.tagName === 'body') {
    const id = attr(node, 'id');
    if (id !== null && MOUNT_IDS.has(id) && isEmpty(node)) state.emptyMount = id;
  }
}

/**
 * The page's AI record from what the walk collected.
 * @param {AiState} state
 * @param {RegExp} word  The pattern that counts words of visible text (html.js).
 * @returns {AiPageRecord}
 */
export function aiRecord(state, word) {
  const text = collapseWhitespace(state.nosnippetText.join(' '));
  return {
    bingbot: state.bingbot,
    nosnippet_elements: state.nosnippetElements,
    nosnippet_words: text === '' ? 0 : text.match(word)?.length ?? 0,
    nosnippet_h1: state.h1Nosnippet,
    body_scripts: state.bodyScripts,
    empty_mount: state.emptyMount,
  };
}
