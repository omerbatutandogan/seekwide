// The report's section on imported server logs: which AI crawlers the
// requests in the site's own access logs named, set beside what robots.txt
// told each one in the audit. Counts of claims, never a score: a user agent
// can be sent by anyone, and the section says so.

/** @import { LogImport } from '../logs/record.js' */
/** @import { Run } from '../types.js' */

import { botByToken } from '../util/ai-bots.js';

/** Paths shown per crawler. */
const SHOWN_PATHS = 5;

export const LOGS_SUPPLIED = 'From access logs the user supplied, read on this machine. Each request is counted for the crawler its user agent names; ' +
  'anyone can send any user agent, so these are claims, not verified visits. To verify one, compare the client addresses in the log with the list the vendor publishes. ' +
  'Paths were chosen by whoever sent the request.';

/**
 * @typedef {Object} LogsView
 * @property {string} supplied
 * @property {string} files        The files read, in a sentence.
 * @property {string} period
 * @property {string} linesText
 * @property {{token: string, vendor: string, requests: string, robotsTxt: string, statuses: string, days: string, paths: string, access: string}[]} rows
 * @property {{token: string, paths: string}[]} topPaths
 * @property {string[]} notes
 */

const count = (/** @type {number} */ value) => value.toLocaleString('en-US');

/**
 * The server log section, or null when no log import is given.
 * @param {LogImport|null|undefined} logs
 * @param {Run} run
 * @returns {LogsView|null}
 */
export function viewLogs(logs, run) {
  if (logs === null || logs === undefined) return null;
  const agents = Array.isArray(run.ai?.agents) && run.ai?.robots !== null && run.ai?.robots !== undefined ? new Map(run.ai.agents.map((agent) => [agent.token, agent.allowed])) : null;
  /** @type {string[]} */
  const notes = [];
  const rows = logs.bots.map((bot) => {
    const allowed = agents?.get(bot.token);
    return {
      token: bot.token,
      vendor: botByToken(bot.token)?.vendor ?? '—',
      requests: count(bot.requests),
      robotsTxt: count(bot.robots_txt),
      statuses: /** @type {const} */ (['2xx', '3xx', '4xx', '5xx']).map((key) => `${key} ${count(bot.statuses[key])}`).join(', '),
      days: bot.first_seen === bot.last_seen ? bot.first_seen : `${bot.first_seen} to ${bot.last_seen}`,
      paths: `${count(bot.paths)}${bot.paths_capped ? '+' : ''}`,
      access: allowed === undefined ? '—' : allowed ? 'Allowed' : 'Blocked',
    };
  });
  const despite = logs.bots.filter((bot) => agents?.get(bot.token) === false && bot.requests > bot.robots_txt);
  if (despite.length > 0) {
    notes.push(`robots.txt in this audit keeps ${despite.map((bot) => bot.token).join(', ')} from the start page, and the log has page requests in ${despite.length === 1 ? 'its' : 'their'} name. ` +
      'robots.txt may have changed during the period of the log, the crawler may not follow it, or another client used its name.');
  }
  if (agents === null) notes.push('This audit did not read robots.txt for AI crawlers, so the counts are not set beside it.');
  if (logs.counts.truncated) notes.push('The files held more lines than one import reads; the lines after the limit were not counted.');
  if (logs.counts.without_agent === logs.counts.lines - logs.counts.unparsed) notes.push('The log has no user agents (the Common Log Format), so no crawler could be recognized.');
  else if (logs.bots.length === 0) notes.push('No request in the log named an AI crawler that Seekwide knows.');
  const files = logs.files.map((file) => file.path);
  return {
    supplied: LOGS_SUPPLIED,
    files: `${files.length === 1 ? 'The file' : `${files.length} files:`} ${files.join(', ')}, imported on ${logs.imported_at.slice(0, 10)}. Crawler data of ${logs.bots_verified}.`,
    period: logs.period === null ? 'No line could be dated.' : `${logs.period.start} to ${logs.period.end} (UTC).`,
    linesText: `${count(logs.counts.lines)} lines read, ${count(logs.counts.ai_requests)} of them in the name of a known AI crawler${logs.counts.unparsed > 0 ? `, ${count(logs.counts.unparsed)} in neither log format` : ''}.`,
    rows,
    topPaths: logs.bots.filter((bot) => bot.top_paths.length > 0).map((bot) => ({
      token: bot.token,
      paths: bot.top_paths.slice(0, SHOWN_PATHS).map((top) => `${top.path} (${count(top.requests)})`).join(', '),
    })),
    notes,
  };
}
