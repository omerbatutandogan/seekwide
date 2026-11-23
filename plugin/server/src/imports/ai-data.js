// The two AI reports of the search tools, read from the export the user
// downloaded. Neither tool documents the columns, so the forms read are the
// ones real downloads were seen to have (docs/IMPORTS.md, 2026-11-24):
//
//   Search Console, Performance on Search Generative AI Features (CSV zip or Excel):
//     Chart: Date, Impressions · Pages: Top pages, Impressions · Countries · Devices · Filters: Filter, Value
//   Bing Webmaster Tools, AI Performance, overview (CSV):
//     "Date","Citations","Cited Pages", the date written "8/23/2026 12:00:00 AM"
//   Bing Webmaster Tools, AI Performance, pages (CSV): "Page","Citations", without dates
//
// Search Console's AI report has impressions only: no clicks and no position.
// Bing's overview counts the citations of the site in AI answers per day and
// how many of its pages were cited that day; it names no page. Its table of
// pages names the pages and their citations, and not the dates it covers.

/** @import { Cell } from './xlsx.js' */

import { clip, collapseWhitespace } from '../util/strings.js';
import { normalizeUrl } from '../util/url.js';
import { fold, metricOf } from './columns.js';
import { ImportError, malformed } from './errors.js';
import { looksLikePageUrl, parseCount, parseDate } from './values.js';

export const AI_SOURCES = /** @type {const} */ (['google_search_console_ai', 'bing_ai_performance', 'bing_ai_pages']);
/** @typedef {typeof AI_SOURCES[number]} AiSource */

const MAX_FILTERS = 20;
const FILTER_CHARS = 200;
/** Bing's date: month/day/year, then midnight in the 12-hour form its US interface writes. */
const BING_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: 12:00:00 AM)?$/;

/** @param {Cell[]} row */
const isBlank = (row) => row.every((cell) => cell === '' || cell === undefined);

/**
 * @typedef {Object} AiTables
 * @property {{date: string, impressions: number}[]|{date: string, citations: number, cited_pages: number}[]} dates
 *   Oldest first; empty for Bing's table of pages.
 * @property {{url: string, impressions: number}[]|{url: string, citations: number}[]} pages
 *   Most impressions (citations) first, then by address; empty for Bing's overview.
 * @property {{name: string, value: string}[]} filters    Search Console only, clipped.
 * @property {{impressions: number}|{citations: number, peak_cited_pages: number, days_cited: number}|{citations: number, pages_cited: number}} totals
 * @property {{tables: number, other_tables: number, skipped_pages: number}} counts
 */

/**
 * A count cell, or an ImportError naming where it is.
 * @param {Cell|undefined} cell
 * @param {string} where
 */
function count(cell, where) {
  const value = parseCount(cell);
  if (value === undefined) throw malformed(`${where} has no whole number of 0 or more`);
  return value;
}

/**
 * A date of Bing's export: M/D/YYYY, optionally at midnight, or YYYY-MM-DD.
 * @param {Cell|undefined} cell
 * @returns {string|null}
 */
export function parseBingDate(cell) {
  const text = typeof cell === 'string' ? cell.trim() : '';
  const match = BING_DATE.exec(text);
  if (match === null) return parseDate(text);
  const iso = `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`;
  return parseDate(iso);
}

/**
 * The column of a table's header whose folded name is `name`, or -1.
 * @param {Cell[]} header @param {string} name
 */
const columnNamed = (header, name) => header.findIndex((cell) => typeof cell === 'string' && cell.length <= 100 && fold(cell) === name);

/**
 * Search Console's AI report: a table of dates and one of pages, each with an impressions column and one other.
 * @param {{rows: Cell[][]}[]} tables
 * @returns {AiTables}
 */
