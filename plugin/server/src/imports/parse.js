// From the bytes of an export file to the record Seekwide stores: a CSV file,
// a ZIP archive of CSV files (Search Console's CSV download) or an Excel
// workbook (.xlsx). What kind of file it is comes from its content, not its name.

/** @import { Cell } from './xlsx.js' */
/** @import { SearchTables } from './search-data.js' */

import { createHash } from 'node:crypto';
import { clip, collapseWhitespace } from '../util/strings.js';
import { TABLE_LIMITS, decodeText, parseCsv } from './csv.js';
import { ImportError } from './errors.js';
import { searchTables } from './search-data.js';
import { readWorkbook } from './xlsx.js';
import { looksLikeZip, openZip } from './zip.js';

export const IMPORT_SCHEMA_VERSION = 1;
export const IMPORT_SOURCES = /** @type {const} */ (['google_search_console', 'bing_webmaster_tools']);
/** @typedef {typeof IMPORT_SOURCES[number]} ImportSource */

/** CSV files read from one archive. Search Console's download holds seven. */
const MAX_CSV_FILES = 20;

/**
 * @typedef {SearchTables & {
 *   schema_version: number, source: ImportSource, imported_at: string,
 *   file: {path: string, format: 'csv'|'zip'|'xlsx', bytes: number, sha256: string},
 *   period: {start: string, end: string, from: 'file'|'user'}|null,
 * }} SearchImport
 *   One imported export, as stored at `.seekwide/imports/<source>.json`. `period` comes from the export's table
 *   of dates (`file`), or from the dates the user said the export covers (`user`), or is null.
 */

/**
 * The tables of a file, and its format.
 * @param {Buffer} bytes
 * @returns {Promise<{format: 'csv'|'zip'|'xlsx', tables: {rows: Cell[][]}[]}>}
 */
export async function readTables(bytes) {
  if (!looksLikeZip(bytes)) return { format: 'csv', tables: [{ rows: parseCsv(decodeText(bytes), TABLE_LIMITS) }] };
  const zip = openZip(bytes);
  if (zip.names.includes('xl/workbook.xml') || zip.names.includes('[Content_Types].xml')) {
    return { format: 'xlsx', tables: await readWorkbook(zip, TABLE_LIMITS) };
  }
  // A folder, and the resource forks macOS adds when it compresses a folder, are not tables.
  const csvNames = zip.names.filter((name) => /\.csv$/i.test(name) && !name.startsWith('__MACOSX/') && !/(^|\/)\._/.test(name));
  if (csvNames.length === 0) throw new ImportError('UNSUPPORTED', 'The archive holds no CSV file and is not an Excel workbook.');
  if (csvNames.length > MAX_CSV_FILES) throw new ImportError('LIMIT', `The archive holds more than ${MAX_CSV_FILES} CSV files; an export holds seven or eight.`);
  /** @type {{rows: Cell[][]}[]} */
  const tables = [];
  let cells = 0;
  for (const name of csvNames) {
    const data = /** @type {Buffer} */ (await zip.read(name));
    // The cells of all tables share one budget, so twenty wide tables cannot hold twenty times as much.
    const rows = data.length === 0 ? [] : parseCsv(decodeText(data), TABLE_LIMITS, cells);
    cells += rows.reduce((sum, row) => sum + row.length, 0);
    tables.push({ rows });
  }
  return { format: 'zip', tables };
}

/**
 * Read an export and build the record to store.
 *
 * Guarantees: deterministic for the same bytes and arguments; `period` is the
 * first and last date of the export's table of dates when it has one, else the
 * period the caller states, else null. Throws an `ImportError` for a file that
 * cannot be read as a search performance export.
 * @param {{bytes: Buffer, path: string, source: ImportSource, importedAt: string, period?: {start: string, end: string}}} input
 * @returns {Promise<SearchImport>}
 */
export async function importExport({ bytes, path, source, importedAt, period }) {
  const { format, tables } = await readTables(bytes);
  const data = searchTables(tables);
  /** @type {SearchImport['period']} */
  let range = null;
  if (data.dates.length > 0) range = { start: data.dates[0].date, end: /** @type {{date: string}} */ (data.dates.at(-1)).date, from: 'file' };
  else if (period) range = { ...period, from: 'user' };
  return {
    schema_version: IMPORT_SCHEMA_VERSION,
    source,
    imported_at: importedAt,
    file: { path: clip(collapseWhitespace(path), 300), format, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    period: range,
    ...data,
  };
}
