// The traffic source reports of YouTube Studio's Advanced mode, read from the
// export the user downloaded ("Export current view"). Google documents that
// the view can be exported and that a download holds at most 500 rows, not
// its columns, so the forms read are the ones a real download had
// (docs/IMPORTS.md, 2026-11-24; English headers from a Turkish interface):
//
//   a zip of three CSV files: the table (Tablo verileri.csv), the chart by day
//   (Grafik verileri.csv) and the totals by day (Toplamlar.csv)
//   Traffic sources: Traffic source, Views, Watch time (hours), Average view duration, Thumbnail impressions, ...
//   YouTube search: Traffic source (YT_SEARCH.<term>), Source type, Source title (the term), Views, Watch time (hours), ...
//   after the rows, a line "Showing top 500 results" when the view had more
//
// The terms are what people typed into YouTube's search before they watched;
// YouTube shows them in the channel owner's own Studio.

/** @import { Cell } from './xlsx.js' */

import { clip, collapseWhitespace } from '../util/strings.js';
import { fold } from './columns.js';
import { ImportError, malformed } from './errors.js';
import { parseCount, parseDate } from './values.js';

export const YOUTUBE_SOURCES = /** @type {const} */ (['youtube_search_terms', 'youtube_traffic_sources']);
/** @typedef {typeof YOUTUBE_SOURCES[number]} YoutubeSource */

/** The longest search term or source name kept. */
export const NAME_CHARS = 100;
const SEARCH_PREFIX = 'YT_SEARCH.';
const SHOWING = /^Showing top (\d{1,6}) results$/;
const HOURS = /^\d{1,9}(?:\.\d{1,6})?$/;

/**
 * @typedef {Object} YoutubeTables
 * @property {{start: string, end: string}|null} period  The first and last day of the chart or the totals by day.
 * @property {{views: number, watch_hours: number|null}} total  The view's Total row.
 * @property {{name: string, views: number, watch_hours: number|null}[]} rows  Most views first, then by name.
 * @property {number|null} truncated_at  The row limit YouTube states under a cut table, else null.
 * @property {{tables: number, other_tables: number, skipped_rows: number, merged_rows: number}} counts
 */

/** @param {Cell[]} row */
const isBlank = (row) => row.every((cell) => cell === '' || cell === undefined);
/** @param {Cell|undefined} cell */
const textOf = (cell) => (typeof cell === 'number' ? String(cell) : typeof cell === 'string' ? cell.trim() : '');
/** @param {Cell[]} header @param {string} name */
const columnNamed = (header, name) => header.findIndex((cell) => typeof cell === 'string' && cell.length <= 100 && fold(cell) === name);

/**
 * Watch time in hours as YouTube writes it (4.6356), or null for an empty cell.
 * @param {Cell|undefined} cell
 * @param {string} where
 */
function hours(cell, where) {
  const text = textOf(cell);
  if (text === '') return null;
  if (!HOURS.test(text)) throw malformed(`${where} has a watch time Seekwide cannot read`);
  return Number(text);
}

/**
 * The first and last day of the tables with a Date column.
 * @param {{rows: Cell[][]}[]} tables
 */
function periodOf(tables) {
  let start = '';
  let end = '';
  for (const { rows } of tables) {
    const date = columnNamed(rows[0] ?? [], 'date');
    if (date === -1) continue;
    for (const row of rows.slice(1)) {
      const day = parseDate(textOf(row[date]));
      if (day === null) continue;
      if (start === '' || day < start) start = day;
      if (end === '' || day > end) end = day;
    }
  }
  return start === '' ? null : { start, end };
}

/**
 * The data of an export of YouTube Studio's traffic sources, or of its YouTube search terms.
 * @param {{rows: Cell[][]}[]} tables
 * @param {YoutubeSource} source
 * @returns {YoutubeTables}
 */
