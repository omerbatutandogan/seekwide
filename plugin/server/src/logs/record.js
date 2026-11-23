// The stored form of a log import (`.seekwide/imports/server_logs.json`) and
// the check every reader applies to it. A `.seekwide/` folder can arrive with
// a repository someone else wrote, so the file is untrusted input like a run:
// a file of any other form is refused as damaged, and the problem names the
// field, never its value.

/** @import { LogCounts, LoggedBot } from './summary.js' */

import { AI_BOTS } from '../util/ai-bots.js';
import { stripHidden } from '../util/strings.js';
import { LOGGED_BOTS } from './bots.js';
import { LOG_MAX_BYTES, LOG_MAX_FILES } from './read.js';
import { LOG_LIMITS, STATUS_CLASSES } from './summary.js';

export const LOG_SCHEMA_VERSION = 1;

/**
 * @typedef {Object} LogImport
 * @property {1} schema_version
 * @property {'server_logs'} source
 * @property {string} imported_at   ISO time.
 * @property {{path: string, bytes: number, gzip: boolean}[]} files
 * @property {{start: string, end: string}|null} period  The first and last day of the lines read, in UTC.
 * @property {LogCounts} counts
 * @property {string} bots_verified  The date of `data/ai-bots.json` the user agents were matched with.
 * @property {LoggedBot[]} bots     In the data file's order.
 */

const TOP_KEYS = ['schema_version', 'source', 'imported_at', 'files', 'period', 'counts', 'bots_verified', 'bots'];
const BOT_KEYS = ['token', 'requests', 'robots_txt', 'statuses', 'first_seen', 'last_seen', 'paths', 'paths_capped', 'top_paths'];
const COUNT_KEYS = ['lines', 'unparsed', 'without_agent', 'ai_requests', 'truncated'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const BREAKS = /[\t\n\r\u2028\u2029]/;

/** @param {unknown} value */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value */
const isCount = (value) => Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
/** @param {unknown} value @param {string[]} keys */
const hasKeys = (value, keys) => isObject(value) && Object.keys(/** @type {object} */ (value)).length === keys.length && keys.every((key) => Object.hasOwn(/** @type {object} */ (value), key));
/** @param {unknown} value */
const isDay = (value) => typeof value === 'string' && DATE.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
/** @param {unknown} value */
const isTime = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
/** Text as the import writes it: clipped, on one line, without hidden characters. @param {unknown} value @param {number} max */
const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && stripHidden(value) === value && !BREAKS.test(value);

/**
 * @param {unknown} row
 * @returns {string|null}
 */
function botProblem(row) {
  if (!hasKeys(row, BOT_KEYS)) return 'has a crawler with fields the plugin does not write';
  const bot = /** @type {Record<string, any>} */ (row);
  if (!LOGGED_BOTS.some((known) => known.token === bot.token)) return 'names a crawler the data file does not have';
  if (!isCount(bot.requests) || bot.requests === 0 || !isCount(bot.robots_txt) || !isCount(bot.paths) || typeof bot.paths_capped !== 'boolean') return 'has a crawler without valid counts';
  if (!hasKeys(bot.statuses, [...STATUS_CLASSES]) || !STATUS_CLASSES.every((key) => isCount(bot.statuses[key]))) return 'has a crawler without valid status counts';
  if (STATUS_CLASSES.reduce((sum, key) => sum + bot.statuses[key], 0) !== bot.requests || bot.robots_txt > bot.requests || bot.paths > bot.requests || bot.paths > LOG_LIMITS.maxPaths) {
    return 'has a crawler whose counts do not agree';
  }
  if (!isDay(bot.first_seen) || !isDay(bot.last_seen) || bot.first_seen > bot.last_seen) return 'has a crawler without valid days';
  if (!Array.isArray(bot.top_paths) || bot.top_paths.length > Math.min(LOG_LIMITS.topPaths, bot.paths)) return 'has a crawler with too many paths';
  let previous = Infinity;
  for (const top of bot.top_paths) {
    if (!hasKeys(top, ['path', 'requests']) || !isText(top.path, LOG_LIMITS.pathChars) || !top.path.startsWith('/') || !isCount(top.requests) || top.requests === 0 || top.requests > previous) {
      return 'has a crawler with a path that is not valid';
    }
    previous = top.requests;
  }
  return null;
}

/**
 * The first problem of a stored log import, or null when it has the form the plugin writes.
 * @param {unknown} value
 * @returns {string|null}
 */
export function logImportProblem(value) {
  if (!hasKeys(value, TOP_KEYS)) return 'the file has fields the plugin does not write, or lacks some';
  const data = /** @type {Record<string, any>} */ (value);
  if (data.schema_version !== LOG_SCHEMA_VERSION) return 'schema_version is not one this version reads';
  if (data.source !== 'server_logs') return 'source does not match the file name';
  if (!isTime(data.imported_at)) return 'imported_at is not a date';
  if (!Array.isArray(data.files) || data.files.length === 0 || data.files.length > LOG_MAX_FILES ||
    !data.files.every((file) => hasKeys(file, ['path', 'bytes', 'gzip']) && isText(file.path, 300) && isCount(file.bytes) && file.bytes > 0 && file.bytes <= LOG_MAX_BYTES && typeof file.gzip === 'boolean')) {
    return 'files is not a valid list of the files read';
  }
  if (data.period !== null && (!hasKeys(data.period, ['start', 'end']) || !isDay(data.period.start) || !isDay(data.period.end) || data.period.start > data.period.end)) {
    return 'period is not a valid range of days';
  }
  const counts = data.counts;
  if (!hasKeys(counts, COUNT_KEYS) || !COUNT_KEYS.slice(0, 4).every((key) => isCount(counts[key])) || typeof counts.truncated !== 'boolean') return 'counts does not hold valid numbers';
  if (counts.lines > LOG_LIMITS.maxLines || counts.unparsed + counts.without_agent + counts.ai_requests > counts.lines) return 'counts do not agree';
  if (!isDay(data.bots_verified)) return 'bots_verified is not a date';
  if (!Array.isArray(data.bots) || data.bots.length > LOGGED_BOTS.length) return 'bots is not a list of crawlers';
  let index = -1;
  for (const bot of data.bots) {
    const problem = botProblem(bot);
    if (problem !== null) return `bots ${problem}`;
    const at = AI_BOTS.findIndex((known) => known.token === bot.token);
    if (at <= index) return 'bots are not in the data file\'s order or name a crawler twice';
    index = at;
  }
  if (data.bots.reduce((/** @type {number} */ sum, /** @type {any} */ bot) => sum + bot.requests, 0) !== counts.ai_requests) return 'bots do not add up to counts.ai_requests';
  if ((data.period === null) !== (counts.lines === counts.unparsed)) return 'period does not match the lines read';
  return null;
}
