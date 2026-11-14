// Which AI crawlers the site's robots.txt lets in (ai module), read from
// `crawl.ai_robots`, which the crawl worked out from the file it had anyway,
// and whether Seekwide's own crawler was refused. Nothing here says what a
// real AI crawler gets: Seekwide never pretends to be one. Pure.

/** @import { CheckContext, CheckDef, CheckResult } from '../../types.js' */
/** @import { AiBot } from '../../util/ai-bots.js' */

import { isUnverifiable } from '../page-helpers.js';
import { verifiedBots } from '../../util/ai-bots.js';
import {
  AI, BOTS_VERIFIED, CHECK_INTENT, DOCS, ROBOTS_ONLY, cdnOf, countedBots, policyOf, searchBlockIntended, sourceOf, startUrlOf,
} from './helpers.js';

/**
 * Whether robots.txt lets a bot read the start page, or null when the crawl did not ask.
 * @param {CheckContext} ctx
 * @param {AiBot} bot
 * @returns {boolean|null}
 */
const allowed = (ctx, bot) => ctx.crawl.ai_robots?.agents[bot.token]?.allowed ?? null;

/**
 * The evidence of a crawler that robots.txt keeps out of the start page.
 * @param {CheckContext} ctx
 * @param {AiBot} bot
 * @returns {Record<string, unknown>}
 */
function blockedEvidence(ctx, bot) {
  const agents = /** @type {NonNullable<CheckContext['crawl']['ai_robots']>} */ (ctx.crawl.ai_robots).agents;
  return {
    crawler: bot.token, vendor: bot.vendor, product: bot.product, allowed: false,
    group: agents[bot.token]?.group ?? 'none', robots_txt: ctx.crawl.robots.url, ...sourceOf(bot), bot_data_verified: BOTS_VERIFIED,
  };
}

/** @type {CheckDef} */
const searchBotBlocked = {
  ...AI,
  id: 'ai.access.search_bot_blocked',
  title: 'robots.txt keeps an AI search crawler out',
  description:
    'Asks the site\'s robots.txt, as read during the crawl, whether each AI search crawler whose vendor documents what a block does may fetch the start page: OAI-SearchBot (ChatGPT search), Claude-SearchBot, PerplexityBot, Bingbot (Bing and Copilot), Applebot (which follows the Googlebot rules when robots.txt does not name it) and DuckAssistBot. Each is matched with its own token as RFC 9309 says. A block can be on purpose: when the site profile states that the site blocks AI crawlers, these are not units. What a CDN or firewall does to the real crawler is not tested.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 1,
  confidence: 'likely',
  scope: 'site',
  requires: ['ai_robots'],
  doc_ref: DOCS.OPENAI_BOTS,
  recommendation: `Check whether the block is what you want. To let the crawler in, remove the rule that disallows it, or add a group with its token and "Allow: /". ${CHECK_INTENT}`,
  run(ctx) {
    if (!ctx.crawl.ai_robots || searchBlockIntended(ctx)) return [];
    const url = startUrlOf(ctx);
    return countedBots().flatMap((bot) => {
      const access = allowed(ctx, bot);
      if (access === null) return [];
      if (access) return [/** @type {CheckResult} */ ({ status: 'pass', url, selector: bot.token })];
      return [{
        status: 'fail', url, selector: bot.token,
        evidence: {
          observed: blockedEvidence(ctx, bot),
          expected: `robots.txt lets ${bot.token} fetch the start page, unless keeping it out is intended`,
          detail: `${bot.vendor}: ${bot.says}`,
          limit: ROBOTS_ONLY,
        },
      }];
    });
  },
};

/** @type {CheckDef} */
const searchBotPartial = {
  ...AI,
  id: 'ai.access.search_bot_partial',
  title: 'robots.txt keeps an AI search crawler out of some pages',
  description:
    'For each indexable page among the first 200 html pages of the crawl, asks robots.txt whether the AI search crawlers that may read the start page may also read that page. A page one of them may not read is left out of that vendor\'s AI answers, while the rest of the site is not. Not a unit when the site profile states that the site blocks AI crawlers.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: ['ai_robots'],
  doc_ref: DOCS.OPENAI_BOTS,
  recommendation: `Check the rules that disallow these pages for the named crawlers; remove them if the pages should appear in AI answers. ${CHECK_INTENT}`,
  run(ctx) {
    const ai = ctx.crawl.ai_robots;
    if (!ai || searchBlockIntended(ctx)) return [];
    const counted = new Set(countedBots().map((bot) => bot.token));
    /** @type {Map<string, string[]>} */
    const byPage = new Map();
    for (const [token, urls] of Object.entries(ai.blocked_pages)) {
      if (!counted.has(token)) continue;
      for (const url of urls) byPage.set(url, [...(byPage.get(url) ?? []), token]);
    }
    // The pages the crawl asked about: the first html pages of the site's origin (crawl/ai-robots.js).
    const asked = new Set(ctx.htmlPages.filter((page) => page.url.startsWith(`${ctx.site.origin}/`)).slice(0, ai.pages_asked).map((page) => page.url));
    return ctx.indexablePages.filter((page) => asked.has(page.url)).map((page) => {
      const tokens = (byPage.get(page.url) ?? []).sort();
      if (tokens.length === 0) return /** @type {CheckResult} */ ({ status: 'pass', url: page.url });
      return {
        status: 'fail', url: page.url,
        evidence: {
          observed: { crawlers: tokens, robots_txt: ctx.crawl.robots.url, bot_data_verified: BOTS_VERIFIED },
          expected: 'The AI search crawlers that may read the start page may read this page too, unless keeping them out is intended',
          limit: ROBOTS_ONLY,
        },
      };
    });
  },
};

