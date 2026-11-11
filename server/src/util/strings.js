/**
 * Collapse runs of whitespace to single spaces and trim.
 * @param {string} value
 * @returns {string}
 */
export function collapseWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Cut a string to at most `max` characters, marking the cut with an ellipsis.
 * Page-derived strings are clipped before they are stored or returned so one
 * oversized attribute cannot bloat a report or a tool result.
 * @param {string} value
 * @param {number} [max]
 * @returns {string}
 */
export function clip(value, max = 300) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}
