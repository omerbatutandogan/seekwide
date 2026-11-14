// Questions the smo checks share (social sharing previews). Pure.

/** @import { CheckContext, PageRecord, SocialRecord } from '../../types.js' */

import { normalizeUrl } from '../../util/url.js';

/** The date every rule of this module was read against its documentation. */
export const VERIFIED = '2026-11-13';

/** Fields that are the same for every smo check. */
export const SMO = Object.freeze({
  module: /** @type {const} */ ('smo'),
  engine: /** @type {const} */ ('code'),
  last_verified: VERIFIED,
});

/** Official documentation the rules are based on (CHECKS-SPEC, reference list). */
export const DOCS = Object.freeze({
  OPEN_GRAPH: 'https://ogp.me/',
  FB_IMAGES: 'https://developers.facebook.com/documentation/sharing/webmasters/images',
  META_CRAWLERS: 'https://developers.facebook.com/documentation/sharing/webmasters/web-crawlers',
  WHATSAPP_PREVIEWS: 'https://developers.facebook.com/documentation/business-messaging/whatsapp/link-previews/',
  LINKEDIN_SHARE: 'https://www.linkedin.com/help/linkedin/answer/a521928',
  // X's card pages now redirect to an overview without them; this is X's own page as the Internet Archive kept it.
  X_CARDS: 'https://web.archive.org/web/20250530130917/https://developer.x.com/en/docs/x-for-websites/cards/overview/markup',
  GOOGLE_ORG: 'https://developers.google.com/search/docs/appearance/structured-data/organization',
  MASTODON_VERIFY: 'https://docs.joinmastodon.org/user/profile/',
  HTTP_STATUS: 'https://developers.google.com/crawling/docs/troubleshooting/http-status-codes',
});

const KIB = 1024;
/** WhatsApp: the head within the first 300 KB, the image under 600 KB. Read as KiB, the larger reading. */
export const HEAD_LIMIT_BYTES = 300 * KIB;
export const IMAGE_LIMIT_BYTES = 600 * KIB;
/** Meta: Open Graph properties before the first 1 MB; images of at most 8 MB. LinkedIn: images of at most 5 MB. */
export const FACEBOOK_HEAD_BYTES = 1024 * KIB;
export const FACEBOOK_IMAGE_BYTES = 8 * 1024 * KIB;
export const LINKEDIN_IMAGE_BYTES = 5 * 1024 * KIB;

/** @param {unknown} value @returns {value is string} A string with something other than spaces. */
export const filled = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * @typedef {PageRecord & {social: SocialRecord}} SocialPage
 */

/**
 * True when the record carries what this version reads about meta tag places.
 * Records made before rule set 0.1.9 do not, and are not units of the checks
 * that need it.
 * @param {PageRecord} page
 * @returns {page is SocialPage}
 */
export function hasSocial(page) {
  return typeof page.social === 'object' && page.social !== null;
}

/**
 * The image a page gives for its sharing preview: `og:image` (also given by
 * `og:image:url` or `og:image:secure_url`), else `twitter:image`, with the
 * property it came from and the URL it names, resolved against the page;
 * null when the page gives neither.
 * @param {PageRecord} page
 * @returns {{property: 'og:image'|'twitter:image', value: string, url: string|null}|null}
 */
export function sharingImage(page) {
  const og = page.og.image;
  const twitter = page.twitter.image;
  const [property, value] = filled(og) ? ['og:image', og] : filled(twitter) ? ['twitter:image', twitter] : [null, null];
  if (property === null || value === null) return null;
  return { property: /** @type {'og:image'|'twitter:image'} */ (property), value: value.trim(), url: normalizeUrl(value.trim(), page.url) };
}

/**
 * The width and height a page declares for its sharing image with
 * `og:image:width` and `og:image:height`, when both are whole numbers of 1
 * or more; null otherwise. Only an `og:image` has them.
 * @param {PageRecord} page
 * @returns {{width: number, height: number}|null}
 */
export function declaredSize(page) {
  const parse = (/** @type {string|undefined} */ value) => (value !== undefined && /^\s*\d{1,6}\s*$/.test(value) ? Number(value) : 0);
  const width = parse(page.og['image:width']);
  const height = parse(page.og['image:height']);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Compare two strings by code unit, the order selectors and URLs sort in.
 * @param {string} a @param {string} b
 */
export const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The indexable pages, which is where a sharing preview matters.
 * @param {CheckContext} ctx
 */
export const sharedPages = (ctx) => ctx.indexablePages;
