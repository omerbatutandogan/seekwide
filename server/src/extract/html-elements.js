// One element of an HTML document → its part of the content fields of a
// PageRecord (ARCHITECTURE.md 4.6). Pure; html.js walks the document.

/** @import { Heading } from '../types.js' */
/** @import { DomNode } from './dom.js' */
/** @import { HtmlFields } from './html.js' */

import { LIMITS } from '../config.js';
import { clip, collapseWhitespace } from '../util/strings.js';
import { isInternalUrl, normalizeUrl } from '../util/url.js';
import { MAX_LIST_CHARS, attr, insecureUrl, isAriaHidden, lineOf, textChars, textOf, tokens } from './dom.js';
import { parseJsonLd } from './jsonld.js';
import { MAX_VIDEOS, MAX_VIDEO_EMBEDS, visitMedia } from './media.js';

/** Script types a browser runs as JavaScript. */
const SCRIPT_TYPES = new Set(['', 'text/javascript', 'module']);
/**
 * How the inline data scripts of a Next.js App Router page begin. Written so
 * that no two quantifiers can match the same run of spaces: a script of spaces
 * followed by anything else is rejected in linear time.
 */
const NEXT_FLIGHT = /^\s*(?:\(\s*)?self\.__next_f\s*(=|\.push\()/;
/** Only the start of a script is tested; a data script begins with its marker. */
const NEXT_FLIGHT_PREFIX = 1024;

export const MAX_LINKS = 5000;
export const MAX_IMAGES = 2000;
export const MAX_MIXED_CONTENT = 20;
/** Per-page caps on lists, in document order (ARCHITECTURE.md 4.6). */
export const CAPS = Object.freeze({
  titles: 20, meta_descriptions: 20, canonicals: 20, hreflang: 500, headings: 500, jsonld: 100, meta_robots: 50,
});
const LONG_TEXT = 1000;
/** A link's rel attribute has a few tokens; more are not kept. */
const MAX_REL_TOKENS = 20;
const MAX_SOCIAL_KEYS = 50;
/** Attributes through which a script framework or a delegated handler acts on a click, or reads where a link goes. */
const CLICK_BINDINGS = new Set(['ng-click', 'data-ng-click', 'v-on:click', '@click', 'x-on:click', '(click)', 'wire:click', 'hx-get', 'hx-post', 'data-href', 'data-url', 'data-link']);

/**
 * True when an element has an inline event handler other than `onclick`, a
 * framework's click binding (with or without modifiers, `@click.prevent`), or
 * a URL in a `data-href`-style attribute.
 * @param {DomNode} node
 * @returns {boolean}
 */
function hasHandler(node) {
  return (node.attrs ?? []).some(({ name }) => (name.startsWith('on') && name !== 'onclick' && name.length > 2)
    || CLICK_BINDINGS.has(name) || CLICK_BINDINGS.has(name.split('.', 1)[0]));
}

/** Open Graph properties that also give `og.image`, when it has no value yet. */
const OG_IMAGE_ALIASES = new Set(['og:image:url', 'og:image:secure_url']);

/** Subresource elements checked for mixed content, with the attribute that loads them. */
const SUBRESOURCE_ATTR = new Map([
  ['img', 'src'], ['script', 'src'], ['iframe', 'src'], ['video', 'src'], ['audio', 'src'],
  ['source', 'src'], ['embed', 'src'], ['object', 'data'],
]);
const HEADING_LEVELS = new Map([['h1', 1], ['h2', 2], ['h3', 3], ['h4', 4], ['h5', 5], ['h6', 6]]);

/**
 * @typedef {Object} Frame
 * @property {DomNode} node
 * @property {boolean} head  Inside `<head>`.
 * @property {boolean} body  Inside `<body>`.
 * @property {boolean} hidden  Text here is not visible body text.
 * @property {boolean} replaced  Inside fallback content that React's streaming script replaces on load (react-stream.js).
 * @property {boolean} ariaHidden  Inside an element with `aria-hidden="true"`.
 * @property {boolean} chrome  Inside the page's frame rather than its content: navigation, a complementary block, or the
 *   header or footer of the page (media.js, `enterLandmark`).
 * @property {boolean} sectioned  Inside `<article>`, `<main>`, `<section>`, `<aside>` or `<nav>`, where a header or footer belongs to that part.
 */

/**
 * What the walk of one document has collected so far, and what it needs to
 * read an element.
 * @typedef {Object} HtmlState
 * @property {HtmlFields} out
 * @property {string} baseUrl         The first `<base href>`, else the response URL.
 * @property {boolean} https          The page was served over https.
 * @property {string} siteHost
 * @property {boolean} includeSubdomains
 * @property {number} listChars       Characters held by the link, image and hreflang lists so far (`MAX_LIST_CHARS`).
 * @property {boolean} upgradeInsecure  The page upgrades insecure requests.
 * @property {boolean} nextFlight     The page has Next.js App Router data scripts.
 * @property {boolean} bodyTitle      A `<title>` is inside `<body>`.
 * @property {boolean} [ogImageAlias]  `og.image` came from `og:image:url` or `og:image:secure_url`, so a later `og:image` replaces it.
 * @property {Set<string>} preloadImages  URLs that a `<link rel="preload" as="image">` named so far (media.js).
 * @property {WeakMap<DomNode, import('./media-image.js').PictureSummary>} pictures  What each `<picture>` offers, read once (media-image.js).
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
 * Add an entry to a list of the link, image and hreflang budget.
 * @template {object} T @param {HtmlState} state @param {T[]} list @param {T} entry
 */
function keep(state, list, entry) {
  list.push(entry);
  state.listChars += textChars(entry);
}

/** @param {HtmlState} state @param {string|null} raw */
function addMixed(state, raw) {
  if (!state.https || state.out.mixed_content.length >= MAX_MIXED_CONTENT) return;
  const url = insecureUrl(raw, state.baseUrl);
  if (url !== null && !state.out.mixed_content.includes(url)) state.out.mixed_content.push(url);
}

/**
 * Read one HTML element into `state.out`, keeping the caps of every list.
 * @param {DomNode} node
 * @param {Frame} frame  Where the element is.
 * @param {HtmlState} state
 */
export function visitElement(node, frame, state) {
  const tag = /** @type {string} */ (node.tagName);
  const line = lineOf(node);
  visitMedia(node, frame, state, MAX_IMAGES);
  if (tag === 'html') {
    const lang = attr(node, 'lang')?.trim();
    if (lang) state.out.html_lang = clip(lang, LIMITS.maxStringLength);
  } else if (tag === 'title') {
    if (frame.body) state.bodyTitle = true;
    if (hasRoom(state.out.titles, CAPS.titles)) state.out.titles.push(clip(collapseWhitespace(textOf(node, false, LONG_TEXT)), LONG_TEXT));
  } else if (tag === 'meta') {
    const name = attr(node, 'name')?.trim().toLowerCase() ?? '';
    const property = attr(node, 'property')?.trim().toLowerCase() ?? '';
    const content = attr(node, 'content');
    const httpEquiv = attr(node, 'http-equiv')?.trim().toLowerCase();
    if (httpEquiv === 'content-security-policy' && frame.head && upgradesInsecureRequests(content)) state.upgradeInsecure = true;
    if (name === 'description') {
      if (hasRoom(state.out.meta_descriptions, CAPS.meta_descriptions)) state.out.meta_descriptions.push(clip(collapseWhitespace(content ?? ''), LONG_TEXT));
    } else if (name === 'robots' || name === 'googlebot') {
      for (const token of (content ?? '').split(',')) {
        const value = collapseWhitespace(token).toLowerCase();
        if (value !== '' && hasRoom(state.out.meta_robots, CAPS.meta_robots)) state.out.meta_robots.push(clip(value, LIMITS.maxStringLength));
      }
    } else if (name === 'viewport' && state.out.viewport === null) {
      state.out.viewport = clip(collapseWhitespace(content ?? ''), LIMITS.maxStringLength);
    }
    for (const key of [property, name]) {
      if (key.startsWith('og:')) {
        const filled = (content ?? '').trim() !== '';
        // ogp.me: og:image:url is identical to og:image, and og:image:secure_url names the same image over https. Such a
        // property fills og.image while it has no value, and an og:image with a value that comes later still takes its place.
        if (key === 'og:image' && filled && state.ogImageAlias) {
          delete state.out.og.image;
          state.ogImageAlias = false;
        }
        setFirst(state.out.og, key.slice(3), content);
        if (OG_IMAGE_ALIASES.has(key) && filled && (state.out.og.image ?? '').trim() === '') {
          delete state.out.og.image;
          setFirst(state.out.og, 'image', content);
          state.ogImageAlias = true;
        }
      } else if (key.startsWith('twitter:')) setFirst(state.out.twitter, key.slice(8), content);
    }
  } else if (tag === 'link') {
    const rel = tokens(attr(node, 'rel'));
    const href = attr(node, 'href');
    if (rel.includes('canonical') && href !== null && hasRoom(state.out.canonicals, CAPS.canonicals)) {
      const url = normalizeUrl(href, state.baseUrl);
      state.out.canonicals.push({ href: clip(href, LIMITS.maxStringLength), url, source: 'html', in_head: frame.head, line });
    }
    const lang = attr(node, 'hreflang')?.trim();
    if (rel.includes('alternate') && lang && href !== null && hasRoom(state.out.hreflang, CAPS.hreflang) && state.listChars < MAX_LIST_CHARS) {
      keep(state, state.out.hreflang, {
        hreflang: clip(lang, LIMITS.maxStringLength), href: clip(href, LIMITS.maxStringLength),
        url: normalizeUrl(href, state.baseUrl), source: 'html',
      });
    }
    if (rel.includes('stylesheet')) addMixed(state, href);
  } else if (tag === 'a') {
    if (state.out.links.length < MAX_LINKS && state.listChars < MAX_LIST_CHARS) {
      const href = attr(node, 'href');
      const url = href === null ? null : normalizeUrl(href, state.baseUrl);
      keep(state, state.out.links, {
        href: clip(href ?? '', LIMITS.maxStringLength),
        url,
        text: clip(collapseWhitespace(textOf(node, true, LIMITS.maxStringLength, true)), LIMITS.maxStringLength),
        aria_label: clip(attr(node, 'aria-label')?.trim() ?? '', LIMITS.maxStringLength) || null,
        title_attr: clip(attr(node, 'title')?.trim() ?? '', LIMITS.maxStringLength) || null,
        rel: tokens(attr(node, 'rel')).slice(0, MAX_REL_TOKENS).map((token) => clip(token, LIMITS.maxStringLength)),
        internal: url !== null && isInternalUrl(url, state.siteHost, state.includeSubdomains),
        has_onclick: attr(node, 'onclick') !== null,
        has_handler: hasHandler(node),
        aria_hidden: frame.ariaHidden || isAriaHidden(node),
        line,
      });
    }
  } else if (HEADING_LEVELS.has(tag) && !frame.replaced && hasRoom(state.out.headings, CAPS.headings)) {
    const level = /** @type {Heading['level']} */ (HEADING_LEVELS.get(tag));
    state.out.headings.push({ level, text: clip(collapseWhitespace(textOf(node, true, LIMITS.maxStringLength)), LIMITS.maxStringLength), line });
  } else if (tag === 'script') {
    const type = (attr(node, 'type') ?? '').split(';', 1)[0].trim().toLowerCase();
    // The inline scripts that carry a Next.js App Router page's data ("flight" chunks).
    const start = (node.childNodes?.[0]?.value ?? '').slice(0, NEXT_FLIGHT_PREFIX);
    if (!state.nextFlight && attr(node, 'src') === null && SCRIPT_TYPES.has(type) && NEXT_FLIGHT.test(start)) state.nextFlight = true;
    if (type === 'application/ld+json' && hasRoom(state.out.jsonld, CAPS.jsonld)) {
      const source = (node.childNodes ?? []).map((child) => child.value ?? '').join('');
      state.out.jsonld.push(parseJsonLd(source, line));
    }
  }
  const sourceAttr = SUBRESOURCE_ATTR.get(tag);
  if (sourceAttr) addMixed(state, attr(node, sourceAttr));
}

/**
 * The per-page lists that reached their cap, by field name, plus
 * `list_chars` when the characters held by the link, image and hreflang
 * lists did (`MAX_LIST_CHARS`). A list at its cap may have had more entries
 * that were not read.
 * @param {HtmlState} state  After the walk.
 * @returns {string[]}
 */
export function reachedCaps(state) {
  const { out } = state;
  /** @type {[string, unknown[], number][]} */
  const lists = [
    ['links', out.links, MAX_LINKS], ['images', out.images, MAX_IMAGES], ['mixed_content', out.mixed_content, MAX_MIXED_CONTENT],
    ['videos', out.videos, MAX_VIDEOS], ['video_embeds', out.video_embeds, MAX_VIDEO_EMBEDS],
    ...Object.entries(CAPS).map(([name, max]) => /** @type {[string, unknown[], number]} */ ([name, /** @type {any} */ (out)[name], max])),
  ];
  const reached = lists.filter(([, list, max]) => list.length >= max).map(([name]) => name);
  if (state.listChars >= MAX_LIST_CHARS) reached.push('list_chars');
  return reached;
}
