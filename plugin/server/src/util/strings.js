/** Control characters, direction controls and invisible format characters, checked one by one by `visible`. */
const HIDDEN = /[\p{Cc}\p{Cf}]/gu;
const BIDI = /\p{Bidi_Control}/u;
const FIRST_TAG = 0xe0000;

/**
 * What remains of one matched character: tab, line feed and carriage return
 * stay; other control characters, direction controls and Unicode tag
 * characters (U+E0000 and up) go; other format characters (such as the
 * zero-width joiner in emoji) stay.
 * @param {string} char
 * @returns {string}
 */
function visible(char) {
  if (char === '\t' || char === '\n' || char === '\r') return char;
  if (BIDI.test(char)) return '';
  const code = /** @type {number} */ (char.codePointAt(0));
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return '';
  return code >= FIRST_TAG ? '' : char;
}

/**
 * `value` without the characters a person cannot see but a model reads:
 * control characters other than tab and line breaks, direction overrides and
 * Unicode tag characters. A page could hide text in them, or make a report
 * read differently from what it says.
 * @param {string} value
 * @returns {string}
 */
export function stripHidden(value) {
  return value.replace(HIDDEN, visible);
}

/**
 * Collapse runs of whitespace to single spaces and trim, removing the
 * characters `stripHidden` removes.
 * @param {string} value
 * @returns {string}
 */
export function collapseWhitespace(value) {
  return stripHidden(value.replace(/\s+/g, ' ')).trim();
}

/**
 * Cut a string to at most `max` characters, marking the cut with an ellipsis,
 * and remove what `stripHidden` removes. Page-derived strings are clipped
 * before they are stored or returned so one oversized attribute cannot bloat a
 * report or a tool result, or hide text in it.
 * @param {string} value
 * @param {number} [max]
 * @returns {string}
 */
export function clip(value, max = 300) {
  if (value.length <= max) return stripHidden(value);
  return `${stripHidden(value.slice(0, Math.max(0, max - 1)))}…`;
}
