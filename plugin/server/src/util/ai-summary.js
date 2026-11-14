// Sentences about a run's ai record that several places repeat: the tool's
// notes, the module's count note, the report and the comparison of two runs.

/** @import { AiSummary } from '../types.js' */

import { AI_BOTS } from './ai-bots.js';

/**
 * Why the run's AI crawler access was not judged, or null when it was:
 * robots.txt refused this crawler, working it out failed, or the crawl did
 * not record it.
 * @param {unknown} summary  `run.ai`, as stored (checked for its form only).
 * @returns {string|null}
 */
export function aiAccessNotJudged(summary) {
  if (typeof summary !== 'object' || summary === null) return null;
  const ai = /** @type {Partial<AiSummary>} */ (summary);
  if (ai.robots !== null) return null;
  if (Number.isSafeInteger(ai.robots_refused)) {
    return `robots.txt answered HTTP ${ai.robots_refused} to Seekwide's crawler instead of the file, so what it tells AI crawlers was not judged.`;
  }
  if (ai.robots_error === true) return 'What robots.txt tells AI crawlers could not be worked out because of an internal error, so it was not judged.';
  return 'robots.txt was not read for AI crawlers in this crawl, so what it tells them was not judged.';
}

/**
 * How many crawler tokens the run names that the current crawler data does not
 * have (a run saved before the data changed).
 * @param {unknown} summary
 * @returns {number}
 */
export function tokensNotInData(summary) {
  const agents = typeof summary === 'object' && summary !== null ? /** @type {{agents?: unknown}} */ (summary).agents : undefined;
  if (!Array.isArray(agents)) return 0;
  const known = new Set(AI_BOTS.map((bot) => bot.token));
  return agents.filter((agent) => typeof agent?.token === 'string' && !known.has(agent.token)).length;
}
