// Questions the ai checks share: the crawlers they look at, the site's stated
// AI policy, the directives a page gives Google and Bing, and which CDN
// answered. Pure.

/** @import { AiBot } from '../../util/ai-bots.js' */
/** @import { AiPolicy, CheckContext, PageRecord } from '../../types.js' */

import { AI_BOTS_VERIFIED, verifiedBots } from '../../util/ai-bots.js';

/** The date every rule of this module was read against its documentation. */
export const VERIFIED = '2026-11-14';

/** Fields that are the same for every ai check. */
export const AI = Object.freeze({
  module: /** @type {const} */ ('ai'),
  engine: /** @type {const} */ ('code'),
  last_verified: VERIFIED,
});

/** Official documentation the rules are based on (CHECKS-SPEC, reference list). */
export const DOCS = Object.freeze({
  OPENAI_BOTS: 'https://developers.openai.com/api/docs/bots',
  ANTHROPIC_BOTS: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler',
  APPLEBOT: 'https://support.apple.com/en-us/119829',
  BING_AI_PREFS: 'https://blogs.bing.com/search/2026/10/your-content-your-choice-clearer-preferences-for-training-and-grounding/',
  BING_GUIDELINES: 'https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a',
  BING_DATA_NOSNIPPET: 'https://blogs.bing.com/webmaster/2025/10/Bing-Introduces-Support-for-the-data-nosnippet-HTML-Attribute/',
  KELLEY_00: 'https://datatracker.ietf.org/doc/html/draft-kelley-aipref-training-preference-signal-00',
  AIPREF_ATTACH: 'https://datatracker.ietf.org/doc/html/draft-ietf-aipref-attach-05',
  CF_CONTENT_SIGNALS: 'https://developers.cloudflare.com/bots/additional-configurations/managed-robots-txt/',
  CF_MIXED_USE: 'https://blog.cloudflare.com/accountable-mixed-use-ai-crawlers/',
  GOOGLE_AI_FEATURES: 'https://developers.google.com/search/docs/appearance/ai-features',
  GOOGLE_AI_OPT: 'https://developers.google.com/search/docs/fundamentals/ai-optimization-guide',
  GOOGLE_ROBOTS_META: 'https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag',
  GOOGLE_AI_TRAINING_BLOG: 'https://developers.google.com/search/blog/2026/10/ai-training-control',
  LLMSTXT: 'https://llmstxt.org/',
});

/** The words of a recommendation when the site's intent is not known: a block may be on purpose. */
export const CHECK_INTENT = 'If the block is on purpose, record that with /seekwide:setup (AI policy), and Seekwide stops reporting it.';

/**
 * The site's stated AI policy, or null when the profile states none or speaks for another site.
 * @param {CheckContext} ctx
 * @returns {AiPolicy|null}
 */
export const policyOf = (ctx) => ctx.aiPolicy ?? null;

/**
 * Whether a block of AI search is what the site wants: only under `block_all`.
 * @param {CheckContext} ctx
 * @returns {boolean}
 */
export const searchBlockIntended = (ctx) => policyOf(ctx) === 'block_all';

/**
 * The counted AI search crawlers whose vendor page was read at the last check.
 * @returns {AiBot[]}
 */
export const countedBots = () => verifiedBots((bot) => bot.counted);

/**
 * What a finding says about a bot's data: its vendor page and the day it was read.
 * @param {AiBot} bot
 * @returns {{source: string, last_verified: string}}
 */
export const sourceOf = (bot) => ({ source: bot.source, last_verified: bot.last_verified });

/** The date of the bot data, for evidence. */
export const BOTS_VERIFIED = AI_BOTS_VERIFIED;

/** The sentence every access finding carries: what robots.txt shows and what it cannot. */
export const ROBOTS_ONLY =
  'Read from robots.txt with the crawler\'s own token (RFC 9309). A CDN or firewall can still treat the real crawler differently; Seekwide never pretends to be it, so that is not tested.';

/**
 * The start page's URL as the crawl recorded it, or the start URL.
 * @param {CheckContext} ctx
 * @returns {string}
 */
export const startUrlOf = (ctx) => ctx.resolve(ctx.site.start_url)?.url ?? ctx.site.start_url;

/**
 * The Google directives of a page that say it may not be shown with a snippet
 * (`nosnippet`, `max-snippet:0`), from the robots and googlebot meta tags and the X-Robots-Tag header.
 * @param {PageRecord} page
 * @returns {string[]}  The directives found, as written.
 */
export function noSnippetDirectives(page) {
  return [...page.meta_robots, ...page.x_robots].filter((token) => token === 'nosnippet' || maxSnippet(token) === 0);
}

/**
 * The number of a `max-snippet:n` directive, or null for any other token.
 * @param {string} token
 * @returns {number|null}
 */
export function maxSnippet(token) {
  const match = /^max-snippet\s*:\s*(-?\d{1,9})$/.exec(token);
  return match ? Number(match[1]) : null;
}

/**
 * The page's Bing AI directives (`ai-training:…`, `ai-grounding:…`) from its record.
 * @param {PageRecord} page
 * @returns {{training: string|null, grounding: string|null}}
 */
export function bingAiDirectives(page) {
  /** @type {{training: string|null, grounding: string|null}} */
  const found = { training: null, grounding: null };
  for (const token of page.ai?.bingbot ?? []) {
    const match = /^ai-(training|grounding)\s*:\s*([a-z]+)$/.exec(token);
    if (match && found[/** @type {'training'|'grounding'} */ (match[1])] === null) found[/** @type {'training'|'grounding'} */ (match[1])] = match[2];
  }
  return found;
}

/**
 * The CDN or host that answered, named from response headers it adds
 * (observed, not documented by the vendors), or null.
 * @param {Record<string, string>} headers
 * @returns {string|null}
 */
export function cdnOf(headers) {
  const server = (headers.server ?? '').toLowerCase();
  const via = (headers.via ?? '').toLowerCase();
  if (headers['cf-ray'] !== undefined || headers['cf-mitigated'] !== undefined || server === 'cloudflare') return 'Cloudflare';
  if (headers['x-vercel-id'] !== undefined || server === 'vercel') return 'Vercel';
  if (headers['x-amz-cf-id'] !== undefined || via.includes('cloudfront')) return 'Amazon CloudFront';
  if (headers['akamai-grn'] !== undefined || server.startsWith('akamaighost')) return 'Akamai';
  if (headers['x-nf-request-id'] !== undefined || server === 'netlify') return 'Netlify';
  if ((headers['x-served-by'] ?? '').startsWith('cache-')) return 'Fastly';
  return null;
}
