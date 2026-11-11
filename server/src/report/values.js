// Small coercions for data that comes from a stored run. A run is a JSON file
// that people can edit, so nothing about its shape is taken on trust.

import { collapseWhitespace } from '../util/strings.js';

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
export function num(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export const str = (value) => (typeof value === 'string' ? value : '');

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
export const obj = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {});

/**
 * One line of text: whitespace collapsed, with a fallback for empty values.
 * @param {unknown} value
 * @param {string} [fallback]
 * @returns {string}
 */
export const text = (value, fallback = '') => collapseWhitespace(str(value)) || fallback;

/**
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export const compareText = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
