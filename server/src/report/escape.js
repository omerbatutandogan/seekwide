import { clip, collapseWhitespace } from '../util/strings.js';

/**
 * Escape text for HTML element content and for double- or single-quoted attributes.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The normalized form of an http or https URL, or null for anything else
 * (javascript:, data:, relative references, garbage). This is the only gate a
 * string passes before it may become a link.
 * @param {unknown} value
 * @returns {string|null}
 */
export function safeHttpUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** Marks a string as HTML that is already safe, so `html` does not escape it again. */
class SafeHtml {
  /** @param {string} value */
  constructor(value) {
    this.value = value;
  }

  toString() {
    return this.value;
  }
}

/**
 * Insert trusted markup, such as the stylesheet, without escaping.
 * @param {string} value
 * @returns {SafeHtml}
 */
export function raw(value) {
  return new SafeHtml(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function interpolate(value) {
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(interpolate).join('');
  if (value === null || value === undefined || value === false) return '';
  return escapeHtml(value);
}

/**
 * Tagged template for HTML. Every interpolated value is escaped with
 * `escapeHtml` unless it is the result of another `html` call (or `raw`), so
 * forgetting to escape is not possible. Arrays are joined; null, undefined and
 * false render nothing.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {SafeHtml}
 */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, index) => {
    out += interpolate(value) + strings[index + 1];
  });
  return new SafeHtml(out);
}

/**
 * Plain text for a Markdown paragraph, list item or table cell: whitespace is
 * collapsed to one line and characters that Markdown would interpret are escaped.
 * `<` becomes an entity so no tag can start, which also leaves a later `>` inert.
 * @param {unknown} value
 * @returns {string}
 */
export function mdText(value) {
  return collapseWhitespace(String(value))
    .replace(/[\\`*_[\]|~]/g, '\\$&')
    .replace(/</g, '&lt;')
    .replace(/^([#+=>-])/, '\\$1')
    .replace(/^(\d+)([.)])/, '$1\\$2');
}

/**
 * Inline code. The fence is longer than any backtick run inside the value, so
 * the value cannot end the span. In a table cell, pipes are escaped.
 * @param {unknown} value
 * @param {boolean} [inCell]
 * @returns {string}
 */
export function mdCode(value, inCell = false) {
  let text = collapseWhitespace(String(value));
  if (text === '') return '';
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  if (text.startsWith('`') || text.endsWith('`')) text = ` ${text} `;
  if (inCell) text = text.replace(/\|/g, '\\|');
  return `${fence}${text}${fence}`;
}

/**
 * A URL for Markdown: an autolink for http and https URLs, inline code for
 * anything else, so only http and https URLs ever become links.
 * @param {unknown} value
 * @param {boolean} [inCell]
 * @returns {string}
 */
export function mdUrl(value, inCell = false) {
  const href = safeHttpUrl(value);
  if (href === null || /[<>\s]/.test(href)) return mdCode(clip(String(value), 300), inCell);
  return `<${href.replace(/\|/g, '%7C')}>`;
}
