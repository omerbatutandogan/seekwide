// JSON-LD blocks: validity and the schema.org types they declare. Pure.

/** @import { JsonLdBlock } from '../types.js' */

import { LIMITS } from '../config.js';
import { clip } from '../util/strings.js';

const MAX_TYPES = 50;

/**
 * @param {unknown} value
 * @param {string[]} types
 */
function addTypes(value, types) {
  const values = Array.isArray(value) ? value : [value];
  for (const type of values) {
    if (typeof type !== 'string' || type.trim() === '' || types.length >= MAX_TYPES) continue;
    const clipped = clip(type.trim(), LIMITS.maxStringLength);
    if (!types.includes(clipped)) types.push(clipped);
  }
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse the text of one `<script type="application/ld+json">`.
 * `types` holds `@type` values of the top-level object (or of each object in a
 * top-level array) and of the objects in their `@graph`, in order, once each.
 * Empty content is not valid JSON and is reported as such.
 * @param {string} text
 * @param {number|null} line
 * @returns {JsonLdBlock}
 */
export function parseJsonLd(text, line) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    const message = text.trim() === '' ? 'Empty JSON-LD script' : /** @type {Error} */ (error).message;
    return { valid: false, types: [], error: clip(message, LIMITS.maxStringLength), line };
  }
  /** @type {string[]} */
  const types = [];
  for (const item of Array.isArray(data) ? data : [data]) {
    if (!isObject(item)) continue;
    addTypes(item['@type'], types);
    const graph = item['@graph'];
    for (const node of Array.isArray(graph) ? graph : [graph]) {
      if (isObject(node)) addTypes(node['@type'], types);
    }
  }
  return { valid: true, types, error: null, line };
}
