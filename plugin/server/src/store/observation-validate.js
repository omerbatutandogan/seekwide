// What the observations of a stored run must look like (rule set 0.2.1).
//
// Checked by form only, never by membership of a list a later version can
// change: an id and a module have the form the plugin writes, a status and the
// value names are short lower-case words, values are counts, flags, null or
// short single-line text, and URLs are stored URLs. A run saved before the
// field existed has none and loads as it is.

import { isStoredUrl } from './run-validate.js';

/** More observations than any version writes. */
export const MAX_OBSERVATIONS = 20;
const MAX_VALUES = 20;
const MAX_URLS = 5;
const MAX_TEXT = 200;
const MAX_REASON = 500;
const ID = /^[a-z]{1,20}\.[a-z0-9_]{1,40}$/;
const MODULE = /^[a-z]{1,20}$/;
const WORD = /^[a-z][a-z0-9_]{0,39}$/;
/** Control, format (direction, zero-width, tag) and line separator characters. */
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** @param {unknown} value */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {boolean} A string of at most `max` characters on one line, without control or direction characters.
 */
export const isPlainText = (value, max) => typeof value === 'string' && value.length <= max && !CONTROL.test(value);

/**
 * @param {unknown} value
 * @returns {boolean} A value an observation may hold: null, a boolean, a finite number or short plain text.
 */
const isValue = (value) => value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || isPlainText(value, MAX_TEXT);

/**
 * The first field of a run's `observations` that does not have the form the
 * plugin writes, as a dotted name ("observations[1].values"), or null when
 * the field is absent, null, or every entry has that form. Names only, never values.
 * @param {unknown} observations
 * @returns {string|null}
 */
export function observationsProblem(observations) {
  if (observations === undefined || observations === null) return null;
  if (!Array.isArray(observations) || observations.length > MAX_OBSERVATIONS) return 'observations';
  for (let i = 0; i < observations.length; i += 1) {
    const where = `observations[${i}]`;
    const entry = observations[i];
    if (!isObject(entry)) return where;
    const { id, module, status, reason, values, urls, source } = /** @type {Record<string, unknown>} */ (entry);
    if (typeof id !== 'string' || !ID.test(id)) return `${where}.id`;
    if (typeof module !== 'string' || !MODULE.test(module)) return `${where}.module`;
    if (typeof status !== 'string' || !WORD.test(status)) return `${where}.status`;
    if (reason !== null && !isPlainText(reason, MAX_REASON)) return `${where}.reason`;
    if (!isObject(values)) return `${where}.values`;
    const pairs = Object.entries(/** @type {object} */ (values));
    if (pairs.length > MAX_VALUES || !pairs.every(([name, value]) => WORD.test(name) && isValue(value))) return `${where}.values`;
    if (!Array.isArray(urls) || urls.length > MAX_URLS || !urls.every(isStoredUrl)) return `${where}.urls`;
    if (source !== null && !(isStoredUrl(source) && /** @type {string} */ (source).startsWith('https://'))) return `${where}.source`;
  }
  return null;
}
