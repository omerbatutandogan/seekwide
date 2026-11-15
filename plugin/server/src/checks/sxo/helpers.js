// Questions the sxo checks share (search experience). Pure.

/** @import { PageRecord } from '../../types.js' */

/** The date every rule of this module was read against its documentation. */
export const VERIFIED = '2026-11-14';

/** Fields that are the same for every sxo check. */
export const SXO = Object.freeze({
  module: /** @type {const} */ ('sxo'),
  engine: /** @type {const} */ ('code'),
  last_verified: VERIFIED,
});

/** Official documentation the rules are based on (CHECKS-SPEC, reference list). */
export const DOCS = Object.freeze({
  TITLE: 'https://developers.google.com/search/docs/appearance/title-link',
  GOOGLE_INTERSTITIALS: 'https://developers.google.com/search/docs/appearance/avoid-intrusive-interstitials',
  AXE_META_VIEWPORT: 'https://dequeuniversity.com/rules/axe/4.10/meta-viewport',
});

/** Separators that split a title wherever they stand. */
const ALWAYS = new Set(['|', '·', '•', '–', '—']);
/** Separators only with a space on at least one side: "e-commerce", "1/2" and "10:30" are words. */
const SPACED = new Set(['-', ':', '/']);

/**
 * The parts of a title between its separators, trimmed, empty parts included.
 * Adjacent separators ("||", "--") are one; separators with only spaces
 * between them leave an empty part.
 * @param {string} title
 * @returns {string[]}
 */
export function titleParts(title) {
  const chars = [...title];
  /** @type {string[]} */
  const parts = [];
  let current = '';
  let lastWasSeparator = false;
  chars.forEach((char, i) => {
    const space = (/** @type {string|undefined} */ c) => c !== undefined && /\s/.test(c);
    const separator = ALWAYS.has(char) || (SPACED.has(char) && (space(chars[i - 1]) || space(chars[i + 1])));
    if (!separator) {
      current += char;
      lastWasSeparator = false;
      return;
    }
    if (!lastWasSeparator) {
      parts.push(current.trim());
      current = '';
    }
    lastWasSeparator = true;
  });
  parts.push(current.trim());
  return parts;
}

/**
 * The first `<h1>` of a page with text, or null.
 * @param {PageRecord} page
 */
export const firstH1 = (page) => page.headings.find((heading) => heading.level === 1 && heading.text.trim() !== '')?.text ?? null;

/**
 * The first title of a page, trimmed, or null when it has none with text.
 * @param {PageRecord} page
 */
export function firstTitle(page) {
  const title = page.titles[0]?.trim() ?? '';
  return title === '' ? null : title;
}

/**
 * Lower case without accents, for comparing words: "İletişim" reads "iletisim".
 * @param {string} value
 */
export const fold = (value) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
