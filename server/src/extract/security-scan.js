// One walk over an HTML document for the security module: which links to
// other hosts visitors cannot see, which scripts and frames come from other
// hosts, and the CSP and referrer meta tags. Pure.

/** @import { EmbedRecord, HiddenLinkRecord, LinkRecord } from '../types.js' */
/** @import { SiteIdentity } from '../util/site-identity.js' */
/** @import { DomNode } from './dom.js' */
/** @import { Concealment, HiddenState } from './concealment.js' */

import { LIMITS } from '../config.js';
import { clip, collapseWhitespace } from '../util/strings.js';
import { hostKey, normalizeUrl } from '../util/url.js';
import { VISIBLE, combineStates, concealments, enterElement, tinyFrame } from './concealment.js';
import { HTML_NS, attr, lineOf, textOf } from './dom.js';
import { collectReferences, openable, shadowContent } from './openable.js';
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
/**
 * Most hosts of links the scan follows per page, visible and hidden apart.
 * Every `<a>` is read, however many the page has (the record's `links` stop at
 * 5000): padding a page with links cannot push a hidden one out of sight,
 * only fill this many hosts, which the record then says.
 */
export const MAX_TRACKED_HOSTS = 10_000;

/** The `type` values a browser runs as a script. */
const JS_TYPE = /^(?:|module|(?:text|application)\/(?:x-)?(?:javascript|ecmascript|jscript|livescript))$/;
/** One punctuation character: a hyphen, a dot, a bullet, a vertical bar. Icons are not punctuation. */
const ONE_SMALL_CHARACTER = /^[\p{P}|]$/u;

/**
 * @typedef {Object} ScanContext
 * @property {string} baseUrl
 * @property {SiteIdentity} identity  The audited site, without the visible links of other pages.
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
 * @property {string[]} limits             The scan's caps this page reached: `hosts` (`MAX_TRACKED_HOSTS`),
 *   `hidden_hosts`, `visible_hosts`, `embeds`, `references`.
 */

/**
 * True for a link to a host of the site's own organisation (its registered
 * domain, or the deployed site of a local crawl: `SiteIdentity`), or for a
 * share link of the site on a known share endpoint
 * (`facebook.com/sharer/sharer.php?u=https://acme.com/post`, `isShareLink`).
 * Neither is a sign of a hack. The same name under another ending (acme.de
 * for acme.com) is decided by the check, which knows the visible links of
 * every page.
 * @param {string} url
 * @param {string} host  `hostKey` of the URL.
 * @param {SiteIdentity} identity
 * @returns {boolean}
 */
function ownSite(url, host, identity) {
  return identity.isSameOrganisation(host) || isShareLink(url, identity);
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
  if (url === null || context.identity.isInternal(url)) return null;
  return { url: clip(url, LIMITS.maxStringLength), host: hostKey(new URL(url).host) };
}

/**
 * The http(s) address an `href` names, normalized; for one longer than
 * normalizeUrl accepts (2,048 characters), the address as parsed, so that a
 * long query cannot take a link out of the scan. Null for anything else.
 * @param {string|null} href
 * @param {string} baseUrl
 * @returns {string|null}
 */
