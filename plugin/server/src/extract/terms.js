// Words that hacked sites are filled with, and the writing systems of a page's
// text. Counted while a page is extracted, because the record keeps only an
// excerpt of the text. Pure.
//
// The lists are rules of the security module (docs/CHECKS-SPEC.md). Change them
// together with the specification and the rule-set version.

/** @import { TermHits } from '../types.js' */

import { clip } from '../util/strings.js';

/**
 * Terms per category. Each is matched as whole words in lower-cased text, with
 * any run of spaces between its words. Chosen because ordinary sites rarely use
 * them outside their own topic: brand names of erectile dysfunction drugs, the
 * phrases of gambling spam (English, Indonesian and Turkish) and of counterfeit
 * goods. Phrases that ordinary pages use ("book a slot online", "free spins" in
 * a game guide, the name of a real outlet store) are left out.
 */
export const SPAM_TERMS = Object.freeze({
  pharma: [
    'viagra', 'cialis', 'levitra', 'kamagra', 'sildenafil', 'tadalafil', 'vardenafil',
    'online pharmacy', 'canadian pharmacy',
  ],
  gambling: [
    'online casino', 'casino online', 'casino bonus', 'no deposit bonus',
    'slot gacor', 'situs slot', 'judi online', 'judi slot', 'judi bola', 'situs judi', 'agen judi',
    'togel', 'bandar togel', 'sbobet', 'maxwin', 'slot88',
    'deneme bonusu', 'bahis siteleri', 'casino siteleri', 'canlı bahis', 'kaçak bahis',
  ],
  counterfeit: [
    'replica watches', 'replica handbags', 'replica rolex', 'fake rolex', 'cheap jerseys', 'cheap nfl jerseys',
    'louis vuitton outlet',
  ],
});

/**
 * Words that make a category part of what a site is about when they appear in
 * its start page's title, description or headings, so that a pharmacy, a
 * casino or a fashion shop is not reported for its own subject.
 */
export const TOPIC_WORDS = Object.freeze({
  pharma: [
    'pharmacy', 'pharmacies', 'drugstore', 'apotheke', 'eczane', 'farmacia', 'pharmacie',
    'medicine', 'medicines', 'medication', 'medications', 'clinic', 'urology', 'sexual health',
    'health', 'medical', 'hospital', 'doctor', 'doctors',
  ],
  gambling: ['casino', 'casinos', 'gambling', 'betting', 'poker', 'slots', 'lottery', 'bahis', 'kumar', 'judi', 'apuestas', 'wetten'],
  counterfeit: ['replica', 'replicas', 'watches', 'handbags', 'fashion', 'jerseys', 'outlet'],
});

/** Categories in report order. */
export const CATEGORIES = /** @type {('pharma'|'gambling'|'counterfeit')[]} */ (Object.keys(SPAM_TERMS));

