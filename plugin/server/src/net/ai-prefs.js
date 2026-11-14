// Reading the AI usage preferences a site states in robots.txt: the IETF
// aipref working group's Content-Usage rule (draft-ietf-aipref-attach-05 with
// the vocabulary of draft-ietf-aipref-vocab-08) and Cloudflare's Content-Signal
// line. Pure. Each value is read in one pass over at most `MAX_PREFERENCE_CHARS`
// characters, with no pattern that can backtrack.

import { MAX_PREFERENCE_CHARS } from './robots-parse.js';

/** The usage categories of draft-ietf-aipref-vocab-08 (section 6.1); their preference is the token `y` or `n` (6.2). */
export const AIPREF_CATEGORIES = Object.freeze(['train-ai', 'ai-use', 'search']);
/**
 * Cloudflare's content signals and the values each takes (managed robots.txt page, read 2026-11-14). A Map, so that a
 * name a site writes (`constructor`, `__proto__`) is never looked up on an object's prototype.
 * @type {ReadonlyMap<string, readonly string[]>}
 */
export const CONTENT_SIGNALS = new Map([
  ['search', ['yes', 'no']],
  ['ai-input', ['yes', 'no']],
  ['ai-train', ['yes', 'no']],
  ['use', ['immediate', 'reference', 'full']],
]);

/**
 * @typedef {Object} PreferenceRead
 * @property {boolean} valid
 * @property {string|null} problem    Why it is not valid: 'syntax', or 'value' (a known label with another value).
 * @property {Record<string, string>} values  The known labels and their values, when valid.
 */

const LCALPHA = (/** @type {string} */ c) => c >= 'a' && c <= 'z';
const DIGIT = (/** @type {string} */ c) => c >= '0' && c <= '9';
const ALPHA = (/** @type {string} */ c) => LCALPHA(c) || (c >= 'A' && c <= 'Z');
const KEY_CHAR = (/** @type {string} */ c) => LCALPHA(c) || DIGIT(c) || c === '_' || c === '-' || c === '.' || c === '*';
/** tchar of RFC 9110, and ":" and "/", which an sf-token may hold. */
const TOKEN_CHAR = (/** @type {string} */ c) => ALPHA(c) || DIGIT(c) || "!#$%&'*+-.^_`|~:/".includes(c);

/**
 * A reader of one Structured Field Dictionary (RFC 9651, section 3.2): keys,
 * and as values tokens, booleans, integers, decimals, strings and inner lists
 * of them, each with parameters. Byte sequences, dates and display strings
 * are not expected in a usage preference and make the value a syntax error.
 * @param {string} text
 * @returns {Map<string, string>|null}  Each key's bare item as written (the last one wins, as RFC 9651 says), or null when it does not parse.
 */
