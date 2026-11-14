// What the site's robots.txt, as read during the crawl, tells the AI crawlers
// of server/data/ai-bots.json (ai module). Nothing is requested for it: the
// crawl has the file anyway. Pure apart from asking the loaded robots.txt.

/** @import { AiRobots, PageRecord } from '../types.js' */
/** @import { loadRobots } from '../net/robots.js' */

import { readContentSignal, readContentUsage } from '../net/ai-prefs.js';
import { AI_BOTS, POLICY_TOKEN, agentChain } from '../util/ai-bots.js';
import { clip } from '../util/strings.js';
import { originOf } from '../util/url.js';

/** Pages whose access is asked for each counted AI search crawler: each question costs a pass over a group's rules. */
export const MAX_AI_PAGES = 200;
/** Pages listed per crawler. */
const MAX_LISTED = 200;
/** Characters of a preference value kept for the evidence. */
const VALUE_CHARS = 200;
/** Recorded as `CrawlResult.ai_robots_error` when reading robots.txt for AI crawlers threw; the crawl itself is not affected. */
export const AI_ROBOTS_FAILED = 'What robots.txt tells AI crawlers could not be worked out because of an internal error. The rest of the crawl is not affected.';

/**
 * Why a crawl has no `ai_robots`, in words for a skipped check, or null when it has one.
 * @param {import('../types.js').CrawlResult} crawl
 * @returns {string|null}
 */
export function aiRobotsReason(crawl) {
  if (crawl.ai_robots) return null;
  if (typeof crawl.ai_robots_error === 'string') return AI_ROBOTS_FAILED;
  if (crawl.robots.status === 'unreachable') return 'Needs what robots.txt tells AI crawlers. robots.txt could not be read.';
  if (!robotsKnown(crawl.robots)) {
    return `Needs what robots.txt tells AI crawlers. robots.txt answered HTTP ${crawl.robots.http_status} to Seekwide's crawler instead of the file, so it is not known; the real crawlers may get the file.`;
  }
  if (crawl.pages.length === 0) return 'Needs what robots.txt tells AI crawlers. No page of the site was recorded.';
  return 'Needs what robots.txt tells AI crawlers. This crawl did not record it (crawls made before rule set 0.2.0 do not). Crawl the site again.';
}

/** The answers that say a site has no robots.txt. Any other 4xx, or too many redirects, may be a refusal of this crawler. */
const ABSENT = new Set([404, 410]);

/**
 * Whether the crawl knows what robots.txt says to other crawlers: the file was
 * read, or the site said it has none (404 or 410). A robots.txt that answered
 * another 4xx (401, 403, 418…) or redirected too often counts as absent for
 * the crawler itself (RFC 9309), but such an answer can be a refusal of this
 * crawler alone, while a real AI crawler gets the file.
 * @param {{status: string, http_status: number}} summary
 * @returns {boolean}
 */
export function robotsKnown(summary) {
  return summary.status === 'ok' || (summary.status === 'missing' && ABSENT.has(summary.http_status));
}

/**
 * What robots.txt says about every AI crawler of the data file at the start
 * page's final URL, and about the counted search crawlers on the first
 * `MAX_AI_PAGES` html pages of the site's origin.
 *
 * Guarantees: `agents` has an entry for every row but the shared preference
 * token, with `allowed` from `allowsAgents` (the bot's own group, then its
 * fallbacks, then `*`; RFC 9309) and the group that decided it. `policy` reads
 * the `__usage_ai-training` group alone: a `User-agent: *` group never stands
 * for it (draft-kelley-aipref-training-preference-signal-00). `blocked_pages`
 * lists, for each counted crawler that may read the start page, the pages
 * among those asked that it may not read (sorted, at most 200). The
 * `Content-Usage` and `Content-Signal` values are read with `net/ai-prefs.js`
 * and kept clipped. Null when no start page was recorded, the start page is
 * on another origin than the file, or robots.txt answered something that may
 * be a refusal of this crawler (`robotsKnown`).
 * @param {Awaited<ReturnType<typeof loadRobots>>} robots  The robots.txt of `origin`.
 * @param {string} origin
 * @param {PageRecord[]} pages  The crawl's records, in crawl order.
 * @returns {AiRobots|null}
 */
export function aiRobots(robots, origin, pages) {
  const start = pages[0]?.final_url;
  if (start === undefined || originOf(start) !== origin || !robotsKnown(robots.summary)) return null;
  /** @type {AiRobots['agents']} */
  const agents = {};
  for (const bot of AI_BOTS) {
    if (bot.role === 'policy') continue;
    const chain = agentChain(bot);
    agents[bot.token] = { allowed: robots.allowsAgents(start, chain), group: robots.agentGroup(chain) };
  }
  const policy = robots.preference(POLICY_TOKEN);
  const asked = pages.filter((page) => page.status === 200 && page.is_html && originOf(page.url) === origin).slice(0, MAX_AI_PAGES);
  /** @type {Record<string, string[]>} */
  const blockedPages = {};
  for (const bot of AI_BOTS) {
    if (!bot.counted || !agents[bot.token]?.allowed) continue;
    const chain = agentChain(bot);
    const blocked = asked.filter((page) => !robots.allowsAgents(page.url, chain)).map((page) => page.url).sort().slice(0, MAX_LISTED);
    if (blocked.length > 0) blockedPages[bot.token] = blocked;
  }
  const { preferences } = robots;
  return {
    url: start,
    status: robots.summary.status,
    agents,
    policy: { group: policy.group, allowed: policy.allows(start) },
    pages_asked: asked.length,
    blocked_pages: blockedPages,
    content_usage: preferences.content_usage.map((value) => {
      const read = readContentUsage(value);
      return { value: clip(value, VALUE_CHARS), valid: read.valid, problem: read.problem, values: read.values };
    }),
    content_signal: preferences.content_signal.map((value) => {
      const read = readContentSignal(value);
      return { value: clip(value, VALUE_CHARS), valid: read.valid, problem: read.problem, values: read.values };
    }),
    preference_lines: preferences.lines,
  };
}
