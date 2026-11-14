// What the smo and aso modules read from a page (rule set 0.1.9): where the
// Open Graph and Smart App Banner meta tags are, where the head ends in bytes,
// the Smart App Banner tags themselves and the page's rel="me" links. Pure;
// html.js walks the document and calls these.

/** @import { AppBannerRecord, SocialRecord } from '../types.js' */
/** @import { DomNode } from './dom.js' */
/** @import { Frame } from './html-elements.js' */

import { LIMITS } from '../config.js';
import { clip, collapseWhitespace } from '../util/strings.js';
import { normalizeUrl } from '../util/url.js';
import { HTML_NS, attr, lineOf, tokens } from './dom.js';

/**
 * Meta tags whose place in the document the checks judge, by the name they are
 * reported under. `og:image:url` and `og:image:secure_url` give the image too (ogp.me).
 */
const PLACED = new Map([
  ['og:title', 'og:title'], ['og:description', 'og:description'], ['og:url', 'og:url'],
  ['og:image', 'og:image'], ['og:image:url', 'og:image'], ['og:image:secure_url', 'og:image'],
  ['apple-itunes-app', 'apple-itunes-app'],
]);
export const MAX_APP_BANNERS = 5;
export const MAX_REL_ME = 50;

/**
 * @typedef {Object} SocialState
 * @property {Set<string>} inHead     Placed tags given with content inside `<head>`.
 * @property {Map<string, number|null>} outside  Placed tags given with content outside it, with the line of the first.
 * @property {AppBannerRecord[]} banners
 * @property {string[]} relMe
 * @property {number|null} lastOgEnd  Where the last `og:` meta tag ends, in characters of the document.
 */

/** @returns {SocialState} */
export function socialState() {
  return { inHead: new Set(), outside: new Map(), banners: [], relMe: [], lastOgEnd: null };
}

/** @returns {SocialRecord} A record of a page that has none of these tags. */
export function emptySocial() {
  return { outside_head: [], streamed: false, head_end: null, app_banners: [], rel_me: [] };
}

/**
 * Read what one HTML element adds: a meta tag's place, a Smart App Banner, a
 * rel="me" link (`<a>` or `<link>`). Caps: `MAX_APP_BANNERS` banners and
 * `MAX_REL_ME` distinct rel="me" URLs per page.
 * @param {DomNode} node
 * @param {Frame} frame
 * @param {SocialState} state
 * @param {string} baseUrl
 */
export function visitSocial(node, frame, state, baseUrl) {
  const tag = node.tagName;
  if (tag === 'meta') {
    const content = attr(node, 'content');
    const filled = (content ?? '').trim() !== '';
    const name = attr(node, 'name')?.trim().toLowerCase() ?? '';
    for (const key of new Set([attr(node, 'property')?.trim().toLowerCase() ?? '', name])) {
      if (key.startsWith('og:')) state.lastOgEnd = node.sourceCodeLocation?.endOffset ?? state.lastOgEnd;
      const placed = PLACED.get(key);
      if (placed === undefined || !filled) continue;
      if (frame.head) state.inHead.add(placed);
      else if (!state.outside.has(placed)) state.outside.set(placed, lineOf(node));
    }
    if (name === 'apple-itunes-app' && state.banners.length < MAX_APP_BANNERS) {
      state.banners.push({ content: clip(collapseWhitespace(content ?? ''), LIMITS.maxStringLength), in_head: frame.head, line: lineOf(node) });
    }
  } else if ((tag === 'a' || tag === 'link') && tokens(attr(node, 'rel')).includes('me')) {
    const href = attr(node, 'href');
    const url = href === null ? null : normalizeUrl(href, baseUrl);
    if (url !== null && state.relMe.length < MAX_REL_ME && !state.relMe.includes(url)) state.relMe.push(url);
  }
}

/**
 * Where the parsed `<head>` ends, in characters of the document, or null when
 * the parser recorded no place for it (a document without a head tag).
 * @param {DomNode} document
 * @returns {number|null}
 */
function headEnd(document) {
  const html = (document.childNodes ?? []).find((node) => node.tagName === 'html' && node.namespaceURI === HTML_NS);
  const head = (html?.childNodes ?? []).find((node) => node.tagName === 'head' && node.namespaceURI === HTML_NS);
  const end = head?.sourceCodeLocation?.endOffset;
  return typeof end === 'number' && end > 0 ? end : null;
}

/**
 * The page's `SocialRecord` once the walk is over. `outside_head` lists, in a
 * fixed order, the placed tags the page gives with content only outside
 * `<head>`; `streamed` says that a Next.js App Router page sent its metadata in
 * the body (as for canonicals). `head_end` is where the parsed head ends, in
 * bytes of the response (`toBytes` turns characters of the document into
 * bytes), else where the last `og:` meta tag ends; null when neither is known.
 * @param {SocialState} state
 * @param {DomNode} document
 * @param {(chars: number) => number} toBytes
 * @param {boolean} streamed
 * @returns {SocialRecord}
 */
export function socialRecord(state, document, toBytes, streamed) {
  const outside = [...new Set(PLACED.values())]
    .filter((key) => state.outside.has(key) && !state.inHead.has(key))
    .map((key) => ({ key, line: state.outside.get(key) ?? null }));
  const end = headEnd(document);
  const head_end = end !== null ? { bytes: toBytes(end), by: /** @type {const} */ ('head') }
    : state.lastOgEnd !== null ? { bytes: toBytes(state.lastOgEnd), by: /** @type {const} */ ('og') } : null;
  return { outside_head: outside, streamed: streamed && outside.length > 0, head_end, app_banners: state.banners, rel_me: state.relMe };
}
