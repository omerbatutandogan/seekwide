// What audit_run collects for the ai module before the checks run: the AI
// policy the site profile states, and the site's /llms.txt (one request after
// robots.txt). Also what the run records and what the notes say.

/** @import { AiPolicy, AiSummary, CrawlResult, LlmsTxtResult, Profile } from '../types.js' */
/** @import { ToolDeps } from './index.js' */

import { LIMITS } from '../config.js';
import { log } from '../log.js';
import { AI_BOTS, AI_BOTS_VERIFIED, verifiedBots } from '../util/ai-bots.js';
import { profileSite } from '../util/profile-site.js';
import { crawlIdentity } from '../util/site-identity.js';
import { originOf } from '../util/url.js';
import { robotsKnown } from '../crawl/ai-robots.js';
import { aiAccessNotJudged } from '../util/ai-summary.js';

export const LLMS_NOT_ASKED = '/llms.txt was not requested (check_llms_txt was false), so the check that reads it was skipped.';
export const LLMS_FAILED = '/llms.txt could not be read because of an internal error. The rest of the audit is not affected.';
export const LLMS_REFUSED = '/llms.txt was not requested: the site refused the crawler (a bot challenge or rate limiting), so nothing more was requested from it.';
export const POLICY_UNREADABLE = 'The site profile could not be read, so no AI policy was used: blocks of AI crawlers are reported as things to check against your intent.';
export const POLICY_OTHER_SITE = "The site profile states an AI policy, but its site_url is not this site, so the policy was not used. To use it, set this site's address as site_url with /seekwide:setup in this site's folder.";
export const POLICY_NO_SITE_URL = 'The site profile states an AI policy but no site_url, so it was not used. Set site_url with /seekwide:setup.';

const REFUSALS = new Set(['bot_challenge', 'rate_limited']);

/** audit_run's argument for the ai module. */
export const AI_ARGUMENTS = Object.freeze({
  check_llms_txt: {
    type: 'boolean',
    default: true,
    description: 'With the ai module, request the site\'s /llms.txt once, after its robots.txt. Information only: it changes no count or score.',
  },
});

/**
 * @typedef {Object} AiCollected
 * @property {LlmsTxtResult|null} llms
 * @property {string|undefined} reason   Why /llms.txt was not read, when it was not.
 * @property {AiPolicy|null} policy      The stated policy, when the profile speaks for this site.
 * @property {string|null} policyNote    Why a stated policy was not used.
 */

/**
 * The profile's AI policy, used only when its `site_url` is the audited
 * site's own host (`profileSite`: with or without `www.`, on the same port):
 * robots.txt is per host, so a policy for www.acme.com says nothing about
 * shop.acme.com.
 * @param {Profile|null} profile
 * @param {CrawlResult} crawl
 * @returns {{policy: AiPolicy|null, note: string|null}}
 */
export function policyFor(profile, crawl) {
  const stated = profile?.ai_policy ?? null;
  if (stated === null) return { policy: null, note: null };
  const match = profileSite(profile?.site_url, crawl);
  if (match === 'no_site_url') return { policy: null, note: POLICY_NO_SITE_URL };
  return match === 'site' ? { policy: stated, note: null } : { policy: null, note: POLICY_OTHER_SITE };
}

/**
 * Read the profile's AI policy and the site's /llms.txt for the ai module.
 * Never throws but when the audit was cancelled. For a site on this machine
 * the file is asked of that origin only, through loopback for exactly that
 * origin; the deployed site is never contacted.
 * @param {ToolDeps} deps
 * @param {CrawlResult} crawl
 * @param {string} projectDir
 * @param {{requested: boolean, check: boolean, signal?: AbortSignal}} options
 * @returns {Promise<AiCollected>}
 */
export async function collectAi(deps, crawl, projectDir, { requested, check, signal }) {
  if (!requested) return { llms: null, reason: undefined, policy: null, policyNote: null };
  const identity = crawlIdentity(crawl);
  /** @type {AiPolicy|null} */
  let policy = null;
  /** @type {string|null} */
  let policyNote = null;
  try {
    ({ policy, note: policyNote } = policyFor(await deps.readProfile(projectDir), crawl));
  } catch {
    policyNote = POLICY_UNREADABLE;
  }
  if (!check) return { llms: null, reason: LLMS_NOT_ASKED, policy, policyNote };
  const refused = (crawl.blocked !== null && REFUSALS.has(crawl.blocked.reason)) || crawl.pages.some((page) => REFUSALS.has(page.fetch_error ?? ''));
  if (refused) return { llms: null, reason: LLMS_REFUSED, policy, policyNote };
  const local = crawl.options.local !== false;
  const origin = /** @type {string} */ (originOf(crawl.site_origin));
  const rate = crawl.options.rate_per_sec;
  try {
    const llms = await deps.fetchLlmsTxt(crawl.site_origin, {
      perHostDelayMs: Number.isFinite(rate) && rate > 0 ? 1000 / rate : 1000 / LIMITS.ratePerSecDefault,
      // A redirect is followed only where the crawl itself would go; for a local site, only on its own origin.
      sameSite: local ? (url) => originOf(url) === origin : (url) => identity.isInternal(url),
      ...(local ? { fetchOptions: { allowLoopback: origin } } : {}),
      startUrl: crawl.pages[0]?.final_url ?? null,
      ...(signal ? { signal } : {}),
    });
    return { llms, reason: undefined, policy, policyNote };
  } catch (error) {
    if (signal?.aborted) throw error;
    log.error('llms.txt read failed', { message: error instanceof Error ? error.message : String(error) });
    return { llms: null, reason: LLMS_FAILED, policy, policyNote };
  }
}

