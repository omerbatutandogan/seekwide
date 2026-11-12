// Share links: a link that asks a share or messaging service to post the
// audited page. A hidden share menu is a menu, not injected spam, so such a
// link is left out of the hidden-link check. A link to any other host counts,
// whatever its query holds: an injected link can name the site in its query
// too (`spam.test/pills?ref=acme.com`). Pure.

/**
 * The share and messaging services whose share links are recognised, as a
 * `hostKey` (no `www.`), matched exactly: a subdomain is another host, so a
 * blog on tumblr.com is not Tumblr's share page. From the share URLs each
 * service documents for websites, read on 2026-11-12: Facebook
 * (https://developers.facebook.com/docs/sharing/reference/share-dialog, and the
 * older /sharer/sharer.php), X
 * (https://developer.x.com/en/docs/x-for-websites/tweet-button/guides/web-intent),
 * LinkedIn
 * (https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin),
 * Pinterest (https://developers.pinterest.com/docs/web-features/save/),
 * WhatsApp (https://faq.whatsapp.com/5913398998672934), Telegram
 * (https://core.telegram.org/widgets/share), Tumblr
 * (https://www.tumblr.com/docs/en/share_button), VK
 * (https://dev.vk.com/ru/widgets/share) and Reddit's submit page
 * (reddit.com/submit?url=…; Reddit's documentation refused to be read by a
 * script). Mastodon Share (https://mastodonshare.com/) was found with the
 * others in the share menus of the pages of the validation of 2026-11-12. An
 * e-mail link (`mailto:`) is not a web address and never counts.
 */
export const SHARE_SERVICES = Object.freeze(new Set([
  'facebook.com', 'm.facebook.com', 'twitter.com', 'x.com', 'linkedin.com', 'pinterest.com', 'wa.me', 'api.whatsapp.com',
  'web.whatsapp.com', 't.me', 'telegram.me', 'tumblr.com', 'vk.com', 'reddit.com', 'mastodonshare.com',
]));

/**
 * True for a share link of the audited site: a link to a listed share or
 * messaging service (`SHARE_SERVICES`) whose query, decoded, names the site's
 * host as a whole name, with or without `www.`
 * (`facebook.com/sharer/sharer.php?u=https://acme.com/post`). Any other link
 * is not one, whatever its query holds.
 * @param {string} url  The link's normalized URL.
 * @param {string} host  `hostKey` of the URL.
 * @param {string} siteKey  `hostKey` of the audited site.
 * @returns {boolean}
 */
export function isShareLink(url, host, siteKey) {
  if (!SHARE_SERVICES.has(host.replace(/:\d+$/, ''))) return false;
  const query = url.indexOf('?');
  if (query < 0) return false;
  let decoded = url.slice(query + 1);
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Matched as it is.
  }
  const siteName = siteKey.replace(/:\d+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9.-])(?:www\\.)?${siteName}(?:[^a-z0-9.-]|$)`).test(decoded.toLowerCase());
}
