// Share links: a link that asks a share or messaging service to post the
// audited page. A hidden share menu is a menu, not injected spam, so such a
// link is left out of the hidden-link check. Only a service's share endpoint
// counts, with the page's address in the parameter the service reads it
// from: any other page of the same service (a channel, a profile, a group, a
// chat with a phone number) is a link like any other, whatever its query
// holds, since an injected link can name the site in its query as easily as a
// share button does. Pure.

/** @import { SiteIdentity } from '../util/site-identity.js' */

/**
 * @typedef {Object} ShareEndpoint
 * @property {string[]} hosts    `hostKey` values (no `www.`), matched exactly: a subdomain is another host, so a blog
 *   on tumblr.com is not Tumblr's share page; a port makes another host too.
 * @property {string[]} paths    Paths of the endpoint, compared without letter case and without a trailing slash.
 * @property {string} [url]      The parameter that holds the address to share.
 * @property {string} [text]     A parameter of free text that holds it, or that may hold more addresses.
 * @property {string} [without]  A parameter that, when set, sends the link somewhere else than a share (a phone number).
 */

/**
 * The share endpoints recognised, and where each service says the address
 * goes. Read on 2026-11-12:
 * - Facebook: the Share Dialog, `facebook.com/dialog/share?href=`
 *   (https://developers.facebook.com/docs/sharing/reference/share-dialog), and
 *   the Feed Dialog, `facebook.com/dialog/feed?link=`
 *   (https://developers.facebook.com/docs/sharing/reference/feed-dialog). The
 *   older `/sharer/sharer.php?u=` and `/sharer.php?u=` are on neither page but
 *   are what the share menus of the validation pages of 2026-11-12 use
 *   (wordpress.org, webtekno.com, soilboy.com).
 * - X: the web intent `/intent/tweet` (and `/intent/post`) with `url` and
 *   `text`. X's page (https://developer.x.com/en/docs/x-for-websites/tweet-button/guides/web-intent)
 *   refused a script (HTTP 402); the form is the one the validation pages use,
 *   with the older `/share?url=` (yoast.com).
 * - LinkedIn: `/sharing/share-offsite/?url=`, and the older `/shareArticle?url=`
 *   and `/cws/share?url=` that the validation pages use (yoast.com,
 *   webtekno.com). LinkedIn's page on sharing
 *   (https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin)
 *   documents only its API.
 * - Pinterest: `/pin/create/button/?url=` (the Save button; its page,
 *   https://developers.pinterest.com/docs/web-features/save/, answered 404).
 * - WhatsApp: `https://wa.me/?text=` with no phone number, which lets the
 *   visitor pick a chat; `wa.me/<number>` opens a chat with that number and is
 *   not a share (https://faq.whatsapp.com/5913398998672934). The same `text`
 *   on `api.whatsapp.com/send` and `web.whatsapp.com/send`, without `phone`.
 * - Telegram: `t.me/share/url?url=&text=` (https://core.telegram.org/widgets/share),
 *   also on its older domain telegram.me.
 * - Tumblr: `tumblr.com/widgets/share/tool?canonicalUrl=`
 *   (https://help.tumblr.com/hc/en-us/share-button-documentation/).
 * - VK: `vk.com/share.php?url=` (https://dev.vk.com/ru/widgets/share refused a script).
 * - Reddit: `reddit.com/submit?url=` (Reddit's documentation refused a script).
 * - Mastodon Share: `mastodonshare.com/?text=&url=` (https://mastodonshare.com/).
 * Older forms that share-button code still writes, added after the review of
 * 2026-11-12 so that a hidden share menu written with them is not reported:
 * Facebook's `/share.php?u=`, X's `mobile.twitter.com` and
 * `twitter.com/home?status=`, Tumblr's `/share/link?url=`. Other parameters
 * (an image in Pinterest's `media`, Facebook's `redirect_uri`, a `quote`) are
 * not read: they do not change where the link goes, which is the service.
 * An e-mail link (`mailto:`) is not a web address and never counts.
 * @type {readonly ShareEndpoint[]}
 */