/** @type {CheckDef} */
const userFetcherBlocked = {
  ...AI,
  id: 'ai.access.user_fetcher_blocked',
  title: 'robots.txt names an AI fetcher that acts for a user',
  description:
    'Lists each fetcher that an AI product sends when a person asks it to open a page (ChatGPT-User, Claude-User, Perplexity-User, MistralAI-User, Google-Agent, meta-externalfetcher, Amzn-User) whose robots.txt group disallows the start page. Information only: Anthropic and Mistral say robots.txt controls theirs, while OpenAI, Perplexity, Google, Meta and Amazon say theirs may not follow it. Not a unit when the site profile states that the site blocks AI crawlers.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'site',
  requires: ['ai_robots'],
  doc_ref: DOCS.ANTHROPIC_BOTS,
  recommendation: 'Check that blocking these fetchers is intended: a person who asks an AI assistant about the page then gets no answer from it. Where the vendor says the fetcher may not follow robots.txt, the rule alone does not keep it out.',
  run(ctx) {
    if (!ctx.crawl.ai_robots || searchBlockIntended(ctx)) return [];
    const url = startUrlOf(ctx);
    return verifiedBots((bot) => bot.role === 'user').filter((bot) => allowed(ctx, bot) === false).map((bot) => ({
      status: /** @type {const} */ ('fail'), url, selector: bot.token,
      evidence: {
        observed: { ...blockedEvidence(ctx, bot), robots_binding: bot.robots },
        expected: 'Information only',
        detail: `${bot.vendor}: ${bot.says}`,
        limit: ROBOTS_ONLY,
      },
    }));
  },
};

/** @type {CheckDef} */
const blockedForTraining = {
  ...AI,
  id: 'ai.robots.search_crawler_blocked_for_training',
  title: 'A search crawler is blocked where a training-only control exists',
  description:
    'For Applebot and Bingbot, whose index serves search as well as AI features, checks whether robots.txt keeps them out of the start page without naming the control that refuses training only: Applebot-Extended for Apple, and for Bing the shared __usage_ai-training group (read from 2027-02-01) or Bing\'s ai-training directive on the pages. Blocking the crawler also removes the site from Siri and Spotlight, or from Bing and Copilot. A unit only when the site profile states no policy or states that it allows AI search.',
  severity: 'medium',
  weight: 3,
  impact: 3,
  effort: 1,
  confidence: 'likely',
  scope: 'site',
  requires: ['ai_robots'],
  doc_ref: DOCS.APPLEBOT,
  recommendation: 'If the aim is to keep content out of AI training, allow the crawler again and use its training-only control instead (a "User-agent: Applebot-Extended" group with "Disallow: /"; for Bing a "User-Agent: __usage_ai-training" group with "Disallow: /").',
  run(ctx) {
    const ai = ctx.crawl.ai_robots;
    const policy = policyOf(ctx);
    if (!ai || (policy !== null && policy !== 'allow_search')) return [];
    const url = startUrlOf(ctx);
    const bingTraining = ai.policy.group === 'rules' || ctx.htmlPages.some((page) => (page.ai?.bingbot ?? []).some((token) => token.startsWith('ai-training')));
    return verifiedBots((bot) => bot.role === 'mixed' && bot.counted && allowed(ctx, bot) === false).map((bot) => {
      const named = bot.token === 'Applebot' ? ['own', 'named'].includes(ai.agents['Applebot-Extended']?.group ?? '') : bingTraining;
      if (named) return /** @type {CheckResult} */ ({ status: 'pass', url, selector: bot.token });
      return {
        status: 'fail', url, selector: bot.token,
        evidence: {
          observed: { ...blockedEvidence(ctx, bot), training_control_named: false },
          expected: `If only training is to be refused: ${bot.training_control ?? ''}`,
          detail: `${bot.vendor}: ${bot.says}`,
          limit: ROBOTS_ONLY,
        },
      };
    });
  },
};