function addressOf(href, baseUrl) {
  if (href === null) return null;
  const url = normalizeUrl(href, baseUrl);
  if (url !== null) return url;
  try {
    const parsed = new URL(href.trim(), baseUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * Where an `<a>` goes and what it says: from the record's link when the
 * record kept it with an address, else read from the element the same way.
 * Null for a link that is not to another host.
 * @param {DomNode} node
 * @param {LinkRecord|undefined} link  The record's link for this `<a>`, if the record has room for it.
 * @param {ScanContext} context
 * @returns {{url: string, text: string, labelled: boolean}|null}
 */
function anchorTarget(node, link, context) {
  if (link && (link.internal || link.url !== null)) {
    if (link.internal || link.url === null) return null;
    return { url: link.url, text: link.text, labelled: link.aria_label !== null || link.title_attr !== null };
  }
  const url = addressOf(attr(node, 'href'), context.baseUrl);
  if (url === null || context.identity.isInternal(url)) return null;
  const labelled = (attr(node, 'aria-label')?.trim() ?? '') !== '' || (attr(node, 'title')?.trim() ?? '') !== '';
  return { url, text: clip(collapseWhitespace(textOf(node, true, LIMITS.maxStringLength, true)), LIMITS.maxStringLength), labelled };
}

/**
 * Walk the document once, in document order, visiting the HTML elements the
 * way `extractHtml` does, so that the n-th `<a>` is `links[n]` while the
 * record has room for it; every later `<a>` is read from the element itself.
 *
 * A link to another host is *concealed* when an element the markup hides is
 * around it (or it is that element) and that element is not one a visitor
 * opens: not `openable`, and its `id` named by no control on the page (the
 * ids are read first, from the whole page). When several elements hide it,
 * every one of them must be openable. A link whose whole text is one
 * punctuation character, with no `aria-label` or `title`, is concealed too.
 * Every other link to another host is visible. Each link is sorted as it is
 * met, into its host: memory grows with the hosts, not with the links.
 * @param {DomNode} document  A parse5 document.
 * @param {ScanContext} context
 * @returns {ScanResult}
 */
export function scanDocument(document, context) {
  const references = collectReferences(document);
  const referenced = references.ids;
  /** @type {Set<string>} */
  const limits = new Set(references.capped ? ['references'] : []);
  const hiddenBy = (/** @type {Concealment[]} */ hiders) => hiders.find((hider) => !hider.revealable && !(hider.id !== null && referenced.has(hider.id))) ?? null;
  /** @type {Set<string>} */
  const visibleHosts = new Set();
  /** @type {Map<string, HiddenLinkRecord>} */
  const hiddenHosts = new Map();
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
  /** `shadow`: inside a declarative shadow root, whose links the record does not keep. */
  /** @typedef {{node: DomNode, state: HiddenState, head: boolean, previous: DomNode|null, shadow: boolean}} Frame */
  /** @type {Frame[]} */
  const stack = [{ node: document, state: VISIBLE, head: false, previous: null, shadow: false }];
  while (stack.length > 0) {
    const popped = /** @type {Frame} */ (stack.pop());
    const { node, head: inHead, previous, shadow } = popped;
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
        revealable: streamed || ((style !== null || hidden !== null) && openable(node, previous, references)),
        classed: (attr(node, 'class') ?? '').trim() !== '',
      });
      head = inHead || tag === 'head';
      if (tag === 'a') {
        const index = shadow ? -1 : anchorCount;
        if (!shadow) anchorCount += 1;
        const target = anchorTarget(node, shadow ? undefined : context.links[index], context);
        const host = target === null ? null : hostKey(new URL(target.url).host);
        if (target !== null && host !== null && !ownSite(target.url, host, context.identity)) {
          const hider = hiddenBy(concealments(state));
          const oneCharacter = !target.labelled && ONE_SMALL_CHARACTER.test(target.text.trim());
          if (hider === null && !oneCharacter) {
            // A host the page links to visibly is never kept as hidden, which frees its room for another.
            hiddenHosts.delete(host);
            if (visibleHosts.size < MAX_TRACKED_HOSTS) visibleHosts.add(host);
            else if (!visibleHosts.has(host)) limits.add('hosts');
          } else if (!visibleHosts.has(host)) {
            const known = hiddenHosts.get(host);
            if (known) {
              known.count += 1;
            } else if (hiddenHosts.size < MAX_TRACKED_HOSTS) {
              hiddenHosts.set(host, {
                index, url: clip(target.url, LIMITS.maxStringLength), host, text: clip(target.text, 120),
                how: hider?.how ?? 'one-character link', element: hider?.element ?? null, element_line: hider?.line ?? null, line, count: 1,
              });
            } else {
              limits.add('hosts');
            }
          }
        }
      } else if (tag === 'script' || tag === 'iframe') {
        const type = (attr(node, 'type') ?? '').split(';', 1)[0].trim().toLowerCase();
        const target = tag === 'iframe' || JS_TYPE.test(type) ? external(attr(node, 'src'), context) : null;
        if (target && embeds.length >= MAX_EMBEDS) limits.add('embeds');
        else if (target) {
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
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push({ node: children[i], state, head, previous: before[i], shadow });
    // A declarative shadow root is shown inside the element around its template, under that element's hiding.
    const rooted = shadowContent(node);
    for (let i = rooted.length - 1; i >= 0; i -= 1) stack.push({ node: rooted[i], state: above, head, previous: null, shadow: true });
  }

  const hiddenLinks = [...hiddenHosts.values()];
  if (hiddenLinks.length > MAX_HIDDEN_HOSTS) limits.add('hidden_hosts');
  if (visibleHosts.size > MAX_VISIBLE_HOSTS) limits.add('visible_hosts');
  return {
    hidden_links: hiddenLinks.slice(0, MAX_HIDDEN_HOSTS),
    visible_hosts: [...visibleHosts].slice(0, MAX_VISIBLE_HOSTS),
    embeds: embeds.map(({ tag, url, host, tiny, hiders, line }) => ({ tag, url, host, hidden: tiny ? 'zero size' : hiddenBy(hiders)?.how ?? null, line })),
    meta_csp: metaCsp,
    meta_referrer: metaReferrer,
    limits: [...limits].sort(),
  };
}
