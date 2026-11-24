// The stored form of a Links report import (`.seekwide/imports/<source>.json`)
// and the check every reader applies to it: a `.seekwide/` folder can arrive
// with a repository, so a file of any other form is refused as damaged. The
// problem names the field, never its value.

/** @import { LinkSource, LinkTables } from './links-data.js' */

import { stripHidden } from '../util/strings.js';
import { MAX_URL_LENGTH, normalizeUrl } from '../util/url.js';
import { TABLE_LIMITS } from './csv.js';
import { LINK_SOURCES } from './links-data.js';
import { IMPORT_MAX_BYTES } from './read-file.js';
import { parseDate } from './values.js';

export const LINK_IMPORT_SCHEMA_VERSION = 1;

/**
 * @typedef {LinkTables & {
 *   schema_version: 1, source: LinkSource, imported_at: string,
 *   file: {path: string, format: 'csv'|'zip'|'xlsx', bytes: number, sha256: string},
 * }} LinkImport
 *   One imported table of Search Console's Links report. The report states no period: it is what Google knew when it
 *   was exported.
 */

const TOP_KEYS = ['schema_version', 'source', 'imported_at', 'file', 'targets', 'linking', 'counts'];
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
const isUrl = (value) => typeof value === 'string' && value.length <= MAX_URL_LENGTH && normalizeUrl(value) === value;

/**
 * @param {unknown} value
 * @param {LinkSource} source
 * @returns {string|null}
 */
export function linkImportProblem(value, source) {
  if (!LINK_SOURCES.includes(source)) return 'the source is not a Links report';
  if (!hasKeys(value, TOP_KEYS)) return 'the file has fields the plugin does not write, or lacks some';
  const data = /** @type {Record<string, any>} */ (value);
  if (data.schema_version !== LINK_IMPORT_SCHEMA_VERSION) return 'schema_version is not one this version reads';
  if (data.source !== source) return 'source does not match the file name';
  if (!isTime(data.imported_at)) return 'imported_at is not a date';
  const file = data.file;
  if (!hasKeys(file, ['path', 'format', 'bytes', 'sha256']) || !isText(file.path, 300) || !['csv', 'zip', 'xlsx'].includes(file.format) || !isCount(file.bytes) || file.bytes > IMPORT_MAX_BYTES || !SHA256.test(String(file.sha256))) {
    return 'file is not a valid description of the imported file';
  }
  const top = source === 'google_search_console_links';
  if (!Array.isArray(data.targets) || data.targets.length > TABLE_LIMITS.maxRows || (data.targets.length === 0) === top) return 'targets is not a list of pages';
  let last = null;
  for (const row of data.targets) {
    if (!hasKeys(row, ['url', 'links', 'sites']) || !isUrl(row.url) || !isCount(row.links) || !isCount(row.sites) || row.sites > row.links) {
      return 'targets has a row whose address is not a normalized http(s) URL or whose counts are not valid';
    }
    if (last !== null && (row.links > last.links || (row.links === last.links && row.url <= last.url))) return 'targets are not in order or name an address twice';
    last = row;
  }
  if (!Array.isArray(data.linking) || data.linking.length > TABLE_LIMITS.maxRows || (data.linking.length === 0) !== top) return 'linking is not a list of pages';
  let previous = null;
  for (const row of data.linking) {
    if (!hasKeys(row, ['url', 'last_crawled']) || !isUrl(row.url) || parseDate(row.last_crawled) !== row.last_crawled) {
      return 'linking has a row whose address is not a normalized http(s) URL or whose date is not valid';
    }
    if (previous !== null && (row.last_crawled > previous.last_crawled || (row.last_crawled === previous.last_crawled && row.url <= previous.url))) return 'linking is not in order or names an address twice';
    previous = row;
  }
  const counts = data.counts;
  if (!hasKeys(counts, ['tables', 'other_tables', 'skipped_rows', 'merged_rows']) || !['tables', 'other_tables', 'skipped_rows', 'merged_rows'].every((key) => isCount(counts[key]))) {
    return 'counts does not hold valid numbers';
  }
  return null;
}