/** @type {CheckDef} */
const selfRefused = {
  ...AI,
  id: 'ai.access.self_refused',
  title: 'The site\'s firewall or CDN refused Seekwide\'s crawler',
  description:
    'Says when the start page answered Seekwide\'s own crawler, which names itself and is allowed by robots.txt, with a bot challenge or with rate limiting, and names the CDN from the response headers. A site that refuses an unknown crawler may refuse AI crawlers too; whether it does is not tested, because Seekwide never pretends to be one. On Cloudflare, "Block" for AI crawlers also blocks Googlebot, Bingbot and Applebot since 2026-09-15.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'site',
  requires: ['live_site'],
  doc_ref: DOCS.CF_MIXED_USE,
  recommendation: 'Check the bot settings of the CDN or firewall: which crawlers it challenges or blocks, and on Cloudflare whether AI Crawl Control is set to Block (which also blocks search crawlers) or to Disallow AI Training. Your server logs show what the real AI crawlers get.',
  run(ctx) {
    const start = ctx.resolve(ctx.site.start_url) ?? ctx.pages[0];
    if (!start) return [];
    const url = start.url;
    if (!isUnverifiable(start) || start.fetch_error === 'robots_disallowed') return [{ status: 'pass', url }];
    const cdn = cdnOf(start.headers);
    return [{
      status: 'fail', url,
      evidence: {
        observed: { status: start.status, refusal: start.fetch_error, cdn },
        expected: 'The start page answers a crawler that names itself and obeys robots.txt',
        detail: `${cdn === 'Cloudflare' ? 'Cloudflare documents that, since 2026-09-15, Block and Block on pages with ads in its AI crawler settings also block Googlebot, Bingbot and Applebot; Disallow AI Training refuses training only. ' : ''}The CDN is named from headers it adds to its answers, not from a document. Whether real AI crawlers are refused is not tested.`,
      },
    }];
  },
};

/**
 * What a policy expects robots.txt to say to a crawler: allowed (true),
 * blocked (false), or nothing (null: the policy does not speak to it).
 * @param {AiBot} bot
 * @param {import('../../types.js').AiPolicy} policy
 * @returns {boolean|null}
 */
function expectation(bot, policy) {
  if (bot.role === 'training' || bot.role === 'control') return policy === 'allow_all';
  if (bot.role === 'search' && bot.counted && policy === 'block_all') return false;
  return null;
}

/** @type {CheckDef} */
const policyNotApplied = {
  ...AI,
  id: 'ai.policy.not_applied',
  title: 'robots.txt does not apply the AI policy the profile states',
  description:
    'When the site profile states an AI policy, compares it with robots.txt for each training crawler and training control token (GPTBot, ClaudeBot, CCBot, meta-externalagent, MistralAI-Training, Amazonbot, Google-Extended, Applebot-Extended), and under "block everything" for the AI search crawlers too. ClaudeBot counts as refused when robots.txt does not name it and the shared __usage_ai-training group disallows the start page, since Anthropic follows that preference. Information only: robots.txt is one way to state a policy, and a CDN can enforce one too.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'site',
  requires: ['ai_robots'],
  doc_ref: DOCS.KELLEY_00,
  recommendation: 'Add or change the robots.txt group of each named crawler so that it says what the policy says, or correct the AI policy with /seekwide:setup.',
  run(ctx) {
    const ai = ctx.crawl.ai_robots;
    const policy = policyOf(ctx);
    if (!ai || policy === null) return [];
    const url = startUrlOf(ctx);
    return verifiedBots().flatMap((bot) => {
      const expected = expectation(bot, policy);
      const access = allowed(ctx, bot);
      if (expected === null || access === null) return [];
      const sharedRefusal = bot.token === 'ClaudeBot' && ['star', 'none'].includes(ai.agents.ClaudeBot?.group ?? '') && ai.policy.allowed === false;
      const effective = sharedRefusal ? false : access;
      if (effective === expected) return [/** @type {CheckResult} */ ({ status: 'pass', url, selector: bot.token })];
      return [{
        status: 'fail', url, selector: bot.token,
        evidence: {
          observed: { crawler: bot.token, vendor: bot.vendor, role: bot.role, allowed: effective, policy, robots_txt: ctx.crawl.robots.url, ...sourceOf(bot) },
          expected: expected ? `${bot.token} may read the site, as the policy says` : `${bot.token} is refused, as the policy says`,
          detail: `${bot.vendor}: ${bot.says}`,
          limit: ROBOTS_ONLY,
        },
      }];
    });
  },
};

export const accessChecks = [searchBotBlocked, searchBotPartial, userFetcherBlocked, blockedForTraining, selfRefused, policyNotApplied];
