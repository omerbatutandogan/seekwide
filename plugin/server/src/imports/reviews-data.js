// The reviews report of Google Play Console, read from the monthly CSV files
// the user downloaded (Play Console, "Download reports", Reviews). Unlike the
// search tools' exports, Google's help page lists its columns
// (docs/IMPORTS.md, read 2026-11-24): Package Name, App Version Code, App
// Version Name, Reviewer Language, Device, Review Submit Date and Time, Review
// Submit Millis Since Epoch, Review Last Update Date and Time, Review Last
// Update Millis Since Epoch, Star Rating, Review Title, Review Text, Developer
// Reply Date and Time, Developer Reply Millis Since Epoch, Developer Reply
// Text, Review Link. The files are UTF-16; a zip of several months is read
// as one import.
//
// What a reviewer wrote is never kept: only the stars, the day, whether the
// developer replied, and for an unanswered low rating its language, app
// version and link to the review in Play Console.

/** @import { Cell } from './xlsx.js' */

import { fold } from './columns.js';
import { ImportError, malformed } from './errors.js';
import { parseDate } from './values.js';

export const REVIEW_SOURCES = /** @type {const} */ (['google_play_reviews']);
/** @typedef {typeof REVIEW_SOURCES[number]} ReviewSource */

/** Unanswered reviews of 1 or 2 stars kept per app, newest first. */
export const UNANSWERED_KEPT = 50;
/** The most apps one import holds. */
export const MAX_APPS = 20;

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const LANGUAGE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,3}$/;
const VERSION_CODE = /^\d{1,12}$/;
const MILLIS = /^\d{12,14}$/;
/** The earliest a review can be: Android Market opened in October 2008. */
const EARLIEST = Date.UTC(2008, 0, 1);

/**
 * @typedef {Object} ReviewMonth
 * @property {string} month       YYYY-MM, by the day the review was submitted (UTC).
 * @property {number} reviews
 * @property {[number, number, number, number, number]} stars  Reviews with 1, 2, 3, 4 and 5 stars.
 * @property {number} replied     Reviews the developer replied to.
 */

/**
 * @typedef {Object} UnansweredReview
 * @property {string} submitted   YYYY-MM-DD.
 * @property {1|2} stars
 * @property {string|null} language
 * @property {string|null} version_code
 * @property {string|null} link    The review in Play Console: an https address on play.google.com.
 */

/**
 * @typedef {Object} ReviewTables
 * @property {{package: string, months: ReviewMonth[], unanswered: UnansweredReview[], unanswered_total: number}[]} apps
 *   By package name; months oldest first.
 * @property {{tables: number, other_tables: number, reviews: number, duplicates: number, skipped_rows: number}} counts
 */

/** @param {string} a @param {string} b */
const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** @param {Cell[]} row */
const isBlank = (row) => row.every((cell) => cell === '' || cell === undefined);
/** @param {Cell|undefined} cell */
const textOf = (cell) => (typeof cell === 'number' ? String(cell) : typeof cell === 'string' ? cell.trim() : '');

const REQUIRED = ['package name', 'star rating', 'review submit date and time'];
const OPTIONAL = ['review submit millis since epoch', 'developer reply date and time', 'developer reply millis since epoch', 'developer reply text', 'reviewer language', 'app version code', 'review link'];

/**
 * The column of each known name in a header, or -1.
 * @param {Cell[]} header
 */
function columnsOf(header) {
  /** @type {Record<string, number>} */
  const columns = {};
  for (const name of [...REQUIRED, ...OPTIONAL]) {
    columns[name] = header.findIndex((cell) => typeof cell === 'string' && cell.length <= 100 && fold(cell) === name);
  }
  return columns;
}

/**
 * The UTC day a review was submitted: from the milliseconds column when it has a value, else from the leading
 * YYYY-MM-DD of the date and time. Null when neither can be read.
 * @param {Cell[]} row
 * @param {Record<string, number>} columns
 */
function submittedDay(row, columns) {
  const millis = columns['review submit millis since epoch'] === -1 ? '' : textOf(row[columns['review submit millis since epoch']]);
  if (MILLIS.test(millis)) {
    const time = Number(millis);
    if (time >= EARLIEST && time <= Date.UTC(2100, 0, 1)) return new Date(time).toISOString().slice(0, 10);
    return null;
  }
  const text = textOf(row[columns['review submit date and time']]);
  return parseDate(text.slice(0, 10));
}

/**
 * Whether the developer replied: any of the three reply columns has a value.
 * @param {Cell[]} row
 * @param {Record<string, number>} columns
 */
