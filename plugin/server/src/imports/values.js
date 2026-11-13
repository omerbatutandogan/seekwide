// Reading the cells of an export: counts, averages and dates. The exports'
// number and date formats are not documented (docs/IMPORTS.md), so only forms
// that cannot be misread are accepted: a count is digits, optionally in groups
// of three with one separator; an average is digits with at most one decimal
// mark, a dot or a comma, and never a group separator; a date is YYYY-MM-DD.

/** @typedef {import('./xlsx.js').Cell} Cell */

const GROUPED = /^\d{1,3}(?:([.,'   ])\d{3})(?:\1\d{3})*$/;
const DECIMAL = /^\d+(?:[.,]\d+)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** No search result list is that long; a larger average is not a position. */
const MAX_POSITION = 1_000_000;

/**
 * A count such as clicks or impressions: a whole number of 0 or more.
 * @param {Cell|undefined} cell
 * @returns {number|undefined} undefined when the cell holds anything else, an empty cell included.
 */
export function parseCount(cell) {
  if (typeof cell === 'number') return Number.isSafeInteger(cell) && cell >= 0 ? cell : undefined;
  const text = String(cell ?? '').trim();
  if (/^\d+$/.test(text)) {
    const value = Number(text);
    return Number.isSafeInteger(value) ? value : undefined;
  }
  if (!GROUPED.test(text)) return undefined;
  const value = Number(text.replace(/\D/g, ''));
  return Number.isSafeInteger(value) ? value : undefined;
}

/**
 * An average position: a number of 1 or more, or null when the cell is empty
 * or 0 (Search Console writes 0 where its report shows "~" or "-").
 * @param {Cell|undefined} cell
 * @returns {number|null|undefined} undefined when the cell holds anything else.
 */
export function parsePosition(cell) {
  /** @type {number} */
  let value;
  if (typeof cell === 'number') {
    value = cell;
  } else {
    const text = String(cell ?? '').trim();
    if (text === '') return null;
    if (!DECIMAL.test(text) || text.length > 20) return undefined;
    value = Number(text.replace(',', '.'));
  }
  if (!Number.isFinite(value) || value < 0 || value > MAX_POSITION) return undefined;
  return value < 1 ? null : value;
}

/**
 * A calendar date written as YYYY-MM-DD, or null.
 * @param {Cell|undefined} cell
 * @returns {string|null}
 */
export function parseDate(cell) {
  const match = ISO_DATE.exec(typeof cell === 'string' ? cell.trim() : '');
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && year >= 2000 ? match[0] : null;
}

/**
 * Whether a cell names a web page: text that starts with http:// or https://.
 * @param {Cell|undefined} cell
 * @returns {boolean}
 */
export function looksLikePageUrl(cell) {
  return typeof cell === 'string' && /^https?:\/\/\S/i.test(cell.trim());
}
