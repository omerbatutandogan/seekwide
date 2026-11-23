// The counts a log import keeps: per crawler of `data/ai-bots.json`, how many
// requests claimed to come from it, how many asked for robots.txt, the status
// classes it got, the first and last day it was seen and the paths it asked
// for most. Nothing about the clients is kept, and no path with its query.

/** @import { LogEntry } from './parse.js' */

import { clip } from '../util/strings.js';
import { LOGGED_BOTS, botOfAgent } from './bots.js';

/** The limits of one import. */
export const LOG_LIMITS = Object.freeze({
  /** Lines read over all files; the rest is not read and the import says so. */
  maxLines: 10_000_000,
  /** Distinct paths counted per crawler; past it the count is a lower bound. */
  maxPaths: 50_000,
  /** The paths kept per crawler, most requested first. */
  topPaths: 10,
  /** The longest path kept. */
  pathChars: 300,
});

/** @typedef {'2xx'|'3xx'|'4xx'|'5xx'|'1xx'} StatusClass */
export const STATUS_CLASSES = /** @type {const} */ (['2xx', '3xx', '4xx', '5xx', '1xx']);

/**
 * What a log import says about one crawler.
 * @typedef {Object} LoggedBot
 * @property {string} token
 * @property {number} requests
 * @property {number} robots_txt        Requests for /robots.txt.
 * @property {Record<StatusClass, number>} statuses
 * @property {string} first_seen        YYYY-MM-DD.
 * @property {string} last_seen
 * @property {number} paths             Distinct paths requested.
 * @property {boolean} paths_capped     True when `paths` reached `LOG_LIMITS.maxPaths`, so it is a lower bound.
 * @property {{path: string, requests: number}[]} top_paths
 */

/**
 * @typedef {Object} LogCounts
 * @property {number} lines          Lines read, empty ones left out.
 * @property {number} unparsed       Lines in neither the Common Log Format nor the combined format.
 * @property {number} without_agent  Lines read without a user agent (the Common Log Format has none).
 * @property {number} ai_requests    Lines whose user agent names a crawler of the data file.
 * @property {boolean} truncated     True when `LOG_LIMITS.maxLines` was reached.
 */

/** @param {string} path */
const keptPath = (path) => clip(path, LOG_LIMITS.pathChars);

/** Collects the counts of the lines given to `add`, in any order. */
export class LogSummary {
  /** @param {{maxLines?: number}} [limits]  A lower line limit, for tests. */
  constructor({ maxLines = LOG_LIMITS.maxLines } = {}) {
    this.maxLines = Math.min(maxLines, LOG_LIMITS.maxLines);
    /** @type {LogCounts} */
    this.counts = { lines: 0, unparsed: 0, without_agent: 0, ai_requests: 0, truncated: false };
    /** @type {{start: string, end: string}|null} */
    this.period = null;
    /** @type {Map<string, {requests: number, robots: number, statuses: Record<StatusClass, number>, first: string, last: string, paths: Map<string, number>, capped: boolean}>} */
    this.bots = new Map();
  }

  /** Whether another line may be read. */
  get full() {
    return this.counts.lines >= this.maxLines;
  }

  /**
   * Count one line; a line past the limit is not counted and marks the import truncated.
   * @param {LogEntry|null} entry  The parsed line, or null for one that could not be read.
   */
  add(entry) {
    if (this.full) {
      this.counts.truncated = true;
      return;
    }
    this.counts.lines += 1;
    if (entry === null) {
      this.counts.unparsed += 1;
      return;
    }
    if (this.period === null) this.period = { start: entry.day, end: entry.day };
    else {
      if (entry.day < this.period.start) this.period.start = entry.day;
      if (entry.day > this.period.end) this.period.end = entry.day;
    }
    if (entry.agent === null) {
      this.counts.without_agent += 1;
      return;
    }
    const bot = botOfAgent(entry.agent);
    if (bot === null) return;
    this.counts.ai_requests += 1;
    let seen = this.bots.get(bot.token);
    if (seen === undefined) {
      seen = { requests: 0, robots: 0, statuses: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, '1xx': 0 }, first: entry.day, last: entry.day, paths: new Map(), capped: false };
      this.bots.set(bot.token, seen);
    }
    seen.requests += 1;
    seen.statuses[/** @type {StatusClass} */ (`${Math.floor(entry.status / 100)}xx`)] += 1;
    if (entry.day < seen.first) seen.first = entry.day;
    if (entry.day > seen.last) seen.last = entry.day;
    if (entry.path === null) return;
    if (entry.path === '/robots.txt') seen.robots += 1;
    const path = keptPath(entry.path);
    const count = seen.paths.get(path);
    if (count !== undefined) seen.paths.set(path, count + 1);
    else if (seen.paths.size < LOG_LIMITS.maxPaths) seen.paths.set(path, 1);
    else seen.capped = true;
  }

  /**
   * The crawlers seen, in the data file's order.
   * @returns {LoggedBot[]}
   */
  result() {
    return LOGGED_BOTS.filter((bot) => this.bots.has(bot.token)).map((bot) => {
      const seen = /** @type {NonNullable<ReturnType<typeof this.bots.get>>} */ (this.bots.get(bot.token));
      const top = [...seen.paths.entries()]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, LOG_LIMITS.topPaths)
        .map(([path, requests]) => ({ path, requests }));
      return {
        token: bot.token,
        requests: seen.requests,
        robots_txt: seen.robots,
        statuses: { ...seen.statuses },
        first_seen: seen.first,
        last_seen: seen.last,
        paths: seen.paths.size,
        paths_capped: seen.capped,
        top_paths: top,
      };
    });
  }
}
