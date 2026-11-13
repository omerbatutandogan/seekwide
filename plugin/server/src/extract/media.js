// Images, videos and embedded video players of an HTML document → their part
// of a PageRecord (media module, CHECKS-SPEC "Media module"). Pure; called by
// html-elements.js for each element in document order.

/** @import { VideoEmbedRecord, VideoRecord } from '../types.js' */
/** @import { DomNode } from './dom.js' */
/** @import { Frame, HtmlState } from './html-elements.js' */

import { normalizeUrl } from '../util/url.js';
import { MAX_LIST_CHARS, attr, isAriaHidden, isHtmlElement, lineOf, textChars, tokens } from './dom.js';
import { hiddenByMarkup, imageRecord, srcsetUrls, styleDeclarations } from './media-image.js';

export { srcsetUrls, styleDeclarations };

export const MAX_VIDEOS = 200;
export const MAX_VIDEO_EMBEDS = 100;
const MAX_TRACKS = 20;
const MAX_PRELOADS = 50;
const TRACK_KINDS = new Set(['subtitles', 'captions', 'descriptions', 'chapters', 'metadata']);
/** Elements that make a header or footer inside them that part's own. */
const SECTIONING = new Set(['article', 'main', 'section', 'aside', 'nav']);
/** Roles of the page's frame: its banner, navigation, footer and complementary blocks. */
const CHROME_ROLES = new Set(['banner', 'navigation', 'contentinfo', 'complementary']);

/**
 * Where an element puts what it contains: in the page's frame (`chrome`:
 * navigation, a complementary block, the page's own header or footer, or an
 * element with one of their roles), and inside a sectioning element, which
 * makes a header or footer below it that part's own.
 * @param {DomNode} node  An HTML element.
 * @param {{chrome: boolean, sectioned: boolean}} parent
 * @returns {{chrome: boolean, sectioned: boolean}}
 */
export function enterLandmark(node, parent) {
  const tag = node.tagName ?? '';
  const role = tokens((attr(node, 'role') ?? '').slice(0, 100))[0] ?? '';
  const pageEdge = (tag === 'header' || tag === 'footer') && !parent.sectioned;
  return {
    chrome: parent.chrome || tag === 'nav' || tag === 'aside' || pageEdge || CHROME_ROLES.has(role),
    sectioned: parent.sectioned || SECTIONING.has(tag),
  };
}

/**
 * The record of one `<video>`: its address, how it plays and the kinds of its tracks.
 * @param {DomNode} node
 * @param {Frame} frame
 * @param {HtmlState} state
 * @returns {VideoRecord}
 */
function videoRecord(node, frame, state) {
  const children = node.childNodes ?? [];
  const source = children.find((child) => isHtmlElement(child, 'source') && attr(child, 'src') !== null);
  const raw = attr(node, 'src') ?? (source ? attr(source, 'src') : null);
  const tracks = children
    .filter((child) => isHtmlElement(child, 'track'))
    .slice(0, MAX_TRACKS)
    .map((track) => {
      const kind = attr(track, 'kind')?.trim().toLowerCase() ?? '';
      if (kind === '') return 'subtitles';
      return TRACK_KINDS.has(kind) ? kind : 'metadata';
    });
  return {
    url: raw === null ? null : normalizeUrl(raw, state.baseUrl),
    muted: attr(node, 'muted') !== null,
    autoplay: attr(node, 'autoplay') !== null,
    controls: attr(node, 'controls') !== null,
    aria_hidden: frame.ariaHidden || isAriaHidden(node),
    hidden: hiddenByMarkup(node, styleDeclarations(attr(node, 'style'))),
    tracks,
    line: lineOf(node),
  };
}

/**
 * The video platform whose player a URL is, or null.
 * @param {string} url  A normalized http(s) URL.
 * @returns {string|null}
 */
export function videoPlatform(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname;
  if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) return path.startsWith('/embed/') ? 'youtube' : null;
  if (host === 'player.vimeo.com') return path.startsWith('/video/') ? 'vimeo' : null;
  if (host === 'fast.wistia.net' || host.endsWith('.wistia.com')) return path.startsWith('/embed/') ? 'wistia' : null;
  if (host === 'dailymotion.com') return path.startsWith('/embed/') ? 'dailymotion' : null;
  if (host === 'geo.dailymotion.com') return path.startsWith('/player') ? 'dailymotion' : null;
  if (host === 'players.brightcove.net') return 'brightcove';
  if (host === 'cdn.jwplayer.com' || host === 'content.jwplatform.com') return path.startsWith('/players/') ? 'jwplayer' : null;
  if (host === 'loom.com') return path.startsWith('/embed/') ? 'loom' : null;
  if (host === 'play.vidyard.com') return 'vidyard';
  if (host === 'tiktok.com') return path.startsWith('/embed/') ? 'tiktok' : null;
  return null;
}

/**
 * True when `itemtype` (microdata) or `typeof` (RDFa) names schema.org's `VideoObject`.
 * @param {DomNode} node
 */
function namesVideoObject(node) {
  const itemtype = tokens(attr(node, 'itemtype')).some((token) => /^https?:\/\/schema\.org\/videoobject$/.test(token));
  if (itemtype) return true;
  return (attr(node, 'typeof') ?? '').split(/\s+/).some((token) => token === 'VideoObject' || token.endsWith(':VideoObject') || token.endsWith('/VideoObject'));
}

/** @param {HtmlState} state @param {object} entry */
function fits(state, entry) {
  if (state.listChars >= MAX_LIST_CHARS) return false;
  state.listChars += textChars(entry);
  return true;
}

/**
 * Read the media of one HTML element into `state.out`: images (within
 * `maxImages` and the page's list budget), videos, embedded video players,
 * the images a `<link rel="preload">` names, and microdata or RDFa that names
 * a `VideoObject`. Preloads are read before the images after them.
 * @param {DomNode} node
 * @param {Frame} frame
 * @param {HtmlState} state
 * @param {number} maxImages
 */
export function visitMedia(node, frame, state, maxImages) {
  const tag = /** @type {string} */ (node.tagName);
  const { out } = state;
  if (!out.video_markup && node.attrs && node.attrs.length > 0 && namesVideoObject(node)) out.video_markup = true;
  if (tag === 'img') {
    if (out.images.length >= maxImages) return;
    const record = imageRecord(node, frame, state);
    if (fits(state, record)) out.images.push(record);
  } else if (tag === 'video') {
    if (out.videos.length >= MAX_VIDEOS) return;
    const record = videoRecord(node, frame, state);
    if (fits(state, record)) out.videos.push(record);
  } else if (tag === 'iframe' || tag === 'embed' || tag === 'object') {
    const raw = attr(node, tag === 'object' ? 'data' : 'src');
    const url = raw === null ? null : normalizeUrl(raw, state.baseUrl);
    const platform = url === null ? null : videoPlatform(url);
    if (url === null || platform === null || out.video_embeds.length >= MAX_VIDEO_EMBEDS) return;
    /** @type {VideoEmbedRecord} */
    const record = { tag, url, platform, line: lineOf(node) };
    if (fits(state, record)) out.video_embeds.push(record);
  } else if (tag === 'link' && tokens(attr(node, 'rel')).includes('preload') && attr(node, 'as')?.trim().toLowerCase() === 'image') {
    for (const raw of [attr(node, 'href'), ...srcsetUrls(attr(node, 'imagesrcset'))]) {
      const url = raw === null ? null : normalizeUrl(raw, state.baseUrl);
      if (url !== null && state.preloadImages.size < MAX_PRELOADS) state.preloadImages.add(url);
    }
  }
}