function searchConsoleAi(tables) {
  /** @type {{date: string, impressions: number}[]|null} */
  let dates = null;
  /** @type {Map<string, number>|null} */
  let pages = null;
  let skipped = 0;
  let other = 0;
  /** @type {{name: string, value: string}[]} */
  const filters = [];
  for (const { rows } of tables) {
    const header = rows[0] ?? [];
    const metrics = header.map((cell) => metricOf(cell));
    if (metrics.includes('clicks') || metrics.includes('position')) {
      throw new ImportError('UNSUPPORTED', 'This file has clicks or positions, so it is the Performance report, not the generative AI report. Import it with source google_search_console.');
    }
    const impressions = metrics.indexOf('impressions');
    if (impressions === -1 || header.length !== 2) {
      if (header.length === 2 && impressions === -1 && metrics.every((metric) => metric === null) && fold(String(header[0] ?? '')) === 'filter') {
        for (const row of rows.slice(1, MAX_FILTERS + 1)) {
          const text = (/** @type {Cell|undefined} */ cell) => clip(collapseWhitespace(String(cell ?? '')), FILTER_CHARS);
          if (!isBlank(row)) filters.push({ name: text(row[0]), value: text(row[1]) });
        }
      } else other += 1;
      continue;
    }
    const key = 1 - impressions;
    const values = rows.slice(1).filter((row) => !isBlank(row)).map((row) => row[key]);
    if (values.length > 0 && values.every((cell) => parseDate(cell) !== null)) {
      if (dates !== null) throw new ImportError('UNSUPPORTED', 'The file has more than one table of dates, so Seekwide cannot tell which to use. Export one report at a time.');
      /** @type {Map<string, number>} */
      const byDate = new Map();
      rows.slice(1).forEach((row, index) => {
        if (isBlank(row)) return;
        const date = /** @type {string} */ (parseDate(row[key]));
        if (byDate.has(date)) throw malformed(`row ${index + 2} of the table of dates repeats a date`);
        byDate.set(date, count(row[impressions], `row ${index + 2} of the table of dates`));
      });
      dates = [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, value]) => ({ date, impressions: value }));
    } else if (values.length > 0 && values.every(looksLikePageUrl)) {
      if (pages !== null) throw new ImportError('UNSUPPORTED', 'The file has more than one table of pages, so Seekwide cannot tell which to use. Export one report at a time.');
      pages = new Map();
      for (const [index, row] of rows.slice(1).entries()) {
        if (isBlank(row)) continue;
        const value = count(row[impressions], `row ${index + 2} of the table of pages`);
        const url = normalizeUrl(String(row[key] ?? '').trim());
        if (url === null) skipped += 1;
        else pages.set(url, (pages.get(url) ?? 0) + value);
      }
    } else other += 1;
  }
  if (dates === null || dates.length === 0) {
    throw new ImportError('UNSUPPORTED', 'The file has no table of dates with an Impressions column. Export "Performance on Search Generative AI Features" from Search Console as the CSV zip or the Excel file, with the interface in English or Turkish.');
  }
  const total = dates.reduce((sum, row) => sum + row.impressions, 0);
  if (!Number.isSafeInteger(total)) throw malformed('the impressions add up to more than a number Seekwide can count exactly');
  return {
    dates,
    pages: [...(pages ?? new Map()).entries()].map(([url, impressions]) => ({ url, impressions })).sort((a, b) => b.impressions - a.impressions || (a.url < b.url ? -1 : 1)),
    filters,
    totals: { impressions: total },
    counts: { tables: tables.length, other_tables: other, skipped_pages: skipped },
  };
}

/**
 * Bing's AI Performance overview: one table of Date, Citations and Cited Pages.
 * @param {{rows: Cell[][]}[]} tables
 * @returns {AiTables}
 */
