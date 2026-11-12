// Reading a robots.txt file into groups of rules (RFC 9309, section 2).
//
// Up to version 0.1.0 the robots-parser package read the file. This parser
// reads it the same way, line by line, with one difference that RFC 9309
// 2.2.4 requires: a line that is not part of a group (`Sitemap:`, `Host:`, or a
// record the crawler does not know) no longer ends the run of `User-agent`
// lines that starts a group. With robots-parser,
//
//   User-agent: seekwide
//   Sitemap: https://example.com/sitemap.xml
//   User-agent: other
//   Disallow: /x
//
// gave `seekwide` no rule, so the crawler requested /x. Here both agents share
// the group, as the RFC says. The rules are matched in robots-match.js.

/**
 * A rule as stored: the pattern with non-ASCII characters percent-encoded and
 * the hex digits of every escape in upper case, and whether it allows.
 * @typedef {{pattern: string, allow: boolean}} StoredRule
 */

/**
 * @typedef {Object} RobotsGroup
 * @property {StoredRule[]} rules
 * @property {number} [crawlDelay]  The last `Crawl-delay` of the group that is a number.
 */

/**
 * @typedef {Object} ParsedRobots
 * @property {Map<string, RobotsGroup>} groups  By product token. An agent has a group once a rule or a
 *   `Crawl-delay` line follows its `User-agent` line; groups of one agent are merged (RFC 9309 2.2.1).
 * @property {Set<string>} named   Every token a `User-agent` line names, with or without a group.
 * @property {string[]} sitemaps   `Sitemap` values in file order, as written.
 */

/**
 * The product token a `User-agent` value names: lower case, without a version
 * ("Seekwide/0.1" names "seekwide"), trimmed.
 * @param {string} value
 * @returns {string}
 */
export function agentToken(value) {
  const lower = value.toLowerCase();
  const slash = lower.indexOf('/');
  return (slash === -1 ? lower : lower.slice(0, slash)).trim();
}

/**
 * A rule's pattern as stored: characters outside ASCII percent-encoded, `%`
 * kept as written, escapes upper-cased. A pattern that cannot be encoded (a
 * lone surrogate) is kept as written.
 * @param {string} pattern
 * @returns {string}
 */
function storedPattern(pattern) {
  let encoded;
  try {
    encoded = encodeURI(pattern).replace(/%25/g, '%');
  } catch {
    encoded = pattern;
  }
  return encoded.replace(/%[0-9a-fA-F]{2}/g, (escape) => escape.toUpperCase());
}

/** Records that belong to the group above them and end its run of `User-agent` lines. */
const GROUP_RECORDS = new Set(['allow', 'disallow', 'crawl-delay']);

/**
 * Read a robots.txt file.
 *
 * Guarantees, line by line: lines end at CR, LF or CRLF; a `#` starts a
 * comment; a line without a `:` or with an empty name is ignored; names are
 * case-insensitive and values trimmed. A `User-agent` line that follows a
 * group record (`Allow`, `Disallow`, `Crawl-delay`) starts a new group; one
 * that follows another `User-agent` line, or only lines of other records,
 * adds its agent to the group being started. An `Allow` or `Disallow` with an
 * empty value creates the group without adding a rule. A `Crawl-delay` that is
 * not a number is ignored (an empty one is 0). `Sitemap` values are kept
 * wherever they appear.
 * @param {string} text
 * @returns {ParsedRobots}
 */
export function parseRobotsTxt(text) {
  /** @type {Map<string, RobotsGroup>} */
  const groups = new Map();
  /** @type {Set<string>} */
  const named = new Set();
  /** @type {string[]} */
  const sitemaps = [];
  /** @type {string[]} */
  let agents = [];
  let startsGroup = true;

  /** @param {string} agent @returns {RobotsGroup} */
  const groupOf = (agent) => {
    let group = groups.get(agent);
    if (group === undefined) {
      group = { rules: [] };
      groups.set(agent, group);
    }
    return group;
  };

  for (const raw of text.split(/\r\n|\r|\n/)) {
    const hash = raw.indexOf('#');
    const line = hash === -1 ? raw : raw.slice(0, hash);
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (name === '') continue;
    const value = line.slice(colon + 1).trim();

    if (name === 'user-agent') {
      if (startsGroup) agents = [];
      if (value !== '') {
        const token = agentToken(value);
        agents.push(token);
        named.add(token);
      }
      startsGroup = false;
      continue;
    }
    if (name === 'allow' || name === 'disallow') {
      for (const agent of agents) {
        const group = groupOf(agent);
        if (value !== '') group.rules.push({ pattern: storedPattern(value), allow: name === 'allow' });
      }
    } else if (name === 'crawl-delay') {
      const delay = Number(value);
      for (const agent of agents) {
        const group = groupOf(agent);
        if (!Number.isNaN(delay)) group.crawlDelay = delay;
      }
    } else if (name === 'sitemap' && value !== '') {
      sitemaps.push(value);
    }
    if (GROUP_RECORDS.has(name)) startsGroup = true;
  }
  return { groups, named, sitemaps };
}

/**
 * The group a crawler with these product tokens (most specific first) follows:
 * the group of the first token that has one, else the `*` group, else none.
 * @param {ParsedRobots} parsed
 * @param {string[]} agents
 * @returns {RobotsGroup|null}
 */
export function groupFor(parsed, agents) {
  for (const agent of agents) {
    const group = parsed.groups.get(agentToken(agent));
    if (group !== undefined) return group;
  }
  return parsed.groups.get('*') ?? null;
}
