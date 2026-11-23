// The stored form of an AI report import (`.seekwide/imports/<source>.json`)
// and the check every reader applies to it: a `.seekwide/` folder can arrive
// with a repository, so a file of any other form is refused as damaged. The
// problem names the field, never its value.

/** @import { AiSource, AiTables } from './ai-data.js' */

import { stripHidden } from '../util/strings.js';
import { MAX_URL_LENGTH, normalizeUrl } from '../util/url.js';
import { AI_SOURCES } from './ai-data.js';
import { TABLE_LIMITS } from './csv.js';
import { IMPORT_MAX_BYTES } from './read-file.js';
import { parseDate } from './values.js';

export const AI_IMPORT_SCHEMA_VERSION = 1;

/**
 * @typedef {AiTables & {
 *   schema_version: 1, source: AiSource, imported_at: string,
 *   file: {path: string, format: 'csv'|'zip'|'xlsx', bytes: number, sha256: string},
 *   period: {start: string, end: string, from: 'file'|'user'}|null,
 * }} AiImport
 *   One imported AI report. `period` is the first and last day of its table of dates (`file`), or the dates the user
 *   said the export covers (`user`, Bing's table of pages, which has no dates), or null.
 */

const TOP_KEYS = ['schema_version', 'source', 'imported_at', 'file', 'period', 'dates', 'pages', 'filters', 'totals', 'counts'];
const BREAKS = /[\t\n\r\u2028\u2029]/;
const SHA256 = /^[0-9a-f]{64}$/;

/** @param {unknown} value */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value */
const isCount = (value) => Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
/** @param {unknown} value @param {string[]} keys */
const hasKeys = (value, keys) => isObject(value) && Object.keys(/** @type {object} */ (value)).length === keys.length && keys.every((key) => Object.hasOwn(/** @type {object} */ (value), key));
/** @param {unknown} value @param {number} max */
const isText = (value, max) => typeof value === 'string' && value.length <= max && stripHidden(value) === value && !BREAKS.test(value);
/** @param {unknown} value */
const isTime = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
/** @param {unknown} value */
const isDate = (value) => typeof value === 'string' && parseDate(value) === value;

/**
 * @param {unknown} value
 * @param {AiSource} source
 * @returns {string|null}
 */
export function aiImportProblem(value, source) {
  if (!AI_SOURCES.includes(source)) return 'the source is not an AI report';
  if (!hasKeys(value, TOP_KEYS)) return 'the file has fields the plugin does not write, or lacks some';
  const data = /** @type {Record<string, any>} */ (value);
  if (data.schema_version !== AI_IMPORT_SCHEMA_VERSION) return 'schema_version is not one this version reads';
  if (data.source !== source) return 'source does not match the file name';
  if (!isTime(data.imported_at)) return 'imported_at is not a date';
  const file = data.file;
  if (!hasKeys(file, ['path', 'format', 'bytes', 'sha256']) || !isText(file.path, 300) || !['csv', 'zip', 'xlsx'].includes(file.format) || !isCount(file.bytes) || file.bytes > IMPORT_MAX_BYTES || !SHA256.test(String(file.sha256))) {
    return 'file is not a valid description of the imported file';
  }
  const google = source === 'google_search_console_ai';
  const overview = source === 'bing_ai_performance';
  const byDate = source !== 'bing_ai_pages';
  const dateKeys = google ? ['date', 'impressions'] : ['date', 'citations', 'cited_pages'];
  if (!Array.isArray(data.dates) || data.dates.length > TABLE_LIMITS.maxRows || (data.dates.length === 0) === byDate) return 'dates is not a list of days';
  let previous = '';
  for (const row of data.dates) {
    if (!hasKeys(row, dateKeys) || !isDate(row.date) || row.date <= previous || !dateKeys.slice(1).every((key) => isCount(row[key]))) return 'dates has a row that is not valid, unique and in order';
    if (!google && row.cited_pages > row.citations) return 'dates has more cited pages than citations';
    previous = row.date;
  }
  const period = data.period;
  if (byDate) {
    if (!hasKeys(period, ['start', 'end', 'from']) || period.from !== 'file' || period.start !== data.dates[0].date || period.end !== previous) return 'period does not match the dates';
  } else if (period !== null && (!hasKeys(period, ['start', 'end', 'from']) || period.from !== 'user' || !isDate(period.start) || !isDate(period.end) || period.start > period.end)) {
    return 'period is not a valid range of dates';
  }
  const metric = google ? 'impressions' : 'citations';
  if (!Array.isArray(data.pages) || data.pages.length > TABLE_LIMITS.maxRows || (overview && data.pages.length > 0) || (source === 'bing_ai_pages' && data.pages.length === 0)) return 'pages is not a list of pages';
  let last = null;
  for (const page of data.pages) {
    if (!hasKeys(page, ['url', metric]) || !isCount(page[metric]) || typeof page.url !== 'string' || page.url.length > MAX_URL_LENGTH || normalizeUrl(page.url) !== page.url) {
      return `pages has a row whose address is not a normalized http(s) URL or whose ${metric} are not a count`;
    }
    if (last !== null && (page[metric] > last[metric] || (page[metric] === last[metric] && page.url <= last.url))) return 'pages are not in order or name an address twice';
    last = page;
  }
  if (!Array.isArray(data.filters) || data.filters.length > 20 || (!google && data.filters.length > 0) || !data.filters.every((row) => hasKeys(row, ['name', 'value']) && isText(row.name, 200) && isText(row.value, 200))) {
    return 'filters is not a list of short texts';
  }
  const sum = (/** @type {any[]} */ rows, /** @type {string} */ key) => rows.reduce((/** @type {number} */ total, /** @type {any} */ row) => total + row[key], 0);
  const totals = data.totals;
  if (google) {
    if (!hasKeys(totals, ['impressions']) || totals.impressions !== sum(data.dates, 'impressions')) return 'totals do not match the dates';
  } else if (overview) {
    if (!hasKeys(totals, ['citations', 'peak_cited_pages', 'days_cited']) || totals.citations !== sum(data.dates, 'citations') ||
      totals.peak_cited_pages !== Math.max(...data.dates.map((/** @type {any} */ row) => row.cited_pages)) ||
      totals.days_cited !== data.dates.filter((/** @type {any} */ row) => row.citations > 0).length) {
      return 'totals do not match the dates';
    }
  } else if (!hasKeys(totals, ['citations', 'pages_cited']) || totals.citations !== sum(data.pages, 'citations') || totals.pages_cited !== data.pages.filter((/** @type {any} */ row) => row.citations > 0).length) {
    return 'totals do not match the pages';
  }
  const counts = data.counts;
  if (!hasKeys(counts, ['tables', 'other_tables', 'skipped_pages']) || !isCount(counts.tables) || !isCount(counts.other_tables) || !isCount(counts.skipped_pages)) return 'counts does not hold valid numbers';
  return null;
}