function bingAi(tables) {
  const found = tables.filter(({ rows }) => {
    const header = rows[0] ?? [];
    return header.length === 3 && columnNamed(header, 'date') !== -1 && columnNamed(header, 'citations') !== -1 && columnNamed(header, 'cited pages') !== -1;
  });
  if (found.length !== 1) {
    throw new ImportError('UNSUPPORTED', 'The file is not the overview of Bing\'s AI Performance report: a table with the columns Date, Citations and Cited Pages. Download it from AI Performance in Bing Webmaster Tools, with the interface in English.');
  }
  const { rows } = found[0];
  const header = rows[0];
  const [date, citations, cited] = ['date', 'citations', 'cited pages'].map((name) => columnNamed(header, name));
  /** @type {Map<string, {date: string, citations: number, cited_pages: number}>} */
  const byDate = new Map();
  rows.slice(1).forEach((row, index) => {
    if (isBlank(row)) return;
    const where = `row ${index + 2}`;
    if (row.length > 3) throw malformed(`${where} has more values than the header has columns`);
    const day = parseBingDate(row[date]);
    if (day === null) throw malformed(`${where} has no date Seekwide can read`);
    if (byDate.has(day)) throw malformed(`${where} repeats a date`);
    const entry = { date: day, citations: count(row[citations], where), cited_pages: count(row[cited], where) };
    if (entry.cited_pages > entry.citations) throw malformed(`${where} has more cited pages than citations`);
    byDate.set(day, entry);
  });
  const dates = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (dates.length === 0) throw new ImportError('EMPTY', 'The table has no day. Choose a date range in AI Performance and download it again.');
  const total = dates.reduce((sum, row) => sum + row.citations, 0);
  if (!Number.isSafeInteger(total)) throw malformed('the citations add up to more than a number Seekwide can count exactly');
  return {
    dates,
    pages: [],
    filters: [],
    totals: { citations: total, peak_cited_pages: Math.max(...dates.map((row) => row.cited_pages)), days_cited: dates.filter((row) => row.citations > 0).length },
    counts: { tables: tables.length, other_tables: tables.length - 1, skipped_pages: 0 },
  };
}

/**
 * Bing's AI Performance table of pages: Page and Citations.
 * @param {{rows: Cell[][]}[]} tables
 * @returns {AiTables}
 */
function bingAiPages(tables) {
  const found = tables.filter(({ rows }) => {
    const header = rows[0] ?? [];
    return header.length === 2 && columnNamed(header, 'page') !== -1 && columnNamed(header, 'citations') !== -1;
  });
  if (found.length !== 1) {
    throw new ImportError('UNSUPPORTED', 'The file is not the table of pages of Bing\'s AI Performance report: a table with the columns Page and Citations. Download it from the pages view of AI Performance in Bing Webmaster Tools, with the interface in English.');
  }
  const { rows } = found[0];
  const [page, citations] = ['page', 'citations'].map((name) => columnNamed(rows[0], name));
  /** @type {Map<string, number>} */
  const byUrl = new Map();
  let skipped = 0;
  rows.slice(1).forEach((row, index) => {
    if (isBlank(row)) return;
    const where = `row ${index + 2}`;
    if (row.length > 2) throw malformed(`${where} has more values than the header has columns`);
    const value = count(row[citations], where);
    const url = looksLikePageUrl(row[page]) ? normalizeUrl(String(row[page]).trim()) : null;
    if (url === null) skipped += 1;
    else byUrl.set(url, (byUrl.get(url) ?? 0) + value);
  });
  const pages = [...byUrl.entries()].map(([url, value]) => ({ url, citations: value })).sort((a, b) => b.citations - a.citations || (a.url < b.url ? -1 : 1));
  if (pages.length === 0) throw new ImportError('EMPTY', 'The table names no page Seekwide can use. Choose a date range in AI Performance and download the pages again.');
  const total = pages.reduce((sum, row) => sum + row.citations, 0);
  if (!Number.isSafeInteger(total)) throw malformed('the citations add up to more than a number Seekwide can count exactly');
  return {
    dates: [],
    pages,
    filters: [],
    totals: { citations: total, pages_cited: pages.filter((row) => row.citations > 0).length },
    counts: { tables: tables.length, other_tables: tables.length - 1, skipped_pages: skipped },
  };
}

/**
 * The data of an AI report export.
 * @param {{rows: Cell[][]}[]} tables
 * @param {AiSource} source
 * @returns {AiTables}
 */
export function aiTables(tables, source) {
  const filled = tables.filter((table) => table.rows.length > 0);
  if (source === 'google_search_console_ai') return searchConsoleAi(filled);
  return source === 'bing_ai_performance' ? bingAi(filled) : bingAiPages(filled);
}
