// Evaluation of robots.txt rules in time linear in the path, for the rules
// robots-parser has read.
//
// robots-parser matches a pattern against a path character by character while
// keeping every possible match length, which costs pattern length times path
// length for each rule. A 500 KiB file of wildcard rules and one long URL then
// stall the server for minutes. A robots.txt pattern only has `*` (any run of
// characters) and a final `$` (end of path), so the pieces between the
// wildcards can be found left to right instead, each at its first place: that
// answers the same question in one pass over the path per rule.

import { normalizeEscapes } from '../util/url.js';

/**
 * A rule as robots-parser stores it: the pattern with its percent escapes
 * normalized, and whether it allows.
 * @typedef {{pattern: string, allow: boolean}} StoredRule
 */

/**
 * @typedef {Object} CompiledRule
 * @property {number} length     Length of the stored pattern, which decides precedence.
 * @property {boolean} allow
 * @property {string[]} pieces   The pattern split at each `*`.
 * @property {boolean} anchored  True when the pattern ends with `$`.
 */

/**
 * @param {StoredRule} rule
 * @returns {CompiledRule}
 */
export function compileRule(rule) {
  // RFC 9309, 2.2.2: a percent-encoded unreserved character is compared as the character itself, in the rule as in the URL.
  // Precedence keeps the length of the rule as written, as robots-parser and Google's matcher count it.
  const pattern = normalizeEscapes(rule.pattern);
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  return { length: rule.pattern.length, allow: rule.allow, pieces: body.split('*'), anchored };
}

/**
 * Whether `path` matches the rule. The first piece must start the path, the
 * pieces between wildcards must follow in order, and with `$` the last piece
 * must end it.
 *
 * Guarantees: the same answer as robots-parser 3.0.1 for every pattern and
 * path without escapes of unreserved characters (`compileRule` and `rulePath`
 * decode those in both, as RFC 9309 asks), and at most one pass over the path
 * per piece boundary.
 * @param {CompiledRule} rule
 * @param {string} path
 * @returns {boolean}
 */
export function ruleMatches(rule, path) {
  const { pieces, anchored } = rule;
  const first = pieces[0];
  if (!path.startsWith(first)) return false;
  if (pieces.length === 1) return !anchored || path.length === first.length;
  let at = first.length;
  const lastIndex = pieces.length - 1;
  for (let i = 1; i < lastIndex; i += 1) {
    const found = path.indexOf(pieces[i], at);
    if (found === -1) return false;
    at = found + pieces[i].length;
  }
  const last = pieces[lastIndex];
  if (anchored) return path.length - last.length >= at && path.endsWith(last);
  return path.indexOf(last, at) !== -1;
}

/**
 * The rule that decides for `path`: the longest matching pattern, and on a tie
 * the one that allows. Null when no rule matches.
 * @param {CompiledRule[]} rules
 * @param {string} path
 * @returns {CompiledRule|null}
 */
export function decidingRule(rules, path) {
  /** @type {CompiledRule|null} */
  let chosen = null;
  for (const rule of rules) {
    if (chosen !== null && rule.length < chosen.length) continue;
    if (chosen !== null && rule.length === chosen.length && (chosen.allow || !rule.allow)) continue;
    if (ruleMatches(rule, path)) chosen = rule;
  }
  return chosen;
}

/**
 * The group of rules robots-parser would apply to `agent`, compiled, or null
 * when the parser does not hold its rules the way version 3.0.1 does.
 * @param {unknown} parser  A robots-parser instance.
 * @param {string} agent    A product token, for example "Seekwide".
 * @returns {CompiledRule[]|null}
 */
export function compiledGroup(parser, agent) {
  return compiledGroupFor(parser, [agent]);
}

/**
 * The group a crawler with several product tokens follows, compiled: the group
 * of the first token that has one of its own (Google lists them most specific
 * first; one matching token is enough, and only the most specific matching
 * group applies), else the `*` group. Null when the parser does not hold its
 * rules the way version 3.0.1 does.
 * @param {unknown} parser  A robots-parser instance.
 * @param {string[]} agents  Product tokens, most specific first, for example ["Googlebot-Image", "Googlebot"].
 * @returns {CompiledRule[]|null}
 */
export function compiledGroupFor(parser, agents) {
  const rules = /** @type {{_rules?: unknown}} */ (parser)._rules;
  if (rules === null || typeof rules !== 'object') return null;
  const groups = /** @type {Record<string, unknown>} */ (rules);
  const keys = agents.map((agent) => {
    let key = agent.toLowerCase();
    const slash = key.indexOf('/');
    if (slash > -1) key = key.slice(0, slash);
    return key.trim();
  });
  const own = keys.find((key) => Object.hasOwn(groups, key));
  const group = (own === undefined ? groups['*'] : groups[own]) ?? [];
  if (!Array.isArray(group)) return null;
  /** @type {CompiledRule[]} */
  const compiled = [];
  for (const rule of group) {
    if (rule === null || typeof rule !== 'object' || typeof rule.pattern !== 'string' || typeof rule.allow !== 'boolean') return null;
    compiled.push(compileRule(rule));
  }
  return compiled;
}

/**
 * The path compared with the rules: path and query of the URL, with the hex
 * digits of percent escapes in upper case and escapes of unreserved
 * characters decoded, as in the compiled rules.
 * @param {string} url  An absolute http(s) URL.
 * @returns {string}
 */
export function rulePath(url) {
  const parsed = new URL(url);
  return normalizeEscapes(parsed.pathname + parsed.search);
}
