// The report's AI search readiness layer and section (ai module): counts,
// never a score; what robots.txt tells each known AI crawler; the training
// preference; /llms.txt as information; and what an audit from outside cannot
// see. Built from the run alone, plus the plugin's own bot data for labels.

/** @import { AiSummary, Run } from '../types.js' */

import { AI_BOTS } from '../util/ai-bots.js';
import { aiAccessNotJudged } from '../util/ai-summary.js';

/** The ai module's checks whose units give the page counts of the section. */
const PAGE_COUNTS = Object.freeze([
  { id: 'ai.snippet.nosnippet', label: 'Indexable pages that may be shown with a snippet (and so in Google\'s AI features)' },
  { id: 'ai.content.script_only', label: 'Indexable pages whose content is in the HTML the server sends' },
]);

const ROLE_LABELS = /** @type {Record<string, string>} */ ({
  search: 'AI search', mixed: 'Search and AI features', training: 'Training', control: 'Training control (no crawler)', user: 'Fetches for a user',
});
const ROBOTS_LABELS = /** @type {Record<string, string>} */ ({
  obeys: 'Vendor says it follows robots.txt', documented: 'Vendor documents a robots.txt setting', may_ignore: 'Vendor says robots.txt may not apply', ignores: 'Vendor says it generally ignores robots.txt',
});
const POLICY_LABELS = /** @type {Record<string, string>} */ ({
  allow_all: 'Allow AI search and training',
  allow_search: 'Allow AI search, refuse training',
  block_all: 'Refuse AI crawlers, search and training',
});
const TRAINING_LABELS = /** @type {Record<string, string>} */ ({
  disallow: 'robots.txt states a shared no-training preference (User-Agent: __usage_ai-training, Disallow) for the start page. Anthropic honours it since 2026-10-30, Bing from 2027-02-01, and Google plans to in early 2027; a rule that names a vendor\'s own crawler wins over it for Anthropic and Google.',
  allow: 'robots.txt has a __usage_ai-training group that allows the start page: no shared training preference against it.',
  empty: 'robots.txt names __usage_ai-training without a rule, which states no preference.',
  none: 'robots.txt states no shared training preference (no __usage_ai-training group). Training is refused per vendor, if at all, through each training crawler\'s own group.',
  unknown: 'Not known: robots.txt was not read for AI crawlers in this run, so no training preference was judged.',
});
const LLMS_LABELS = /** @type {Record<string, string>} */ ({
  found: 'The site serves /llms.txt.',
  not_found: 'The site serves no /llms.txt.',
  unverifiable: '/llms.txt could not be verified (a refusal, an error or a redirect off the site).',
  disallowed: '/llms.txt was not requested: robots.txt does not allow the crawler to ask for it.',
});

/** Google's own statement on its AI features, quoted short, with what it requires. */
export const GOOGLE_STATEMENT = 'Google: "There are no additional requirements to appear in AI Overviews or AI Mode", and no special optimization is needed; a page has to be indexed and eligible to be shown in Google Search with a snippet.';
export const NOT_A_PROMISE = 'These counts say what robots.txt and the pages allow. They are not a measure of visibility in AI answers and promise none.';
export const ROBOTS_LIMIT = 'Access is read from robots.txt with each crawler\'s own token. A CDN or firewall can treat a real AI crawler differently; Seekwide never pretends to be one, so that is not tested. Server logs show what the real crawlers get.';
export const LLMS_STATEMENT = 'Information only: Google says llms.txt files neither harm nor help visibility in Google Search, which ignores them, and no AI vendor was found to document reading other sites\' llms.txt.';
/** What to check by hand: none of it can be seen from the site. */
export const AI_MANUAL_CHECKS = Object.freeze([
  'Search Console, Settings, "Search generative AI": whether the site is included in AI Overviews, AI Mode and Discover\'s generative features (Include, Exclude or Inherit). The setting cannot be seen from the site.',
  'The bot settings of your CDN or firewall. On Cloudflare, Block in AI Crawl Control also blocks Googlebot, Bingbot and Applebot since 2026-09-15; Disallow AI Training refuses training only.',
  'If the site used noarchive or nocache to keep content out of Bing\'s AI: before 2027-03-01, state it with Bing\'s new ai-training and ai-grounding preferences, and record the temporary grounding preference in Bing Webmaster Tools.',
]);

/**
 * @typedef {Object} AiView
 * @property {string|null} notJudged  Why AI crawler access was not judged in the run, or null when it was.
 * @property {{label: string, value: string}[]} counts
 * @property {string} policy
 * @property {{token: string, vendor: string, product: string, role: string, access: string, robots: string, counted: boolean, source: string|null, verified: string}[]} matrix
 * @property {string} training
 * @property {string} llms
 * @property {string[]} statements
 * @property {readonly string[]} manual
 * @property {string} dataDate
 */

