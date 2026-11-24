// The Links report of Search Console, read from the export the user
// downloaded. Google's help page names the report's tables and says they are
// exported as CSV or Google Sheets, but not the columns of a download, so the
// forms read are the ones a real download had (docs/IMPORTS.md, 2026-11-24):
//
//   Top linked pages, external ("Top target pages"): Target page, Incoming links, Linking sites
//   Latest links: Linking page, Last crawled (YYYY-MM-DD)
//
// Latest links names the pages that link to the site, not the page each one
// links to. Google: "This report isn't a comprehensive list of every link on
// your site." Both are samples, and a link may since have been removed.

/** @import { Cell } from './xlsx.js' */

import { normalizeUrl } from '../util/url.js';
import { fold } from './columns.js';
import { ImportError, malformed } from './errors.js';
import { looksLikePageUrl, parseCount, parseDate } from './values.js';

export const LINK_SOURCES = /** @type {const} */ (['google_search_console_links', 'google_search_console_latest_links']);
/** @typedef {typeof LINK_SOURCES[number]} LinkSource */

/**
 * @typedef {Object} LinkTables
 * @property {{url: string, links: number, sites: number}[]} targets  Top linked pages, most incoming links first, then by
 *   address; empty for Latest links.
 * @property {{url: string, last_crawled: string}[]} linking  Latest links, newest first, then by address; empty for the
 *   top linked pages.
 * @property {{tables: number, other_tables: number, skipped_rows: number, merged_rows: number}} counts
 */

/** @param {Cell[]} row */
const isBlank = (row) => row.every((cell) => cell === '' || cell === undefined);

/** @param {Cell[]} header @param {string} name */
const columnNamed = (header, name) => header.findIndex((cell) => typeof cell === 'string' && cell.length <= 100 && fold(cell) === name);

/**
 * @param {Cell|undefined} cell
 * @param {string} where
 */
function count(cell, where) {
  const value = parseCount(cell);
  if (value === undefined) throw malformed(`${where} has no whole number of 0 or more`);
  return value;
}

/**
 * The one table whose header is exactly `names`, with the column index of each name.
 * @param {{rows: Cell[][]}[]} tables
 * @param {string[]} names
 */
function tableWith(tables, names) {
  const found = tables.filter(({ rows }) => {
    const header = rows[0] ?? [];
    return header.length === names.length && names.every((name) => columnNamed(header, name) !== -1);
  });
  return found.length === 1 ? { rows: found[0].rows, columns: names.map((name) => columnNamed(found[0].rows[0], name)) } : null;
}

/**
 * Search Console's top linked pages: each page of the site other sites link to, with its incoming links and linking sites.
 * @param {{rows: Cell[][]}[]} tables
 * @returns {LinkTables}
 */
function topLinkedPages(tables) {
  const table = tableWith(tables, ['target page', 'incoming links', 'linking sites']);
  if (table === null) {
    throw new ImportError('UNSUPPORTED', 'The file is not the table of top linked pages of Search Console\'s Links report: a table with the columns Target page, Incoming links and Linking sites. In Search Console open Links, then More under "Top linked pages" of External links, and export it as CSV, with the interface in English.');
  }
  const [page, links, sites] = table.columns;
  /** @type {Map<string, {url: string, links: number, sites: number}>} */
  const byUrl = new Map();
  let skipped = 0;
  let merged = 0;
  table.rows.slice(1).forEach((row, index) => {
    if (isBlank(row)) return;
    const where = `row ${index + 2}`;
    if (row.length > 3) throw malformed(`${where} has more values than the header has columns`);
    const entry = { links: count(row[links], where), sites: count(row[sites], where) };
    if (entry.sites > entry.links) throw malformed(`${where} has more linking sites than incoming links`);
    const url = looksLikePageUrl(row[page]) ? normalizeUrl(String(row[page]).trim()) : null;
    if (url === null) {
      skipped += 1;
      return;
    }
    const known = byUrl.get(url);
    if (known === undefined) byUrl.set(url, { url, ...entry });
    else {
      // Two rows that name one address once normalized: the links add up; the sites may be the same ones, so the larger count is kept.
      merged += 1;
      known.links += entry.links;
      known.sites = Math.max(known.sites, entry.sites);
      if (!Number.isSafeInteger(known.links)) throw malformed('the incoming links add up to more than a number Seekwide can count exactly');
    }
  });
  const targets = [...byUrl.values()].sort((a, b) => b.links - a.links || (a.url < b.url ? -1 : 1));
  if (targets.length === 0) throw new ImportError('EMPTY', 'The table names no page Seekwide can use. Export the top linked pages of the Links report again.');
  return { targets, linking: [], counts: { tables: tables.length, other_tables: tables.length - 1, skipped_rows: skipped, merged_rows: merged } };
}

/**
 * Search Console's latest links: pages on other sites that link to the site, with the day each was last crawled.
 * @param {{rows: Cell[][]}[]} tables
 * @returns {LinkTables}
 */
function latestLinks(tables) {
  const table = tableWith(tables, ['linking page', 'last crawled']);
  if (table === null) {
    throw new ImportError('UNSUPPORTED', 'The file is not the Latest links export of Search Console\'s Links report: a table with the columns Linking page and Last crawled. In Search Console open Links, then Export, Latest links, as CSV, with the interface in English.');
  }
  const [page, crawled] = table.columns;
  /** @type {Map<string, string>} */
  const byUrl = new Map();
  let skipped = 0;
  let merged = 0;
  table.rows.slice(1).forEach((row, index) => {
    if (isBlank(row)) return;
    const where = `row ${index + 2}`;
    if (row.length > 2) throw malformed(`${where} has more values than the header has columns`);
    const day = parseDate(row[crawled]);
    if (day === null) throw malformed(`${where} has no date written YYYY-MM-DD`);
    // A long address can arrive broken over lines inside its quotes; the URL parser drops the breaks and encodes the spaces.
    const url = looksLikePageUrl(row[page]) ? normalizeUrl(String(row[page]).trim()) : null;
    if (url === null) {
      skipped += 1;
      return;
    }
    const known = byUrl.get(url);
    if (known !== undefined) merged += 1;
    if (known === undefined || day > known) byUrl.set(url, day);
  });
  const linking = [...byUrl.entries()].map(([url, day]) => ({ url, last_crawled: day })).sort((a, b) => (a.last_crawled > b.last_crawled ? -1 : a.last_crawled < b.last_crawled ? 1 : a.url < b.url ? -1 : 1));
  if (linking.length === 0) throw new ImportError('EMPTY', 'The table names no linking page Seekwide can use. Export Latest links from the Links report again.');
  return { targets: [], linking, counts: { tables: tables.length, other_tables: tables.length - 1, skipped_rows: skipped, merged_rows: merged } };
}

/**
 * The data of a Links report export.
 * @param {{rows: Cell[][]}[]} tables
 * @param {LinkSource} source
 * @returns {LinkTables}
 */
export function linkTables(tables, source) {
  const filled = tables.filter((table) => table.rows.length > 0);
  return source === 'google_search_console_links' ? topLinkedPages(filled) : latestLinks(filled);
}
