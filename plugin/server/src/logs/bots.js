// Which crawler of `data/ai-bots.json` a user agent names. A user agent is
// whatever the client chose to send, so a match says which crawler the request
// claimed to come from, never that it did: verifying that needs the vendor's
// published addresses, which Seekwide does not fetch during an audit.

/** @import { AiBot } from '../util/ai-bots.js' */

import { AI_BOTS } from '../util/ai-bots.js';

/**
 * The crawlers that send their token in the user agent. A control token
 * (Google-Extended, Applebot-Extended) and the training preference are only
 * read from robots.txt; no request carries them.
 */
export const LOGGED_BOTS = Object.freeze(AI_BOTS.filter((bot) => bot.role !== 'control' && bot.role !== 'policy'));

const escape = (/** @type {string} */ token) => token.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

// The token as a whole product name: not part of a longer one, so "Googlebot-Image" is not Googlebot. Longest first, so
// that of two tokens where one starts the other, the longer wins.
const TOKENS = new RegExp(
  `(?<![A-Za-z0-9_-])(${[...LOGGED_BOTS].sort((a, b) => b.token.length - a.token.length).map((bot) => escape(bot.token)).join('|')})(?![A-Za-z0-9_-])`,
  'i',
);
const BY_LOWER = new Map(LOGGED_BOTS.map((bot) => [bot.token.toLowerCase(), bot]));

/**
 * The crawler whose token the user agent names first, or null.
 * @param {string|null} agent
 * @returns {AiBot|null}
 */
export function botOfAgent(agent) {
  if (agent === null) return null;
  const match = TOKENS.exec(agent);
  return match === null ? null : BY_LOWER.get(match[1].toLowerCase()) ?? null;
}
