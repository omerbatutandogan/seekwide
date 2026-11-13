// Which column of an exported table holds what. Neither Google nor Microsoft
// documents the header row of an export, so a metric column is known by the
// name the tool's own help page gives that metric, in the languages listed
// below, and the column that is not a metric is known by its content: page
// addresses or dates. Sources, read on 2026-11-13:
//   https://support.google.com/webmasters/answer/7576553?hl=en  Clicks, Impressions, CTR (click-through rate), Average position
//   https://support.google.com/webmasters/answer/7576553?hl=tr  Tıklama sayısı, Gösterim sayısı, TO (Tıklama oranı), Ortalama konum
//   https://www.bing.com/webmasters/help/search-performance-c680da36  Clicks, Impressions, Avg. CTR, Avg. position,
//     Average Click-Through Rate(CTR), Average Position
// The help pages also name the chart's figures "total clicks, total impressions, average CTR and average position"
// ("toplam tıklama sayısı, toplam gösterim sayısı, ortalama TO'su ve ortalama konumu"), so a leading "total",
// "average", "avg." ("toplam", "ortalama") is allowed, and so is a closing part in brackets.

/** @typedef {import('./xlsx.js').Cell} Cell */
/** @typedef {'clicks'|'impressions'|'ctr'|'position'} Metric */

import { looksLikePageUrl, parseDate } from './values.js';

/** Metric names after `fold`, without a qualifier or a part in brackets. */
const METRIC_NAMES = /** @type {Record<Metric, string[]>} */ ({
  clicks: ['clicks', 'tiklama sayisi'],
  impressions: ['impressions', 'gosterim sayisi'],
  ctr: ['ctr', 'click-through rate', 'to', 'tiklama orani'],
  position: ['position', 'konum'],
});
const QUALIFIERS = ['total ', 'average ', 'avg. ', 'avg ', 'toplam ', 'ortalama '];

/** The metric names Seekwide reads, as the help pages write them, for messages. */
export const KNOWN_HEADERS =
  'Clicks, Impressions, CTR, Position, Average position, Avg. CTR, Avg. position (English); ' +
  'Tıklama sayısı, Gösterim sayısı, TO (Tıklama oranı), Ortalama konum (Turkish)';

/**
 * Lower case, Turkish dotted and dotless i folded to i and the other letters to
 * their base letter, whitespace collapsed: "TIKLAMA SAYISI", "Tıklama sayısı"
 * and "tiklama sayisi" are one name.
 * @param {string} value
 * @returns {string}
 */
function fold(value) {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ı/g, 'i')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The metric a header names, or null.
 * @param {Cell|undefined} header
 * @returns {Metric|null}
 */
export function metricOf(header) {
  if (typeof header !== 'string' || header.length > 100) return null;
  let name = fold(header).replace(/\s*\([^()]*\)$/, '').trim();
  const qualifier = QUALIFIERS.find((prefix) => name.startsWith(prefix));
  if (qualifier) name = name.slice(qualifier.length);
  for (const [metric, names] of Object.entries(METRIC_NAMES)) {
    if (names.includes(name)) return /** @type {Metric} */ (metric);
  }
  return null;
}

/**
 * @typedef {Object} TableShape
 * @property {'pages'|'dates'|'filters'|'other'} kind
 *   `pages`: one column of page addresses with clicks and impressions; `dates`: one column of dates with clicks and
 *   impressions; `filters`: two columns and no metric (the export's record of its filters); `other`: anything else
 *   (queries, countries, devices, search appearance, or a table Seekwide does not know).
 * @property {number} key  The column of the addresses or dates; -1 for other kinds.
 * @property {Partial<Record<Metric, number>>} metrics  The column of each metric found.
 * @property {number[]} duplicated  Metrics found in two columns, by the second column's 1-based number.
 * @property {number} width  The number of columns the header names.
 */

/**
 * What a table is, from its header row and its content.
 *
 * Guarantees: `pages` and `dates` need exactly one column that is not a
 * metric, clicks and impressions each in exactly one column, and every value
 * of the other column to be a page address (text that starts with http:// or
 * https://) or a date written YYYY-MM-DD; a table with a metric in two columns
 * is `other` and lists them in `duplicated`.
 * @param {Cell[][]} rows  The header row first.
 * @returns {TableShape}
 */
export function tableShape(rows) {
  const header = rows[0] ?? [];
  /** @type {Partial<Record<Metric, number>>} */
  const metrics = {};
  /** @type {number[]} */
  const duplicated = [];
  /** @type {number[]} */
  const others = [];
  header.forEach((cell, column) => {
    const metric = metricOf(cell);
    if (metric === null) others.push(column);
    else if (metrics[metric] === undefined) metrics[metric] = column;
    else duplicated.push(column + 1);
  });
  const none = { kind: /** @type {const} */ ('other'), key: -1, metrics, duplicated, width: header.length };
  if (duplicated.length > 0) return none;
  if (Object.keys(metrics).length === 0) return header.length === 2 ? { ...none, kind: 'filters' } : none;
  if (metrics.clicks === undefined || metrics.impressions === undefined || others.length !== 1) return none;
  const key = others[0];
  const values = rows.slice(1).map((row) => row[key]).filter((cell) => cell !== '' && cell !== undefined);
  if (values.length === 0) return none;
  if (values.every(looksLikePageUrl)) return { ...none, kind: 'pages', key };
  if (values.every((cell) => parseDate(cell) !== null)) return { ...none, kind: 'dates', key };
  return none;
}