/**
 * What the run records about the ai module, or null when it did not run.
 * Holds no text from the site: tokens from the data file, booleans, statuses and the file's address.
 * @param {CrawlResult} crawl
 * @param {AiCollected} collected
 * @param {boolean} requested
 * @returns {AiSummary|null}
 */
export function aiSummary(crawl, collected, requested) {
  if (!requested) return null;
  const ai = crawl.ai_robots ?? null;
  // Without ai_robots nobody read robots.txt for AI crawlers: the preference is unknown, never "none".
  const training = ai === null ? 'unknown' : ai.policy.group === 'none' ? 'none' : ai.policy.group === 'empty' ? 'empty' : ai.policy.allowed === false ? 'disallow' : 'allow';
  const refused = ai === null && crawl.pages.length > 0 && !robotsKnown(crawl.robots) && crawl.robots.status === 'missing';
  return {
    bots_verified: AI_BOTS_VERIFIED,
    policy: collected.policy,
    robots: ai === null ? null : ai.status,
    ...(refused ? { robots_refused: crawl.robots.http_status } : {}),
    ...(ai === null && typeof crawl.ai_robots_error === 'string' ? { robots_error: /** @type {const} */ (true) } : {}),
    agents: ai === null ? [] : AI_BOTS.filter((bot) => bot.role !== 'policy' && ai.agents[bot.token] !== undefined)
      .map((bot) => ({ token: bot.token, allowed: ai.agents[bot.token].allowed })),
    training_preference: training,
    preference_lines: ai?.preference_lines ?? 0,
    llms_txt: collected.llms === null ? null : { url: collected.llms.url, outcome: collected.llms.outcome, status: collected.llms.status },
  };
}

/**
 * How many of the counted AI search crawlers robots.txt lets read the start page, or null when it was not asked.
 * @param {AiSummary|null} summary
 * @returns {{passed: number, of: number}|null}
 */
export function searchCrawlerCount(summary) {
  if (summary === null || summary.robots === null) return null;
  const counted = new Set(verifiedBots((bot) => bot.counted).map((bot) => bot.token));
  const agents = summary.agents.filter((agent) => counted.has(agent.token));
  return agents.length === 0 ? null : { passed: agents.filter((agent) => agent.allowed).length, of: agents.length };
}

const LLMS_WORDS = /** @type {Record<string, string>} */ ({
  found: 'served',
  not_found: 'not found',
  unverifiable: 'could not be verified',
  disallowed: 'not requested (robots.txt)',
});

/**
 * What audit_run's notes say about the ai module.
 * @param {AiSummary|null} summary
 * @param {AiCollected} collected
 * @returns {string[]}
 */
export function aiNotes(summary, collected) {
  if (summary === null) return [];
  const notes = collected.policyNote === null ? [] : [collected.policyNote];
  // Refused, failed or not recorded: said in the notes as in the report, so a count is never read as complete.
  const notJudged = aiAccessNotJudged(summary);
  if (notJudged !== null) notes.push(`${notJudged} The checks that read it were skipped.${summary.robots_refused === undefined ? '' : ' The real crawlers may get the file.'}`);
  const count = searchCrawlerCount(summary);
  if (count !== null) {
    notes.push(`AI search crawlers: robots.txt lets ${count.passed} of ${count.of} read the start page (crawler data verified ${summary.bots_verified}). ` +
      'This is what robots.txt says; a CDN or firewall can treat the real crawlers differently, which is not tested.');
  }
  // A site without /llms.txt needs no note; the report says it.
  if (collected.llms !== null && collected.llms.outcome !== 'not_found') {
    const words = Object.hasOwn(LLMS_WORDS, collected.llms.outcome) ? LLMS_WORDS[collected.llms.outcome] : collected.llms.outcome;
    notes.push(`/llms.txt: ${words}. Information only: Google Search ignores it, and it changes no count.`);
  } else if (collected.llms === null && collected.reason) {
    notes.push(collected.reason);
  }
  return notes;
}
