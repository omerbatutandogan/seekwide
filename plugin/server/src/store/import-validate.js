// What a stored search data import must look like before a tool or a report
// uses it. A `.seekwide/` folder can arrive with a repository someone else
// wrote, so an import file is untrusted input like a run: every value is
// checked against the form the plugin writes, and a file with any other form
// is refused as damaged. The problem names the field, never its value.

/** @import { ImportSource, SearchImport } from '../imports/parse.js' */

import { TABLE_LIMITS } from '../imports/csv.js';
import { IMPORT_SCHEMA_VERSION } from '../imports/parse.js';
import { IMPORT_MAX_BYTES } from '../imports/read-file.js';
import { comparePages, weightedPosition } from '../imports/search-data.js';
import { parseDate } from '../imports/values.js';
import { stripHidden } from '../util/strings.js';
import { MAX_URL_LENGTH, normalizeUrl } from '../util/url.js';

const SHA256 = /^[0-9a-f]{64}$/;
/** Line breaks and tabs, which the import turns into spaces. */
const BREAKS = /[\t\n\r\u2028\u2029]/;
const MAX_POSITION = 1_000_000;
const TOP_KEYS = ['schema_version', 'source', 'imported_at', 'file', 'period', 'pages', 'dates', 'filters', 'totals', 'counts'];

/** @param {unknown} value */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value */
const isCount = (value) => Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
/** @param {unknown} value */
const isPosition = (value) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= MAX_POSITION);
/**
 * Whether an object has exactly the given keys, so a planted file cannot carry anything the plugin does not write.
 * @param {unknown} value
 * @param {string[]} keys
 */
const hasKeys = (value, keys) => isObject(value) && Object.keys(/** @type {object} */ (value)).length === keys.length && keys.every((key) => Object.hasOwn(/** @type {object} */ (value), key));
/**
 * Text as the import writes it: clipped, on one line, without the characters `stripHidden` removes. Format
 * characters a script needs, such as the zero-width non-joiner of Persian, stay (review of 2026-11-13).
 * @param {unknown} value @param {number} max
 */
const isText = (value, max) => typeof value === 'string' && value.length <= max && stripHidden(value) === value && !BREAKS.test(value);
/** @param {unknown} value  The form `Date.prototype.toISOString` writes, of a date that exists. */
const isTime = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
/** @param {unknown} value */
const isDate = (value) => typeof value === 'string' && parseDate(value) === value;

/**
 * @param {unknown} rows
 * @param {'url'|'date'} key
 * @returns {string|null}
 */
function rowsProblem(rows, key) {
  if (!Array.isArray(rows) || rows.length > TABLE_LIMITS.maxRows) return 'is not a list of rows';
  let previous = '';
  for (const row of rows) {
    if (!hasKeys(row, [key, 'clicks', 'impressions', 'position']) || !isCount(row.clicks) || !isCount(row.impressions) || !isPosition(row.position)) return 'has a row without valid numbers';
    if (key === 'url') {
      if (typeof row.url !== 'string' || row.url.length > MAX_URL_LENGTH || normalizeUrl(row.url) !== row.url) return 'has a row whose address is not a normalized http(s) URL';
    } else {
      if (!isDate(row.date) || row.date <= previous) return 'has dates that are not valid, unique and in order';
      previous = row.date;
    }
  }
  return null;
}

/**
 * The first problem of a stored import, as "<field> <what is wrong>", or null
 * when it has the form the plugin writes.
 * @param {unknown} value
 * @param {ImportSource} source  The source the file name says it holds.
 * @returns {string|null}
 */
export function importProblem(value, source) {
  if (!isObject(value)) return 'the file is not a JSON object';
  if (!hasKeys(value, TOP_KEYS)) return 'the file has fields the plugin does not write, or lacks some';
  const data = /** @type {Record<string, any>} */ (value);
  if (data.schema_version !== IMPORT_SCHEMA_VERSION) return 'schema_version is not one this version reads';
  if (data.source !== source) return 'source does not match the file name';
  if (!isTime(data.imported_at)) return 'imported_at is not a date';
  const file = data.file;
  if (!hasKeys(file, ['path', 'format', 'bytes', 'sha256']) || !isText(file.path, 300) || !['csv', 'zip', 'xlsx'].includes(file.format) || !isCount(file.bytes) || file.bytes > IMPORT_MAX_BYTES || !SHA256.test(String(file.sha256))) {
    return 'file is not a valid description of the imported file';
  }
  const period = data.period;
  if (period !== null) {
    if (!hasKeys(period, ['start', 'end', 'from']) || !isDate(period.start) || !isDate(period.end) || period.start > period.end || !['file', 'user'].includes(period.from)) {
      return 'period is not a valid range of dates';
    }
  }
  if (!Array.isArray(data.filters) || data.filters.length > 20 || !data.filters.every((row) => hasKeys(row, ['name', 'value']) && isText(row.name, 200) && isText(row.value, 200))) {
    return 'filters is not a list of short texts';
  }
  const totals = data.totals;
  if (!hasKeys(totals, ['clicks', 'impressions', 'position', 'from']) || !isCount(totals.clicks) || !isCount(totals.impressions) || !isPosition(totals.position) || !['dates', 'pages'].includes(totals.from)) {
    return 'totals does not hold valid numbers';
  }
  const pages = rowsProblem(data.pages, 'url');
  if (pages !== null || data.pages.length === 0) return `pages ${pages ?? 'is empty'}`;
  const dates = rowsProblem(data.dates, 'date');
  if (dates !== null) return `dates ${dates}`;
  const counts = data.counts;
  const countKeys = ['tables', 'other_tables', 'skipped_pages', 'merged_pages'];
  if (!hasKeys(counts, countKeys) || !countKeys.every((key) => isCount(counts[key]))) return 'counts does not hold valid numbers';
  return consistencyProblem(data);
}

/**
 * Whether the parts of an import agree as the import writes them: totals are the sums of the dates, or of the
 * pages when there are no dates; pages are in the import's order with no address twice; a period from the file
 * is its first and last date. A file that was edited by hand without care fails here (review of 2026-11-13);
 * one edited with care cannot be told from an export, as SECURITY.md says.
 * @param {Record<string, any>} data  Of the form `importProblem` checked.
 * @returns {string|null}
 */
function consistencyProblem(data) {
  const from = data.dates.length > 0 ? data.dates : data.pages;
  const sum = (/** @type {string} */ key) => from.reduce((/** @type {number} */ total, /** @type {any} */ row) => total + row[key], 0);
  if (data.totals.from !== (data.dates.length > 0 ? 'dates' : 'pages') || data.totals.clicks !== sum('clicks') || data.totals.impressions !== sum('impressions') ||
    data.totals.position !== weightedPosition(from)) {
    return 'totals do not match the rows';
  }
  for (let i = 1; i < data.pages.length; i += 1) {
    if (comparePages(data.pages[i - 1], data.pages[i]) >= 0) return 'pages are not in order or name an address twice';
  }
  const period = data.period;
  const fromFile = data.dates.length > 0;
  if (fromFile !== (period?.from === 'file') || (fromFile && (period.start !== data.dates[0].date || period.end !== data.dates.at(-1).date))) {
    return 'period does not match the dates';
  }
  return null;
}

/**
 * @param {unknown} value
 * @param {ImportSource} source
 * @returns {value is SearchImport}
 */
export function isSearchImport(value, source) {
  return importProblem(value, source) === null;
}
