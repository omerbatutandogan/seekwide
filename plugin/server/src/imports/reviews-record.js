// The stored form of a Play reviews import (`.seekwide/imports/<source>.json`)
// and the check every reader applies to it: a `.seekwide/` folder can arrive
// with a repository, so a file of any other form is refused as damaged. The
// problem names the field, never its value.

/** @import { ReviewSource, ReviewTables } from './reviews-data.js' */

import { stripHidden } from '../util/strings.js';
import { IMPORT_MAX_BYTES } from './read-file.js';
import { MAX_APPS, REVIEW_SOURCES, UNANSWERED_KEPT } from './reviews-data.js';
import { parseDate } from './values.js';

export const REVIEW_IMPORT_SCHEMA_VERSION = 1;

/**
 * @typedef {ReviewTables & {
 *   schema_version: 1, source: ReviewSource, imported_at: string,
 *   file: {path: string, format: 'csv'|'zip'|'xlsx', bytes: number, sha256: string},
 * }} ReviewImport
 *   One import of Play Console's reviews report: one or more months, by app.
 */

const TOP_KEYS = ['schema_version', 'source', 'imported_at', 'file', 'apps', 'counts'];
const BREAKS = /[\t\n\r\u2028\u2029]/;
const SHA256 = /^[0-9a-f]{64}$/;
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const LANGUAGE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8}){0,3}$/;
const VERSION_CODE = /^\d{1,12}$/;
const MONTH = /^(\d{4})-(\d{2})$/;
/** The most months one app can have: from 2008 to 2100. */
const MAX_MONTHS = 1200;

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
const isMonth = (value) => typeof value === 'string' && MONTH.test(value) && parseDate(`${value}-01`) === `${value}-01`;

/** @param {unknown} value */
function isLink(value) {
  if (value === null) return true;
  if (typeof value !== 'string' || value.length > 500) return false;
  try {
    const url = new URL(value);
    return url.href === value && url.protocol === 'https:' && url.hostname === 'play.google.com' && url.username === '' && url.password === '' && url.port === '';
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function appProblem(value) {
  if (!hasKeys(value, ['package', 'months', 'unanswered', 'unanswered_total'])) return 'apps has an entry with fields the plugin does not write';
  const app = /** @type {Record<string, any>} */ (value);
  if (typeof app.package !== 'string' || app.package.length > 150 || !PACKAGE.test(app.package)) return 'apps has a package name that is not valid';
  if (!Array.isArray(app.months) || app.months.length === 0 || app.months.length > MAX_MONTHS) return 'apps has an entry without months';
  let lastMonth = '';
  let lowUnanswered = 0;
  for (const month of app.months) {
    if (!hasKeys(month, ['month', 'reviews', 'stars', 'replied']) || !isMonth(month.month) || month.month <= lastMonth) return 'months are not valid or not in order';
    if (!Array.isArray(month.stars) || month.stars.length !== 5 || !month.stars.every(isCount) || !isCount(month.reviews) || !isCount(month.replied)) return 'months has counts that are not valid';
    const sum = month.stars.reduce((/** @type {number} */ total, /** @type {number} */ count) => total + count, 0);
    if (month.reviews === 0 || sum !== month.reviews || month.replied > month.reviews) return 'months has counts that do not add up';
    lowUnanswered += month.stars[0] + month.stars[1];
    lastMonth = month.month;
  }
  if (!isCount(app.unanswered_total) || app.unanswered_total > lowUnanswered) return 'unanswered_total is not valid';
  if (!Array.isArray(app.unanswered) || app.unanswered.length !== Math.min(app.unanswered_total, UNANSWERED_KEPT)) return 'unanswered is not a list of the kept reviews';
  let previous = null;
  for (const review of app.unanswered) {
    if (!hasKeys(review, ['submitted', 'stars', 'language', 'version_code', 'link'])) return 'unanswered has a review with fields the plugin does not write';
    if (parseDate(review.submitted) !== review.submitted || (review.stars !== 1 && review.stars !== 2)) return 'unanswered has a review whose day or stars are not valid';
    if (!(review.language === null || (isText(review.language, 20) && LANGUAGE.test(review.language)))) return 'unanswered has a language that is not valid';
    if (!(review.version_code === null || (typeof review.version_code === 'string' && VERSION_CODE.test(review.version_code)))) return 'unanswered has a version code that is not valid';
    if (!isLink(review.link)) return 'unanswered has a link that is not a Play Console address';
    if (!app.months.some((/** @type {{month: string}} */ month) => month.month === review.submitted.slice(0, 7))) return 'unanswered has a review in a month the import does not have';
    if (previous !== null && (review.submitted > previous.submitted || (review.submitted === previous.submitted && review.stars < previous.stars))) return 'unanswered is not in order';
    previous = review;
  }
  return null;
}

/**
 * @param {unknown} value
 * @param {ReviewSource} source
 * @returns {string|null}
 */
export function reviewImportProblem(value, source) {
  if (!REVIEW_SOURCES.includes(source)) return 'the source is not a reviews report';
  if (!hasKeys(value, TOP_KEYS)) return 'the file has fields the plugin does not write, or lacks some';
  const data = /** @type {Record<string, any>} */ (value);
  if (data.schema_version !== REVIEW_IMPORT_SCHEMA_VERSION) return 'schema_version is not one this version reads';
  if (data.source !== source) return 'source does not match the file name';
  if (!isTime(data.imported_at)) return 'imported_at is not a date';
  const file = data.file;
  if (!hasKeys(file, ['path', 'format', 'bytes', 'sha256']) || !isText(file.path, 300) || !['csv', 'zip', 'xlsx'].includes(file.format) || !isCount(file.bytes) || file.bytes > IMPORT_MAX_BYTES || !SHA256.test(String(file.sha256))) {
    return 'file is not a valid description of the imported file';
  }
  if (!Array.isArray(data.apps) || data.apps.length === 0 || data.apps.length > MAX_APPS) return 'apps is not a list of apps';
  let last = '';
  let reviews = 0;
  for (const app of data.apps) {
    const problem = appProblem(app);
    if (problem !== null) return problem;
    if (app.package <= last) return 'apps are not in order or name a package twice';
    last = app.package;
    reviews += app.months.reduce((/** @type {number} */ total, /** @type {{reviews: number}} */ month) => total + month.reviews, 0);
  }
  const counts = data.counts;
  if (!hasKeys(counts, ['tables', 'other_tables', 'reviews', 'duplicates', 'skipped_rows']) || !['tables', 'other_tables', 'reviews', 'duplicates', 'skipped_rows'].every((key) => isCount(counts[key]))) {
    return 'counts does not hold valid numbers';
  }
  if (counts.reviews !== reviews || counts.other_tables >= counts.tables) return 'counts does not match the apps';
  return null;
}
