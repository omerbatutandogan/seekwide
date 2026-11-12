// One walk over an HTML document for the security module: which links to
// other hosts visitors cannot see, which scripts and frames come from other
// hosts, and the CSP and referrer meta tags. Pure.

/** @import { EmbedRecord, HiddenLinkRecord, LinkRecord } from '../types.js' */
/** @import { DomNode } from './dom.js' */
/** @import { Concealment, HiddenState } from './concealment.js' */

import { LIMITS } from '../config.js';
import { clip } from '../util/strings.js';
import { siteLabel } from '../util/site-name.js';
import { hostKey, isInternalUrl, normalizeUrl } from '../util/url.js';
import { VISIBLE, combineStates, concealments, enterElement, tinyFrame } from './concealment.js';
import { HTML_NS, attr, isHtmlElement, lineOf } from './dom.js';
import { metaReferrerPolicy } from './security-headers.js';
import { isShareLink } from './share-links.js';

/**
 * Most hosts with hidden links kept per page; each keeps its first link and a
 * count. A host the page also links to visibly is never kept, so a hidden copy
 * of a visible menu cannot use up the room.
 */
export const MAX_HIDDEN_HOSTS = 200;
/** Most hosts with a visible link kept per page. */
export const MAX_VISIBLE_HOSTS = 1000;
export const MAX_EMBEDS = 200;
/** Most ids and values collected from the page's controls. */
const MAX_REFERENCES = 20_000;

/** The `type` values a browser runs as a script. */
const JS_TYPE = /^(?:|module|(?:text|application)\/(?:x-)?(?:javascript|ecmascript|jscript|livescript))$/;
/** One punctuation character: a hyphen, a dot, a bullet, a vertical bar. Icons are not punctuation. */
const ONE_SMALL_CHARACTER = /^[\p{P}|]$/u;
/** Roles of elements a visitor opens. */
const OPENABLE_ROLES = new Set(['dialog', 'alertdialog', 'menu', 'menubar', 'tabpanel', 'tooltip', 'listbox']);
/** Attributes that mark an element a script shows and hides (HTML popovers, Alpine.js, Vue). */
const OPENABLE_ATTRIBUTES = ['popover', 'aria-modal', 'x-show', 'x-cloak', 'v-show'];
/** Attributes whose value names, by id, an element a control opens. */
const ID_ATTRIBUTES = ['aria-controls', 'popovertarget', 'commandfor'];
/** `data-*` attributes that script libraries use to name, by `#id` or id, the element a control opens. */
const DATA_TARGETS = new Set([
  'data-target', 'data-bs-target', 'data-toggle-target', 'data-tab', 'data-tab-target', 'data-src', 'data-modal', 'data-modal-target',
  'data-popup', 'data-open', 'data-reveal-id', 'data-micromodal-trigger', 'data-controls', 'data-panel', 'data-fancybox-src',
]);

/**
 * @typedef {Object} ScanContext
 * @property {string} baseUrl
 * @property {string} siteHost
 * @property {boolean} includeSubdomains
 * @property {LinkRecord[]} links  The record's links, in the document order this walk counts `<a>` elements in.
 * @property {Map<DomNode, DomNode>} [revealed]  Hidden elements that React's streaming script reveals on load, each with the
 *   template whose place its content takes (react-stream.js).
 */

/**
 * @typedef {Object} ScanResult  What one document says, before the response headers are added.
 * @property {HiddenLinkRecord[]} hidden_links
 * @property {string[]} visible_hosts
 * @property {EmbedRecord[]} embeds
 * @property {boolean} meta_csp            A Content-Security-Policy `<meta http-equiv>` inside `<head>`.
 * @property {string|null} meta_referrer   The policy of the last valid `<meta name="referrer">`.
 */

/**
 * True for an element that a visitor opens: one with an openable role or
 * attribute, or one that comes right after a disclosure control (a
 * `<summary>`, or an element that says with `aria-expanded` or
 * `aria-haspopup` that it opens something). A plain button or link before it
 * does not count: a page's last element is often a back-to-top button, and
 * injected content often comes right after it.
 * @param {DomNode} node
 * @param {DomNode|null} previous  The element right before it among its siblings.
 * @returns {boolean}
 */
function openable(node, previous) {
  if (OPENABLE_ROLES.has((attr(node, 'role') ?? '').trim().toLowerCase())) return true;
  if (OPENABLE_ATTRIBUTES.some((name) => attr(node, name) !== null)) return true;
  if (!previous || previous.namespaceURI !== HTML_NS) return false;
  return isHtmlElement(previous, 'summary') || attr(previous, 'aria-expanded') !== null || attr(previous, 'aria-haspopup') !== null;
}