export function youtubeTables(tables, source) {
  const filled = tables.filter((table) => table.rows.length > 0);
  const found = filled.filter(({ rows }) => {
    const header = rows[0] ?? [];
    return columnNamed(header, 'traffic source') !== -1 && columnNamed(header, 'views') !== -1 && columnNamed(header, 'date') === -1;
  });
  const how = source === 'youtube_search_terms'
    ? 'In YouTube Studio open Analytics, Advanced mode, the Traffic source tab, click YouTube search, then Export current view.'
    : 'In YouTube Studio open Analytics, Advanced mode, the Traffic source tab, then Export current view.';
  if (found.length !== 1) throw new ImportError('UNSUPPORTED', `The file is not an export of YouTube Studio's traffic sources: a table with the columns Traffic source and Views. ${how}`);
  const { rows } = found[0];
  const header = rows[0];
  const [name, title, views, watch] = ['traffic source', 'source title', 'views', 'watch time (hours)'].map((column) => columnNamed(header, column));
  const terms = source === 'youtube_search_terms';
  if (terms && title === -1) throw new ImportError('UNSUPPORTED', `The table has no Source title column, so it is not the view of YouTube search terms. ${how}`);
  /** @type {{views: number, watch_hours: number|null}|null} */
  let total = null;
  /** @type {Map<string, {name: string, views: number, watch_hours: number|null}>} */
  const byName = new Map();
  let truncated = null;
  let skipped = 0;
  let merged = 0;
  rows.slice(1).forEach((row, index) => {
    if (isBlank(row)) return;
    const where = `row ${index + 2}`;
    const first = textOf(row[0]);
    const showing = SHOWING.exec(first);
    if (showing !== null && row.filter((cell) => textOf(cell) !== '').length === 1) {
      truncated = Number(showing[1]);
      return;
    }
    if (row.length > header.length) throw malformed(`${where} has more values than the header has columns`);
    const value = parseCount(row[views]);
    if (value === undefined) throw malformed(`${where} has no whole number of views`);
    const watched = watch === -1 ? null : hours(row[watch], where);
    const label = textOf(row[name]);
    if (label === 'Total') {
      if (total !== null) throw malformed(`${where} repeats the Total row`);
      total = { views: value, watch_hours: watched };
      return;
    }
    const isTerm = label.startsWith(SEARCH_PREFIX);
    if (isTerm !== terms) {
      throw new ImportError('UNSUPPORTED', terms
        ? `The table lists traffic sources, not YouTube search terms: import it with source youtube_traffic_sources, or ${how.charAt(0).toLowerCase()}${how.slice(1)}`
        : 'The table lists YouTube search terms, not traffic sources: import it with source youtube_search_terms.');
    }
    const text = clip(collapseWhitespace(terms ? textOf(row[title]) || label.slice(SEARCH_PREFIX.length) : label), NAME_CHARS);
    if (text === '') {
      skipped += 1;
      return;
    }
    const known = byName.get(text);
    if (known === undefined) byName.set(text, { name: text, views: value, watch_hours: watched });
    else {
      merged += 1;
      known.views += value;
      known.watch_hours = known.watch_hours === null || watched === null ? null : known.watch_hours + watched;
      if (!Number.isSafeInteger(known.views)) throw malformed('the views add up to more than a number Seekwide can count exactly');
    }
  });
  if (total === null) throw malformed('the table has no Total row');
  const list = [...byName.values()]
    .map((row) => ({ ...row, watch_hours: row.watch_hours === null ? null : Math.round(row.watch_hours * 10000) / 10000 }))
    .sort((a, b) => b.views - a.views || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (list.length === 0) throw new ImportError('EMPTY', `The table has no row besides the total. Choose a longer date range, then export again. ${how}`);
  return {
    period: periodOf(filled),
    total,
    rows: list,
    truncated_at: truncated,
    counts: { tables: tables.length, other_tables: tables.length - 1, skipped_rows: skipped, merged_rows: merged },
  };
}