/**
 * A label for a value, looked up only among the table's own keys; a value the table does not know reads as itself.
 * @param {Record<string, string>} table
 * @param {string} value
 * @returns {string}
 */
const label = (table, value) => (Object.hasOwn(table, value) ? table[value] : value);

/**
 * @param {unknown} value
 * @returns {value is AiSummary}
 */
const isSummary = (value) => typeof value === 'object' && value !== null && Array.isArray(/** @type {{agents?: unknown}} */ (value).agents);

/**
 * The AI search readiness section of a run, or null when the ai module did not run.
 * @param {Run} run
 * @returns {AiView|null}
 */
export function viewAi(run) {
  const ai = run.ai;
  if (!isSummary(ai)) return null;
  const byToken = new Map(ai.agents.map((agent) => [agent.token, agent.allowed]));
  const known = new Set(AI_BOTS.map((bot) => bot.token));
  /** @type {AiView['matrix']} */
  const rows = AI_BOTS.filter((bot) => byToken.has(bot.token)).map((bot) => ({
    token: bot.token, vendor: bot.vendor, product: bot.product, role: label(ROLE_LABELS, bot.role),
    access: byToken.get(bot.token) ? 'Allowed' : 'Blocked', robots: label(ROBOTS_LABELS, bot.robots),
    counted: bot.counted && bot.verified, source: bot.source, verified: bot.verified ? bot.last_verified : `not verified (last read ${bot.last_verified})`,
  }));
  // A run saved with older crawler data can name a token the current data no longer has: shown, never counted.
  for (const [token, allowed] of byToken) {
    if (known.has(token)) continue;
    rows.push({ token, vendor: '—', product: '', role: 'Not in the current crawler data', access: allowed ? 'Allowed' : 'Blocked', robots: '—', counted: false, source: null, verified: '—' });
  }
  const counted = rows.filter((row) => row.counted);
  /** @type {{label: string, value: string}[]} */
  const counts = [];
  const unknown = rows.filter((row) => row.source === null).length;
  if (counted.length > 0) {
    const more = unknown === 0 ? '' : ` (${unknown} not in the current crawler data)`;
    counts.push({ label: 'AI search crawlers that robots.txt lets read the start page', value: `${counted.filter((row) => row.access === 'Allowed').length} of ${counted.length}${more}` });
  }
  for (const { id, label } of PAGE_COUNTS) {
    const stat = (Array.isArray(run.checks) ? run.checks : []).find((check) => check?.id === id);
    // A count from the run is shown only when it is one: a stored run is checked for its check ids, not their counts.
    if (stat && stat.status === 'run' && Number.isSafeInteger(stat.applicable) && Number.isSafeInteger(stat.passed) && stat.applicable > 0 && stat.passed <= stat.applicable) {
      counts.push({ label, value: `${stat.passed} of ${stat.applicable}` });
    }
  }
  const llms = ai.llms_txt;
  const notJudged = aiAccessNotJudged(ai);
  return {
    notJudged,
    counts,
    policy: ai.policy === null ? 'Not stated in the profile, so a block is reported as something to check against your intent.' : label(POLICY_LABELS, ai.policy),
    matrix: rows,
    training: Object.hasOwn(TRAINING_LABELS, ai.training_preference) ? TRAINING_LABELS[ai.training_preference] : TRAINING_LABELS.unknown,
    llms: llms === null ? '/llms.txt was not requested in this run.' : `${label(LLMS_LABELS, llms.outcome)} ${LLMS_STATEMENT}`,
    statements: [GOOGLE_STATEMENT, NOT_A_PROMISE, ROBOTS_LIMIT, ...(notJudged === null ? [] : [notJudged])],
    manual: AI_MANUAL_CHECKS,
    dataDate: ai.bots_verified,
  };
}

/**
 * The AI search readiness layer, for a run of the ai module.
 * @param {AiView} view
 * @returns {{name: string, measured: boolean, status: string, text: string, detail: string|null}}
 */
export function aiLayer(view) {
  const counts = view.counts.map((count) => `${count.label}: ${count.value}.`).join(' ');
  return {
    name: 'AI search readiness (this run)',
    measured: true,
    status: 'Measured in this run',
    text: `What robots.txt and the pages allow AI search crawlers and AI answers to use. ${counts}${view.notJudged === null ? '' : ` ${view.notJudged}`} Not covered: whether AI products mention or cite the site.`,
    detail: `${GOOGLE_STATEMENT} Crawler data verified ${view.dataDate}.`,
  };
}