export const SHARE_ENDPOINTS = Object.freeze([
  { hosts: ['facebook.com', 'm.facebook.com'], paths: ['/dialog/share'], url: 'href' },
  { hosts: ['facebook.com', 'm.facebook.com'], paths: ['/dialog/feed'], url: 'link' },
  { hosts: ['facebook.com', 'm.facebook.com'], paths: ['/sharer/sharer.php', '/sharer.php', '/share.php'], url: 'u' },
  { hosts: ['twitter.com', 'x.com', 'mobile.twitter.com'], paths: ['/intent/tweet', '/intent/post', '/share'], url: 'url', text: 'text' },
  { hosts: ['twitter.com', 'mobile.twitter.com'], paths: ['/home'], text: 'status' },
  { hosts: ['linkedin.com'], paths: ['/sharing/share-offsite', '/sharearticle', '/cws/share'], url: 'url' },
  { hosts: ['pinterest.com'], paths: ['/pin/create/button'], url: 'url' },
  { hosts: ['wa.me'], paths: ['/'], text: 'text' },
  { hosts: ['api.whatsapp.com', 'web.whatsapp.com'], paths: ['/send'], text: 'text', without: 'phone' },
  { hosts: ['t.me', 'telegram.me'], paths: ['/share/url'], url: 'url', text: 'text' },
  { hosts: ['tumblr.com'], paths: ['/widgets/share/tool'], url: 'canonicalUrl' },
  { hosts: ['tumblr.com'], paths: ['/share/link'], url: 'url' },
  { hosts: ['vk.com'], paths: ['/share.php'], url: 'url' },
  { hosts: ['reddit.com'], paths: ['/submit'], url: 'url' },
  { hosts: ['mastodonshare.com'], paths: ['/'], url: 'url', text: 'text' },
]);

/** The hosts of every endpoint. */
export const SHARE_SERVICES = Object.freeze(new Set(SHARE_ENDPOINTS.flatMap((endpoint) => endpoint.hosts)));

/** An http(s) address inside free text, or a host written with `www.` and no scheme. */
const ADDRESS_IN_TEXT = /(?:https?:\/\/|\bwww\.)[^\s<>"'`]+/gi;
/** Most addresses read from one text parameter. */
const MAX_ADDRESSES = 20;

/**
 * True for a share link of the audited site: a link to a share endpoint
 * (`SHARE_ENDPOINTS`) that carries at least one address, every one of them on
 * the site (`SiteIdentity.namesSite`: its pages, its host name, or the
 * deployed site of a local crawl). The address is read from the endpoint's
 * URL parameter, and from its text parameter, where every address must be
 * the site's too. Anything else is not one.
 * @param {string} url  The link's normalized URL.
 * @param {SiteIdentity} identity
 * @returns {boolean}
 */
export function isShareLink(url, identity) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.host.toLowerCase().replace(/^www\./, '');
  if (!SHARE_SERVICES.has(host)) return false;
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/, '').toLowerCase() : parsed.pathname;
  const endpoint = SHARE_ENDPOINTS.find((candidate) => candidate.hosts.includes(host) && candidate.paths.includes(path));
  if (!endpoint) return false;
  const params = parsed.searchParams;
  if (endpoint.without && (params.get(endpoint.without) ?? '').trim() !== '') return false;
  /** @type {string[]} */
  const addresses = [];
  // Every value of a repeated parameter counts: a server can read any of them.
  for (const value of endpoint.url ? params.getAll(endpoint.url).slice(0, MAX_ADDRESSES) : []) {
    const named = value.trim();
    if (named === '') continue;
    if (/\s/.test(named)) return false;
    addresses.push(named);
  }
  for (const text of endpoint.text ? params.getAll(endpoint.text).slice(0, MAX_ADDRESSES) : []) {
    // Punctuation that ends a sentence is not part of the address before it; a host written without a scheme is read as https.
    for (const found of (text.match(ADDRESS_IN_TEXT) ?? []).slice(0, MAX_ADDRESSES)) {
      const address = found.replace(/[.,;:!?)\]]+$/, '');
      addresses.push(/^www\./i.test(address) ? `https://${address}` : address);
    }
  }
  if (addresses.length === 0) return false;
  return addresses.every((address) => /^https?:\/\//i.test(address) && identity.namesSite(address));
}