const repliedTo = (row, columns) =>
  ['developer reply date and time', 'developer reply millis since epoch', 'developer reply text'].some((name) => columns[name] !== -1 && textOf(row[columns[name]]) !== '');

/**
 * A review's address in Play Console, or null: only https addresses on play.google.com are kept.
 * @param {Cell|undefined} cell
 */
function reviewLink(cell) {
  const text = textOf(cell);
  if (text.length === 0 || text.length > 500) return null;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && url.hostname === 'play.google.com' && url.username === '' && url.password === '' && url.port === '' ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * The data of one or more monthly reviews files of Play Console.
 * @param {{rows: Cell[][]}[]} tables
 * @returns {ReviewTables}
 */
export function reviewTables(tables) {
  const filled = tables.filter((table) => table.rows.length > 0);
  const found = filled.filter(({ rows }) => {
    const columns = columnsOf(rows[0] ?? []);
    return REQUIRED.every((name) => columns[name] !== -1);
  });
  if (found.length === 0) {
    throw new ImportError('UNSUPPORTED', 'The file is not a reviews report of Play Console: a table with the columns Package Name, Star Rating and Review Submit Date and Time. In Play Console open Download reports, then Reviews, and download a month as CSV, or zip several months into one file.');
  }
  /** @type {Map<string, {months: Map<string, ReviewMonth>, unanswered: UnansweredReview[]}>} */
  const apps = new Map();
  /** @type {Set<string>} */
  const seen = new Set();
  let reviews = 0;
  let duplicates = 0;
  let skipped = 0;
  for (const [tableIndex, { rows }] of found.entries()) {
    const columns = columnsOf(rows[0]);
    rows.slice(1).forEach((row, index) => {
      if (isBlank(row)) return;
      const where = `row ${index + 2}${found.length > 1 ? ` of table ${tableIndex + 1}` : ''}`;
      if (row.length > rows[0].length) throw malformed(`${where} has more values than the header has columns`);
      const name = textOf(row[columns['package name']]);
      const stars = Number(textOf(row[columns['star rating']]));
      const day = submittedDay(row, columns);
      if (!PACKAGE.test(name) || name.length > 150 || !Number.isInteger(stars) || stars < 1 || stars > 5 || day === null) {
        skipped += 1;
        return;
      }
      const link = columns['review link'] === -1 ? null : reviewLink(row[columns['review link']]);
      // A review edited later can be in two monthly files: its link names it once. Without a link each row counts.
      if (link !== null) {
        if (seen.has(link)) {
          duplicates += 1;
          return;
        }
        seen.add(link);
      }
      let app = apps.get(name);
      if (app === undefined) {
        if (apps.size >= MAX_APPS) throw malformed(`the file names more than ${MAX_APPS} apps`);
        app = { months: new Map(), unanswered: [] };
        apps.set(name, app);
      }
      const month = day.slice(0, 7);
      const entry = app.months.get(month) ?? { month, reviews: 0, stars: /** @type {[number, number, number, number, number]} */ ([0, 0, 0, 0, 0]), replied: 0 };
      entry.reviews += 1;
      entry.stars[stars - 1] += 1;
      const replied = repliedTo(row, columns);
      if (replied) entry.replied += 1;
      app.months.set(month, entry);
      if (!replied && stars <= 2) {
        const language = columns['reviewer language'] === -1 ? '' : textOf(row[columns['reviewer language']]);
        const version = columns['app version code'] === -1 ? '' : textOf(row[columns['app version code']]);
        app.unanswered.push({ submitted: day, stars: /** @type {1|2} */ (stars), language: LANGUAGE.test(language) ? language : null, version_code: VERSION_CODE.test(version) ? version : null, link });
      }
      reviews += 1;
    });
  }
  if (reviews === 0) throw new ImportError('EMPTY', 'The reviews report has no review Seekwide can use. Download a month that has reviews.');
  return {
    apps: [...apps.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([name, app]) => {
      const unanswered = app.unanswered.sort((a, b) => compareText(b.submitted, a.submitted) || a.stars - b.stars || compareText(a.link ?? '', b.link ?? ''));
      return {
        package: name,
        months: [...app.months.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
        unanswered: unanswered.slice(0, UNANSWERED_KEPT),
        unanswered_total: unanswered.length,
      };
    }),
    counts: { tables: tables.length, other_tables: tables.length - found.length, reviews, duplicates, skipped_rows: skipped },
  };
}