/**
 * The ids an element's controls name: `aria-controls`, `popovertarget` and
 * `commandfor` hold ids; `href="#id"` on a link and the `DATA_TARGETS`
 * attributes name one with or without `#`. The second list is returned apart,
 * because only it is capped.
 * @param {DomNode} node
 * @returns {{ids: string[], data: string[]}}
 */
function referencedIds(node) {
  /** @type {string[]} */
  const ids = [];
  /** @type {string[]} */
  const data = [];
  const link = isHtmlElement(node, 'a') || isHtmlElement(node, 'area');
  for (const { name, value } of node.attrs ?? []) {
    const trimmed = value.trim();
    if (trimmed === '' || trimmed.length > 200) continue;
    if (ID_ATTRIBUTES.includes(name)) ids.push(...trimmed.split(/\s+/));
    else if (name === 'href' && link && trimmed.startsWith('#')) ids.push(trimmed.slice(1));
    else if (DATA_TARGETS.has(name)) data.push(trimmed.startsWith('#') ? trimmed.slice(1) : trimmed);
  }
  return { ids, data };
}

/**
 * True for a link to another domain of the same organisation (the same
 * registered name under another ending: acme.com and acme.de; `siteLabel`,
 * which keeps each customer of a shared hosting domain apart), or for a share
 * link of the site on a known share or messaging service
 * (`facebook.com/sharer?u=https://acme.com/post`, `isShareLink`). Neither is a
 * sign of a hack.
 * @param {string} url
 * @param {string} host  `hostKey` of the URL.
 * @param {ScanContext} context
 * @returns {boolean}
 */
function ownSite(url, host, context) {
  const own = siteLabel(hostKey(context.siteHost));
  if (own !== null && siteLabel(host) === own) return true;
  return isShareLink(url, host, hostKey(context.siteHost));
}

/**
 * True for a frame that loads a media or map player (a path segment `embed` or
 * `player`, or a host that starts with `player.`): content a page keeps hidden
 * until the visitor opens it.
 * @param {string} url
 * @returns {boolean}
 */
function mediaPlayer(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.startsWith('player.') || parsed.pathname.split('/').some((segment) => segment === 'embed' || segment === 'player');
  } catch {
    return false;
  }
}

/**
 * @param {string|null} raw
 * @param {ScanContext} context
 * @returns {{url: string, host: string}|null} The URL when it is on another host than the site.
 */
function external(raw, context) {
  if (raw === null) return null;
  const url = normalizeUrl(raw, context.baseUrl);
  if (url === null || isInternalUrl(url, context.siteHost, context.includeSubdomains)) return null;
  return { url: clip(url, LIMITS.maxStringLength), host: hostKey(new URL(url).host) };
}

/**
 * Walk the document once, in document order, visiting the HTML elements the
 * way `extractHtml` does, so that the n-th `<a>` is `links[n]`.
 *
 * A link to another host is *concealed* when an element the markup hides is
 * around it (or it is that element) and that element is not one a visitor
 * opens: not `openable`, and its `id` named by no control on the page. When
 * several elements hide it, every one of them must be openable. A link whose
 * whole text is one punctuation character, with no `aria-label` or `title`,
 * is concealed too. Every other link to another host is visible.
 * @param {DomNode} document  A parse5 document.
 * @param {ScanContext} context
 * @returns {ScanResult}
 */
