// The AI crawlers and robots.txt tokens the ai module knows, read from
// server/data/ai-bots.json, which ships with the plugin. Nothing here fetches
// anything: a vendor's page is read by a person at release time, never during an audit.

import { readFileSync } from 'node:fs';

/**
 * @typedef {'search'|'mixed'|'training'|'control'|'user'|'policy'} AiBotRole
 * @typedef {'obeys'|'documented'|'may_ignore'|'ignores'} AiBotRobots
 */

/**
 * One row of the data file.
 * @typedef {Object} AiBot
 * @property {string} token          The robots.txt product token, as the vendor writes it.
 * @property {string} vendor
 * @property {string} product        What it is for.
 * @property {AiBotRole} role
 * @property {boolean} counted       One of the AI search crawlers the module counts.
 * @property {string[]} fallback     Tokens whose group the crawler follows when robots.txt does not name it, most specific first.
 * @property {AiBotRobots} robots    Only what the vendor's page states: it follows robots.txt ('obeys'), a robots.txt setting
 *   for it is documented ('documented'), robots.txt may not apply ('may_ignore'), or it generally ignores robots.txt ('ignores').
 * @property {string} says           The vendor's statement, in short.
 * @property {string|null} ip_list   Where the vendor publishes its addresses, when its page names one.
 * @property {string} source         The vendor's page.
 * @property {boolean} verified      False when the page could not be read at the last check.
 * @property {string} last_verified  YYYY-MM-DD.
 * @property {string} [training_control]  For a mixed crawler: the documented way to refuse training only.
 */

const DATA = new URL('../../data/ai-bots.json', import.meta.url);
const ROLES = new Set(['search', 'mixed', 'training', 'control', 'user', 'policy']);
const ROBOTS = new Set(['obeys', 'documented', 'may_ignore', 'ignores']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** robots.txt product tokens are letters, digits, "_" and "-" (RFC 9309 2.2.1). */
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;

/** The token of the shared training preference (draft-kelley-aipref-training-preference-signal-00). */
export const POLICY_TOKEN = '__usage_ai-training';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Check the data file's rows. Throws on the first problem: the file ships
 * with the plugin, so a bad row is a bug to catch in the tests.
 * @param {unknown} data
 * @returns {{lastVerified: string, bots: AiBot[]}}
 */
export function readAiBots(data) {
  if (!isObject(data) || data.schema !== 1 || typeof data.last_verified !== 'string' || !DATE.test(data.last_verified) || !Array.isArray(data.bots)) {
    throw new TypeError('ai-bots.json: needs schema 1, last_verified and bots');
  }
  const seen = new Set();
  const bots = data.bots.map((row, index) => {
    const at = `ai-bots.json bots[${index}]`;
    if (!isObject(row)) throw new TypeError(`${at}: not an object`);
    const { token, vendor, product, role, counted, fallback, robots, says, ip_list: ipList, source, verified, last_verified: lastVerified } = row;
    if (typeof token !== 'string' || !TOKEN.test(token)) throw new TypeError(`${at}: token`);
    if (seen.has(token.toLowerCase())) throw new TypeError(`${at}: token listed twice`);
    seen.add(token.toLowerCase());
    for (const [name, value] of Object.entries({ vendor, product, says, source })) {
      if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${at}: ${name}`);
    }
    if (!/^https:\/\//.test(/** @type {string} */ (source))) throw new TypeError(`${at}: source must be an https URL`);
    if (ipList !== null && (typeof ipList !== 'string' || !/^https:\/\//.test(ipList))) throw new TypeError(`${at}: ip_list`);
    if (typeof role !== 'string' || !ROLES.has(role)) throw new TypeError(`${at}: role`);
    if (typeof robots !== 'string' || !ROBOTS.has(robots)) throw new TypeError(`${at}: robots`);
    if (typeof counted !== 'boolean' || typeof verified !== 'boolean') throw new TypeError(`${at}: counted and verified are true or false`);
    if (!Array.isArray(fallback) || !fallback.every((item) => typeof item === 'string' && TOKEN.test(item))) throw new TypeError(`${at}: fallback`);
    if (typeof lastVerified !== 'string' || !DATE.test(lastVerified)) throw new TypeError(`${at}: last_verified`);
    if (counted && (role !== 'search' && role !== 'mixed')) throw new TypeError(`${at}: only a search or mixed crawler is counted`);
    if (row.training_control !== undefined && typeof row.training_control !== 'string') throw new TypeError(`${at}: training_control`);
    return /** @type {AiBot} */ ({ ...row });
  });
  if (!bots.some((bot) => bot.token === POLICY_TOKEN && bot.role === 'policy')) throw new TypeError(`ai-bots.json: the ${POLICY_TOKEN} row is missing`);
  return { lastVerified: data.last_verified, bots };
}

const loaded = readAiBots(JSON.parse(readFileSync(DATA, 'utf8')));

/** The date the vendor pages behind the data were last read, YYYY-MM-DD. */
export const AI_BOTS_VERIFIED = loaded.lastVerified;

/** Every row, in the file's order. */
export const AI_BOTS = Object.freeze(loaded.bots.map((bot) => Object.freeze(bot)));

/**
 * The rows a counted or scored check may rest on: the vendor's page was read
 * at the last check. A row whose page could not be read is shown in the
 * report, marked, and judged by no check.
 * @param {(bot: AiBot) => boolean} [filter]
 * @returns {AiBot[]}
 */
export function verifiedBots(filter = () => true) {
  return AI_BOTS.filter((bot) => bot.verified && filter(bot));
}

/**
 * The product tokens to evaluate robots.txt with for one bot: its own, then
 * its fallbacks (Applebot follows the Googlebot group when robots.txt does not name it).
 * @param {AiBot} bot
 * @returns {string[]}
 */
export const agentChain = (bot) => [bot.token, ...bot.fallback];

/**
 * @param {string} token
 * @returns {AiBot|undefined}
 */
export const botByToken = (token) => AI_BOTS.find((bot) => bot.token === token);