/** Writing systems the audit tells apart, counting letters only (not combining marks); every other letter counts as `other`. */
export const SCRIPTS = Object.freeze({
  latin: /(?=\p{L})\p{Script=Latin}/gu,
  cyrillic: /(?=\p{L})\p{Script=Cyrillic}/gu,
  greek: /(?=\p{L})\p{Script=Greek}/gu,
  arabic: /(?=\p{L})\p{Script=Arabic}/gu,
  hebrew: /(?=\p{L})\p{Script=Hebrew}/gu,
  devanagari: /(?=\p{L})\p{Script=Devanagari}/gu,
  thai: /(?=\p{L})\p{Script=Thai}/gu,
  hangul: /(?=\p{L})\p{Script=Hangul}/gu,
  cjk: /(?=\p{L})[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu,
});

/** How much text the writing systems are counted on, from the start. */
export const SCRIPT_SAMPLE_CHARS = 50_000;
const MAX_TERMS_KEPT = 5;
const LETTER = /\p{L}/gu;

/**
 * @param {string} term
 * @returns {string}
 */
function pattern(term) {
  return foldCase(term).split(' ').map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
}

/**
 * One regular expression per category over `lists`, matching whole words.
 * @param {Readonly<Record<string, readonly string[]>>} lists
 * @returns {Map<string, RegExp>}
 */
function compile(lists) {
  return new Map(Object.entries(lists).map(([category, terms]) => [
    category,
    new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])(?:${[...terms].sort((a, b) => b.length - a.length).map(pattern).join('|')})(?![\\p{L}\\p{M}\\p{N}])`, 'gu'),
  ]));
}

const SPAM_PATTERNS = compile(SPAM_TERMS);
const TOPIC_PATTERNS = compile(
  Object.fromEntries(CATEGORIES.map((category) => [category, [...SPAM_TERMS[category], ...TOPIC_WORDS[category]]])),
);

/**
 * Lower-cased for matching, with the Turkish i letters folded together: a
 * dotted capital İ lower-cases to "i" plus a combining dot, which is dropped,
 * and a dotless ı becomes "i", because its capital I lower-cases to "i".
 * @param {string} text
 * @returns {string}
 */
export function foldCase(text) {
  return text.toLowerCase().replace(/\u0307/g, '').replace(/\u0131/g, 'i');
}

/**
 * @param {Map<string, RegExp>} patterns
 * @param {string[]} texts
 * @returns {Record<string, TermHits>}
 */
function count(patterns, texts) {
  /** @type {Record<string, TermHits>} */
  const hits = {};
  const folded = texts.filter((text) => text !== '').map(foldCase);
  for (const [category, regex] of patterns) {
    let total = 0;
    /** @type {string[]} */
    const terms = [];
    for (const text of folded) {
      regex.lastIndex = 0;
      for (let match = regex.exec(text); match !== null; match = regex.exec(text)) {
        total += 1;
        const term = clip(match[0].replace(/\s+/g, ' '), 60);
        if (terms.length < MAX_TERMS_KEPT && !terms.includes(term)) terms.push(term);
      }
    }
    if (total > 0) hits[category] = { count: total, terms };
  }
  return hits;
}

/**
 * Matches of the spam terms in `texts`, per category with at least one: how
 * many there are, and the first five distinct terms found.
 * @param {string[]} texts
 * @returns {Record<string, TermHits>}
 */
export function spamTermHits(texts) {
  return count(SPAM_PATTERNS, texts);
}

/**
 * Matches of the spam terms and the topic words in `texts`, per category.
 * @param {string[]} texts
 * @returns {Record<string, TermHits>}
 */
export function topicHits(texts) {
  return count(TOPIC_PATTERNS, texts);
}

/**
 * Letters per writing system in the first `SCRIPT_SAMPLE_CHARS` characters
 * of `text`; only systems with letters are listed, letters of any other
 * system count under `other`.
 * @param {string} text
 * @returns {Record<string, number>}
 */
export function scriptLetters(text) {
  const sample = text.slice(0, SCRIPT_SAMPLE_CHARS);
  const letters = sample.match(LETTER)?.length ?? 0;
  /** @type {Record<string, number>} */
  const counts = {};
  let known = 0;
  for (const [name, regex] of Object.entries(SCRIPTS)) {
    const found = sample.match(regex)?.length ?? 0;
    if (found > 0) counts[name] = found;
    known += found;
  }
  if (letters - known > 0) counts.other = letters - known;
  return counts;
}

/**
 * The words of a URL's host and path, for matching terms: `/cheap-viagra_online`
 * reads as "cheap viagra online". Percent escapes are decoded where they can be.
 * @param {string} url
 * @returns {string}
 */
export function urlWords(url) {
  let text = url;
  try {
    const parsed = new URL(url);
    text = `${parsed.hostname} ${parsed.pathname} ${parsed.search}`;
  } catch {
    // Matched as it is.
  }
  try {
    text = decodeURIComponent(text);
  } catch {
    // Left encoded.
  }
  return text.replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ');
}
