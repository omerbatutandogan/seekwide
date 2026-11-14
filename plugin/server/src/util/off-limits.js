// Hosts the plugin never sends a request to, whatever a page links to or
// shows: Google Play, and social platforms with their own short-link and image
// hosts (rule set 0.1.9). Seekwide does not scrape them; a link or image there
// is listed as not checked, by rule. Pure.

import { hasIcannSuffix, registrableDomain } from './public-suffix.js';

/**
 * Google Play: the store, its image host, its short links, and the Android
 * Market address that redirects to it.
 */
export const GOOGLE_PLAY_HOSTS = Object.freeze(['play.google.com', 'play-lh.googleusercontent.com', 'play.app.goo.gl', 'market.android.com']);

/**
 * Social platforms, with the short-link and image hosts they serve their pages
 * and pictures from. A host is on the list when it is one of these names or a
 * subdomain of one.
 */
export const SOCIAL_PLATFORM_DOMAINS = Object.freeze([
  // Meta: Facebook, Messenger, Instagram, Threads, WhatsApp.
  'facebook.com', 'fb.com', 'fb.me', 'fb.watch', 'fbcdn.net', 'facebook.net', 'messenger.com', 'm.me',
  'instagram.com', 'instagr.am', 'cdninstagram.com', 'threads.net', 'threads.com', 'whatsapp.com', 'whatsapp.net', 'wa.me',
  // X (Twitter).
  'twitter.com', 'x.com', 't.co', 'twimg.com',
  // LinkedIn.
  'linkedin.com', 'lnkd.in', 'licdn.com',
  // Pinterest (its country domains are matched by name below).
  'pin.it', 'pinimg.com',
  // TikTok.
  'tiktok.com', 'tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokv.com',
  // YouTube.
  'youtube.com', 'youtu.be', 'youtube-nocookie.com', 'ytimg.com',
  // Telegram.
  'telegram.org', 'telegram.me', 't.me', 'telegra.ph',
  // Discord.
  'discord.com', 'discord.gg', 'discordapp.com', 'discordapp.net', 'discord.media',
  // Others.
  'snapchat.com', 'reddit.com', 'redd.it', 'redditmedia.com', 'redditstatic.com', 'tumblr.com', 'vk.com', 'bsky.app',
]);

/** The reason a check gives for a URL, or a redirect step, on a host the plugin never contacts. */
export const NOT_REQUESTED = Object.freeze({
  google_play: 'Not requested: Seekwide never contacts Google Play',
  social_platform: 'Not requested: Seekwide never contacts social platforms',
});

/**
 * One sentence that a crawl gives for an address it will not request.
 * @param {'google_play'|'social_platform'} reason
 * @returns {string}
 */
export const neverContacted = (reason) => `${reason === 'google_play' ? 'it is on Google Play' : 'it is on a social platform'}, and Seekwide never sends a request to Google Play or to social platforms (Facebook, Instagram, X, LinkedIn, YouTube, TikTok and others), so it does not crawl them`;

/**
 * Platforms with a domain in many countries (pinterest.co.uk, youtube.de, instagram.de): matched by the name before
 * the ending, when that ending is a country or generic one of the Public Suffix List's ICANN section. Under a hosting
 * service's domain (pinterest.github.io, pinterest.vercel.app, pinterest.wordpress.com) the name is a customer's.
 */
const SOCIAL_NAMES_ANY_ENDING = new Set(['pinterest', 'youtube', 'instagram']);

/**
 * @param {string} host  Lower case, without trailing dots or port.
 * @param {readonly string[]} domains
 * @returns {string|null}  The entry of `domains` the host is, or is under.
 */
const under = (host, domains) => domains.find((domain) => host === domain || host.endsWith(`.${domain}`)) ?? null;

/**
 * Whether the plugin may request a URL, and if not, why and on which
 * platform's domain. Only http(s) URLs are judged; anything else gives null,
 * since nothing would request it anyway.
 * @param {string} url
 * @returns {{reason: 'google_play'|'social_platform', domain: string}|null}  `domain` is the entry of
 *   `GOOGLE_PLAY_HOSTS` or `SOCIAL_PLATFORM_DOMAINS` the host matched, or for a country domain its registered
 *   name (`pinterest.co.uk`): never the host as a page wrote it, so it is always a plain name.
 */
export function offLimitsMatch(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  // All trailing dots go: `play.google.com..` names the same host for a resolver that is lenient.
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (host === '') return null;
  const play = under(host, GOOGLE_PLAY_HOSTS);
  if (play !== null) return { reason: 'google_play', domain: play };
  const social = under(host, SOCIAL_PLATFORM_DOMAINS);
  if (social !== null) return { reason: 'social_platform', domain: social };
  const domain = registrableDomain(host);
  if (domain !== null && SOCIAL_NAMES_ANY_ENDING.has(domain.split('.', 1)[0]) && hasIcannSuffix(host)) return { reason: 'social_platform', domain };
  return null;
}

/**
 * Why the plugin never requests a URL, or null when it may (`offLimitsMatch`).
 * @param {string} url
 * @returns {'google_play'|'social_platform'|null}
 */
export function offLimitsReason(url) {
  return offLimitsMatch(url)?.reason ?? null;
}

/**
 * The platform domain of an off-limits URL, as reports name it ('' for any
 * other URL): `facebook.com` for https://a_b.facebook.com/x, never the host
 * the page wrote.
 * @param {string} url
 * @returns {string}
 */
export function offLimitsHost(url) {
  return offLimitsMatch(url)?.domain ?? '';
}
