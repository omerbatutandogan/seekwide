// The stored form of a YouTube Studio import (`.seekwide/imports/<source>.json`)
// and the check every reader applies to it: a `.seekwide/` folder can arrive
// with a repository, so a file of any other form is refused as damaged. The
// problem names the field, never its value.

/** @import { YoutubeSource, YoutubeTables } from './youtube-data.js' */

import { stripHidden } from '../util/strings.js';
import { TABLE_LIMITS } from './csv.js';
import { IMPORT_MAX_BYTES } from './read-file.js';
import { NAME_CHARS, YOUTUBE_SOURCES } from './youtube-data.js';
import { parseDate } from './values.js';

export const YOUTUBE_IMPORT_SCHEMA_VERSION = 1;

/**
 * @typedef {YoutubeTables & {
 *   schema_version: 1, source: YoutubeSource, imported_at: string,
 *   file: {path: string, format: 'csv'|'zip'|'xlsx', bytes: number, sha256: string},
 * }} YoutubeImport
 *   One export of YouTube Studio's traffic sources or of its YouTube search terms.
 */

const TOP_KEYS = ['schema_version', 'source', 'imported_at', 'file', 'period', 'total', 'rows', 'truncated_at', 'counts'];
const BREAKS = /[\t\n\r\u2028\u2029]/;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_HOURS = 1e9;

/** @param {unknown} value */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value */
const isCount = (value) => Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
/** @param {unknown} value */
const isHours = (value) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_HOURS);
/** @param {unknown} value @param {string[]} keys */
const hasKeys = (value, keys) => isObject(value) && Object.keys(/** @type {object} */ (value)).length === keys.length && keys.every((key) => Object.hasOwn(/** @type {object} */ (value), key));
/** @param {unknown} value @param {number} max */
const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && stripHidden(value) === value && !BREAKS.test(value) && value.trim() === value;
/** @param {unknown} value */
const isTime = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

/**
 * @param {unknown} value
 * @param {YoutubeSource} source
 * @returns {string|null}
 */
export function youtubeImportProblem(value, source) {
  if (!YOUTUBE_SOURCES.includes(source)) return 'the source is not a YouTube Studio export';
  if (!hasKeys(value, TOP_KEYS)) return 'the file has fields the plugin does not write, or lacks some';
  const data = /** @type {Record<string, any>} */ (value);
  if (data.schema_version !== YOUTUBE_IMPORT_SCHEMA_VERSION) return 'schema_version is not one this version reads';
  if (data.source !== source) return 'source does not match the file name';
  if (!isTime(data.imported_at)) return 'imported_at is not a date';
  const file = data.file;
  if (!hasKeys(file, ['path', 'format', 'bytes', 'sha256']) || !isText(file.path, 300) || !['csv', 'zip', 'xlsx'].includes(file.format) || !isCount(file.bytes) || file.bytes > IMPORT_MAX_BYTES || !SHA256.test(String(file.sha256))) {
    return 'file is not a valid description of the imported file';
  }
  const period = data.period;
  if (!(period === null || (hasKeys(period, ['start', 'end']) && parseDate(period.start) === period.start && parseDate(period.end) === period.end && period.start <= period.end))) return 'period is not valid';
  if (!hasKeys(data.total, ['views', 'watch_hours']) || !isCount(data.total.views) || !isHours(data.total.watch_hours)) return 'total is not valid';
  if (!Array.isArray(data.rows) || data.rows.length === 0 || data.rows.length > TABLE_LIMITS.maxRows) return 'rows is not a list';
  /** @type {Set<string>} */
  const names = new Set();
  let last = null;
  for (const row of data.rows) {
    if (!hasKeys(row, ['name', 'views', 'watch_hours']) || !isText(row.name, NAME_CHARS) || !isCount(row.views) || !isHours(row.watch_hours)) return 'rows has an entry that is not valid';
    if (names.has(row.name)) return 'rows names an entry twice';
    if (last !== null && (row.views > last.views || (row.views === last.views && row.name <= last.name))) return 'rows are not in order';
    names.add(row.name);
    last = row;
  }
  if (!(data.truncated_at === null || (isCount(data.truncated_at) && data.truncated_at > 0))) return 'truncated_at is not valid';
  const counts = data.counts;
  if (!hasKeys(counts, ['tables', 'other_tables', 'skipped_rows', 'merged_rows']) || !['tables', 'other_tables', 'skipped_rows', 'merged_rows'].every((key) => isCount(counts[key])) || counts.other_tables >= counts.tables) {
    return 'counts does not hold valid numbers';
  }
  return null;
}
