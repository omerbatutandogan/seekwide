// From the tables of an export to the record Seekwide keeps: the pages with
// their clicks, impressions and average position, the daily figures when the
// export has them, the export's own record of its filters, and totals.

/** @import { Cell } from './xlsx.js' */
/** @import { Metric, TableShape } from './columns.js' */

import { normalizeUrl } from '../util/url.js';
import { clip, collapseWhitespace } from '../util/strings.js';
import { KNOWN_HEADERS, tableShape } from './columns.js';
import { ImportError, malformed } from './errors.js';
import { parseCount, parseDate, parsePosition } from './values.js';

/** @typedef {{url: string, clicks: number, impressions: number, position: number|null}} PageRow */
/** @typedef {{date: string, clicks: number, impressions: number, position: number|null}} DateRow */
/** @typedef {{name: string, value: string}} FilterRow */

const MAX_FILTERS = 20;
const FILTER_CHARS = 200;

/** @param {Cell[]} row */
const isBlank = (row) => row.every((cell) => cell === '' || cell === undefined);

/**
 * @typedef {Object} SearchTables
 * @property {PageRow[]} pages      One row per address, most clicks first, then most impressions, then by address.
 * @property {DateRow[]} dates      Oldest first; empty when the export has no table of dates.
 * @property {FilterRow[]} filters  As the export states them, clipped.
 * @property {{clicks: number, impressions: number, position: number|null, from: 'dates'|'pages'}} totals
 * @property {{tables: number, other_tables: number, skipped_pages: number, merged_pages: number}} counts
 *   `skipped_pages`: rows whose address is not one Seekwide can use (longer than 2,048 characters, for example);
 *   `merged_pages`: rows that named an address another row named too once normalized (a tracking parameter removed).
 */

/**
 * The numbers of one row of a table of pages or dates. A row with a value
 * beyond the header's columns is refused: a decimal comma written without
 * quotes in a comma-separated file splits a number in two and shifts every
 * column after it, which would otherwise be read as other numbers.
 * @param {Cell[]} row
 * @param {TableShape} shape
 * @param {string} where  "row 12 of the table of pages", for messages.
 */
function rowNumbers(row, shape, where) {
  // Even an empty cell past the header counts: "1,234," split in two leaves one (review of 2026-11-13).
  if (row.length > shape.width) throw malformed(`${where} has more cells than the table has columns (a decimal comma without quotes splits a number in two)`);
  const metrics = /** @type {Record<Metric, number>} */ (shape.metrics);
  const clicks = parseCount(row[metrics.clicks]);
  const impressions = parseCount(row[metrics.impressions]);
  const position = metrics.position === undefined ? null : parsePosition(row[metrics.position]);
  if (clicks === undefined) throw malformed(`in ${where}, column ${metrics.clicks + 1} (clicks) is not a whole number`);
  if (impressions === undefined) throw malformed(`in ${where}, column ${metrics.impressions + 1} (impressions) is not a whole number`);
  if (position === undefined) throw malformed(`in ${where}, column ${/** @type {number} */ (metrics.position) + 1} (position) is not a number`);
  return { clicks, impressions, position };
}

/**
 * How many pages of an import have more clicks than impressions, as the export states them; their
 * click-through rate is over 100%.
 * @param {{pages: PageRow[]}} data
 * @returns {number}
 */
export const clicksOverImpressions = (data) => data.pages.filter((page) => page.clicks > page.impressions).length;

/**
 * The order of pages in an import: most clicks, then most impressions, then by address.
 * @param {PageRow} a
 * @param {PageRow} b
 * @returns {number}
 */
export function comparePages(a, b) {
  return b.clicks - a.clicks || b.impressions - a.impressions || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
}

/**
 * Impression-weighted average of positions; null when no row with impressions has one.
 * @param {{impressions: number, position: number|null}[]} rows
 * @returns {number|null}
 */
export function weightedPosition(rows) {
  let weight = 0;
  let sum = 0;
  for (const row of rows) {
    if (row.position === null || row.impressions === 0) continue;
    weight += row.impressions;
    sum += row.position * row.impressions;
  }
  return weight === 0 ? null : Math.round((sum / weight) * 100) / 100;
}

/**
 * @param {Cell[][]} rows
 * @param {TableShape} shape
 * @returns {{pages: PageRow[], skipped: number, merged: number}}
 */