export function scanDocument(document, context) {
  /** @type {Set<string>} */
  const referenced = new Set();
  /** @type {{link: LinkRecord, index: number, host: string, hiders: Concealment[], line: number|null}[]} */
  const anchors = [];
  /** @type {{tag: 'script'|'iframe', url: string, host: string, tiny: boolean, hiders: Concealment[], line: number|null}[]} */
  const embeds = [];
  let metaCsp = false;
  /** @type {string|null} */
  let metaReferrer = null;
  let anchorCount = 0;
  const revealed = context.revealed ?? new Map();
  const places = new Set(revealed.values());
  /** The hidden state where each such template stands, which is where its segment's content ends up. @type {Map<DomNode, HiddenState>} */
  const placeStates = new Map();
  /** @typedef {{node: DomNode, state: HiddenState, head: boolean, previous: DomNode|null}} Frame */
  /** @type {Frame[]} */
  const stack = [{ node: document, state: VISIBLE, head: false, previous: null }];
  while (stack.length > 0) {
    const popped = /** @type {Frame} */ (stack.pop());
    const { node, head: inHead, previous } = popped;
    if (places.has(node)) placeStates.set(node, popped.state);
    // A streamed React segment's content is seen where it is served and where the page's script moves it (its template):
    // what hides it in either place hides it.
    const place = revealed.get(node);
    const above = place === undefined ? popped.state : combineStates(placeStates.get(place) ?? VISIBLE, popped.state);
    let state = above;
    let head = inHead;
    const tag = node.tagName;
    if (tag && node.namespaceURI === HTML_NS) {
      const line = lineOf(node);
      const style = attr(node, 'style');
      const hidden = attr(node, 'hidden');
      // A streamed React segment is revealed by the page itself; only its `hidden` attribute is excused, never a style.
      const streamed = style === null && hidden !== null && place !== undefined;
      state = enterElement(above, {
        tag, hidden, style, line, id: attr(node, 'id'),
        revealable: streamed || ((style !== null || hidden !== null) && openable(node, previous)),
        classed: (attr(node, 'class') ?? '').trim() !== '',
      });
      head = inHead || tag === 'head';
      const named = referencedIds(node);
      for (const id of named.ids) referenced.add(id);
      if (referenced.size < MAX_REFERENCES) for (const id of named.data) referenced.add(id);
      if (tag === 'a') {
        const index = anchorCount;
        anchorCount += 1;
        const link = context.links[index];
        if (link && !link.internal && link.url !== null) {
          const host = hostKey(new URL(link.url).host);
          if (!ownSite(link.url, host, context)) anchors.push({ link, index, host, hiders: concealments(state), line });
        }
      } else if (tag === 'script' || tag === 'iframe') {
        const type = (attr(node, 'type') ?? '').split(';', 1)[0].trim().toLowerCase();
        const target = tag === 'iframe' || JS_TYPE.test(type) ? external(attr(node, 'src'), context) : null;
        if (target && embeds.length < MAX_EMBEDS) {
          const tiny = tag === 'iframe' && tinyFrame({ width: attr(node, 'width'), height: attr(node, 'height'), style });
          /** @type {Concealment[]} */
          let hiders = tag === 'iframe' ? concealments(state) : [];
          // A player hidden by the box around it waits to be opened; one that hides itself does not.
          if (hiders.length > 0 && mediaPlayer(target.url)) hiders = concealments(enterElement(VISIBLE, { tag, hidden, style, line }));
          embeds.push({ tag, url: target.url, host: target.host, tiny, hiders, line });
        }
      } else if (tag === 'meta') {
        const httpEquiv = attr(node, 'http-equiv')?.trim().toLowerCase();
        if (head && httpEquiv === 'content-security-policy' && (attr(node, 'content') ?? '').trim() !== '') metaCsp = true;
        if (attr(node, 'name')?.trim().toLowerCase() === 'referrer') metaReferrer = metaReferrerPolicy(attr(node, 'content')) ?? metaReferrer;
      }
    }
    const children = node.childNodes ?? [];
    /** @type {(DomNode|null)[]} */
    const before = [];
    let lastElement = null;
    for (const child of children) {
      before.push(lastElement);
      if (child.tagName) lastElement = child;
    }
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push({ node: children[i], state, head, previous: before[i] });
  }

  const hiddenBy = (/** @type {Concealment[]} */ hiders) => hiders.find((hider) => !hider.revealable && !(hider.id !== null && referenced.has(hider.id))) ?? null;
  const classified = anchors.map((anchor) => {
    const hider = hiddenBy(anchor.hiders);
    const oneCharacter = anchor.link.aria_label === null && anchor.link.title_attr === null && ONE_SMALL_CHARACTER.test(anchor.link.text.trim());
    return { ...anchor, hider, concealed: hider !== null || oneCharacter };
  });
  /** @type {Set<string>} */
  const visibleHosts = new Set(classified.filter((anchor) => !anchor.concealed).map((anchor) => anchor.host));
  /** @type {Map<string, HiddenLinkRecord>} */
  const hiddenHosts = new Map();
  for (const { link, index, host, hider, concealed, line } of classified) {
    if (!concealed || visibleHosts.has(host)) continue;
    const known = hiddenHosts.get(host);
    if (known) {
      known.count += 1;
    } else if (hiddenHosts.size < MAX_HIDDEN_HOSTS) {
      hiddenHosts.set(host, {
        index, url: clip(/** @type {string} */ (link.url), LIMITS.maxStringLength), host, text: clip(link.text, 120),
        how: hider?.how ?? 'one-character link', element: hider?.element ?? null, element_line: hider?.line ?? null, line, count: 1,
      });
    }
  }
  return {
    hidden_links: [...hiddenHosts.values()],
    visible_hosts: [...visibleHosts].slice(0, MAX_VISIBLE_HOSTS),
    embeds: embeds.map(({ tag, url, host, tiny, hiders, line }) => ({ tag, url, host, hidden: tiny ? 'zero size' : hiddenBy(hiders)?.how ?? null, line })),
    meta_csp: metaCsp,
    meta_referrer: metaReferrer,
  };
}
