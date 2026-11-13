// Which cell styles of an Excel workbook show a date (ECMA-376 Part 1,
// 18.8.30 and 18.8.31), so that a number stored in a date cell is read as the
// date it shows. Nothing else of the styles part is read.

import { walkXml } from './xml.js';

/** Built-in number formats that show a date (ECMA-376 Part 1, 18.8.30): 14 to 17 and 22. */
const DATE_FORMATS = new Set([14, 15, 16, 17, 22]);

/**
 * Whether a number format code shows a day or a year: a `d` or a `y` outside
 * quoted text, brackets (colours, conditions, locales) and escaped characters.
 * Read in one pass; a pattern did the same in time quadratic in a format of
 * unclosed brackets (review of 2026-11-13).
 * @param {string} code
 * @returns {boolean}
 */
export function isDateFormat(code) {
  let quoted = false;
  let bracket = false;
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i];
    if (quoted) quoted = char !== '"';
    else if (bracket) bracket = char !== ']';
    else if (char === '"') quoted = true;
    else if (char === '[') bracket = true;
    else if (char === '\\') i += 1;
    else if (char === 'd' || char === 'D' || char === 'y' || char === 'Y') return true;
  }
  return false;
}

/**
 * Which cell styles show a date: the index of each `xf` in `cellXfs` whose
 * number format is a built-in date format or a custom format with a day or a
 * year in it, outside quoted text and brackets.
 * @param {string|null} xml
 * @returns {Set<number>}
 */
export function dateStyles(xml) {
  const styles = new Set();
  if (xml === null) return styles;
  /** @type {Set<number>} */
  const customDates = new Set();
  let inCellXfs = false;
  let index = 0;
  walkXml(xml, {
    open(name, a) {
      if (name === 'numFmt') {
        if (isDateFormat(a.formatCode ?? '')) customDates.add(Number(a.numFmtId));
      } else if (name === 'cellXfs') {
        inCellXfs = true;
      } else if (name === 'xf' && inCellXfs) {
        const id = Number(a.numFmtId ?? 0);
        if (DATE_FORMATS.has(id) || customDates.has(id)) styles.add(index);
        index += 1;
      }
    },
    close(name) {
      if (name === 'cellXfs') inCellXfs = false;
    },
  });
  return styles;
}