function readPages(rows, shape) {
  /** @type {Map<string, PageRow & {rows: number, sum: number, weight: number}>} */
  const byUrl = new Map();
  let skipped = 0;
  let merged = 0;
  rows.slice(1).forEach((row, index) => {
    if (isBlank(row)) return;
    const numbers = rowNumbers(row, shape, `row ${index + 2} of the table of pages`);
    const url = normalizeUrl(String(row[shape.key] ?? '').trim());
    if (url === null) {
      skipped += 1;
      return;
    }
    // Running sums keep the merge linear; the weighted position is worked out once at the end.
    const weighted = numbers.position !== null && numbers.impressions > 0;
    const sum = weighted ? /** @type {number} */ (numbers.position) * numbers.impressions : 0;
    const weight = weighted ? numbers.impressions : 0;
    const known = byUrl.get(url);
    if (known) {
      merged += 1;
      known.clicks += numbers.clicks;
      known.impressions += numbers.impressions;
      known.rows += 1;
      known.sum += sum;
      known.weight += weight;
      if (!Number.isSafeInteger(known.clicks) || !Number.isSafeInteger(known.impressions)) throw malformed('the rows of one page add up to more than a number Seekwide can count exactly');
    } else {
      byUrl.set(url, { url, ...numbers, rows: 1, sum, weight });
    }
  });
  const pages = [...byUrl.values()]
    .map(({ url, clicks, impressions, position, rows: count, sum, weight }) => ({
      url, clicks, impressions, position: count === 1 ? position : weight === 0 ? null : Math.round((sum / weight) * 100) / 100,
    }))
    .sort(comparePages);
  return { pages, skipped, merged };
}

/**
 * @param {Cell[][]} rows
 * @param {TableShape} shape
 * @returns {DateRow[]}
 */
function readDates(rows, shape) {
  /** @type {Map<string, DateRow>} */
  const byDate = new Map();
  rows.slice(1).forEach((row, index) => {
    if (isBlank(row)) return;
    const where = `row ${index + 2} of the table of dates`;
    const date = parseDate(row[shape.key]);
    if (date === null) throw malformed(`${where} has no date`);
    if (byDate.has(date)) throw malformed(`${where} repeats a date`);
    byDate.set(date, { date, ...rowNumbers(row, shape, where) });
  });
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * The rows of a filters table after its header, as name and value, clipped.
 * @param {Cell[][]} rows
 * @returns {FilterRow[]}
 */
function readFilters(rows) {
  const text = (/** @type {Cell|undefined} */ cell) => clip(collapseWhitespace(String(cell ?? '')), FILTER_CHARS);
  return rows.slice(1, MAX_FILTERS + 1).map((row) => ({ name: text(row[0]), value: text(row[1]) })).filter((row) => row.name !== '' || row.value !== '');
}

/**
 * Turn the tables of an export into the data Seekwide keeps.
 *
 * Guarantees: exactly one table of pages (see `tableShape`) and at most one of
 * dates, else an `ImportError` that says what is missing or ambiguous; every
 * count is a whole number of 0 or more and every position 1 or more or null,
 * else an `ImportError` naming the table, row and column, never the value; the
 * totals are the sums of the table of dates when there is one (Search Console
 * aggregates it by property, like its own totals), otherwise of the table of
 * pages, with the position weighted by impressions.
 * @param {{rows: Cell[][]}[]} tables
 * @returns {SearchTables}
 */
export function searchTables(tables) {
  const shaped = tables.filter((table) => table.rows.length > 0).map((table) => ({ rows: table.rows, shape: tableShape(table.rows) }));
  const duplicated = shaped.find((table) => table.shape.duplicated.length > 0);
  if (duplicated) throw malformed(`a table names the same metric in two columns (column ${duplicated.shape.duplicated[0]})`);
  const pageTables = shaped.filter((table) => table.shape.kind === 'pages');
  const dateTables = shaped.filter((table) => table.shape.kind === 'dates');
  if (pageTables.length === 0) {
    throw new ImportError(
      'UNSUPPORTED',
      'The file has no table of pages: a column of page addresses with a clicks and an impressions column. ' +
        `Seekwide knows the metric columns by these names: ${KNOWN_HEADERS}. Export the Performance report (Search Console) or the Pages table of Search Performance (Bing), ` +
        'with the interface in English or Turkish.',
    );
  }
  if (pageTables.length > 1) throw new ImportError('UNSUPPORTED', 'The file has more than one table of pages, so Seekwide cannot tell which to use. Export one report at a time.');
  if (dateTables.length > 1) throw new ImportError('UNSUPPORTED', 'The file has more than one table of dates, so Seekwide cannot tell which to use. Export one report at a time.');
  const { pages, skipped, merged } = readPages(pageTables[0].rows, pageTables[0].shape);
  if (pages.length === 0) throw new ImportError('EMPTY', 'The table of pages has no page Seekwide can use. Check the date range and filters of the report, and export it again.');
  const dates = dateTables.length === 1 ? readDates(dateTables[0].rows, dateTables[0].shape) : [];
  const totalsFrom = dates.length > 0 ? dates : pages;
  const sum = (/** @type {'clicks'|'impressions'} */ key) => {
    const total = totalsFrom.reduce((running, row) => running + row[key], 0);
    if (!Number.isSafeInteger(total)) throw malformed(`the ${key} add up to more than a number Seekwide can count exactly`);
    return total;
  };
  return {
    pages,
    dates,
    filters: shaped.filter((table) => table.shape.kind === 'filters').flatMap((table) => readFilters(table.rows)).slice(0, MAX_FILTERS),
    totals: { clicks: sum('clicks'), impressions: sum('impressions'), position: weightedPosition(totalsFrom), from: dates.length > 0 ? 'dates' : 'pages' },
    counts: { tables: shaped.length, other_tables: shaped.filter((table) => table.shape.kind === 'other').length, skipped_pages: skipped, merged_pages: merged },
  };
}