export function parseDictionary(text) {
  let i = 0;
  const n = text.length;
  const skip = (/** @type {(c: string) => boolean} */ ok) => {
    while (i < n && ok(text[i])) i += 1;
  };
  const key = () => {
    if (i >= n || !(LCALPHA(text[i]) || text[i] === '*')) return null;
    const start = i;
    i += 1;
    skip(KEY_CHAR);
    return text.slice(start, i);
  };
  const bareItem = () => {
    const start = i;
    const c = text[i];
    if (c === undefined) return null;
    if (c === '"') {
      i += 1;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\') i += 1;
        if (i < n && (text[i] < ' ' || text[i] > '~')) return null;
        i += 1;
      }
      if (i >= n) return null;
      i += 1;
      return text.slice(start, i);
    }
    if (c === '?') {
      if (text[i + 1] !== '0' && text[i + 1] !== '1') return null;
      i += 2;
      return text.slice(start, i);
    }
    if (c === '-' || DIGIT(c)) {
      i += 1;
      skip((d) => DIGIT(d) || d === '.');
      const number = text.slice(start, i);
      return /^-?\d{1,15}(\.\d{1,3})?$/.test(number) ? number : null;
    }
    if (ALPHA(c) || c === '*') {
      i += 1;
      skip(TOKEN_CHAR);
      return text.slice(start, i);
    }
    return null;
  };
  const parameters = () => {
    while (text[i] === ';') {
      i += 1;
      skip((c) => c === ' ');
      if (key() === null) return false;
      if (text[i] === '=') {
        i += 1;
        if (bareItem() === null) return false;
      }
    }
    return true;
  };
  const item = () => {
    if (text[i] === '(') {
      i += 1;
      for (;;) {
        skip((c) => c === ' ');
        if (text[i] === ')') {
          i += 1;
          break;
        }
        if (bareItem() === null || !parameters()) return null;
        if (text[i] !== ' ' && text[i] !== ')') return null;
      }
      return parameters() ? '()' : null;
    }
    const value = bareItem();
    return value !== null && parameters() ? value : null;
  };

  /** @type {Map<string, string>} */
  const members = new Map();
  skip((c) => c === ' ');
  if (i >= n) return null;
  for (;;) {
    const name = key();
    if (name === null) return null;
    let value = '?1';
    if (text[i] === '=') {
      i += 1;
      const read = item();
      if (read === null) return null;
      value = read;
    } else if (!parameters()) {
      return null;
    }
    members.set(name, value);
    skip((c) => c === ' ' || c === '\t');
    if (i >= n) return members;
    if (text[i] !== ',') return null;
    i += 1;
    skip((c) => c === ' ' || c === '\t');
    if (i >= n) return null;
  }
}

/**
 * Read one `Content-Usage` value of robots.txt: an optional path that starts
 * with "/" and is followed by whitespace, then a usage preference, a
 * Structured Field Dictionary whose labels `train-ai`, `ai-use` and `search`
 * take the token `y` or `n`. Labels the vocabulary does not define are
 * ignored, as draft-ietf-aipref-vocab-08 (6.4) requires.
 * @param {string} value
 * @returns {PreferenceRead & {path: string|null}}
 */
export function readContentUsage(value) {
  let text = value.slice(0, MAX_PREFERENCE_CHARS).trim();
  /** @type {string|null} */
  let path = null;
  if (text.startsWith('/')) {
    let end = 0;
    while (end < text.length && text[end] !== ' ' && text[end] !== '\t') end += 1;
    path = text.slice(0, end);
    text = text.slice(end).trim();
  }
  const members = parseDictionary(text);
  if (members === null) return { valid: false, problem: 'syntax', values: {}, path };
  /** @type {Record<string, string>} */
  const values = {};
  for (const label of AIPREF_CATEGORIES) {
    const item = members.get(label);
    if (item === undefined) continue;
    if (item !== 'y' && item !== 'n') return { valid: false, problem: 'value', values: {}, path };
    values[label] = item;
  }
  return { valid: true, problem: null, values, path };
}

/**
 * Read one `Content-Signal` value: comma-separated `name=value` pairs. The
 * signals Cloudflare defines (`search`, `ai-input` and `ai-train` with `yes`
 * or `no`, and the `use` field it is testing with `immediate`, `reference` or
 * `full`) must have one of their values; other names are left alone, letter
 * case is not significant.
 * @param {string} value
 * @returns {PreferenceRead}
 */
export function readContentSignal(value) {
  const text = value.slice(0, MAX_PREFERENCE_CHARS).trim();
  if (text === '') return { valid: false, problem: 'syntax', values: {} };
  /** @type {Record<string, string>} */
  const values = {};
  for (const part of text.split(',')) {
    const pair = part.trim();
    const equals = pair.indexOf('=');
    if (equals <= 0 || equals === pair.length - 1) return { valid: false, problem: 'syntax', values: {} };
    const name = pair.slice(0, equals).trim().toLowerCase();
    const signal = pair.slice(equals + 1).trim().toLowerCase();
    if (name === '' || signal === '' || /\s/.test(name) || /\s/.test(signal)) return { valid: false, problem: 'syntax', values: {} };
    const allowed = CONTENT_SIGNALS.get(name);
    if (allowed === undefined) continue;
    if (!allowed.includes(signal)) return { valid: false, problem: 'value', values: {} };
    values[name] = signal;
  }
  return { valid: true, problem: null, values };
}
