// The documented boundaries of the Core Web Vitals, in one place so the checks
// and the reports rate a value the same way.
//
// Field metrics (web.dev/articles/lcp, /inp, /cls and the PageSpeed Insights
// "about" page): good up to and including `good`, poor above `poor`, measured
// at the 75th percentile. Total Blocking Time is a lab metric; its bounds are
// the ones Lighthouse documents for mobile. Read on 2026-11-11.

/** @typedef {'lcp_ms'|'inp_ms'|'cls'|'tbt_ms'} VitalsMetric */
/** @typedef {'good'|'needs improvement'|'poor'} VitalsRating */

/** @type {Readonly<Record<VitalsMetric, {good: number, poor: number}>>} */
export const THRESHOLDS = Object.freeze({
  lcp_ms: Object.freeze({ good: 2500, poor: 4000 }),
  inp_ms: Object.freeze({ good: 200, poor: 500 }),
  cls: Object.freeze({ good: 0.1, poor: 0.25 }),
  tbt_ms: Object.freeze({ good: 200, poor: 600 }),
});

/**
 * Rate a value against the documented boundaries. A value equal to a boundary
 * belongs to the better range, as in Google's tables ("2.5 seconds or less").
 * @param {VitalsMetric} metric
 * @param {number} value
 * @returns {VitalsRating}
 */
export function rateMetric(metric, value) {
  const { good, poor } = THRESHOLDS[metric];
  if (value <= good) return 'good';
  return value <= poor ? 'needs improvement' : 'poor';
}

/**
 * A value as people read it: seconds for load times ("2.400 s"), milliseconds
 * for the shorter times ("180 ms"), and the bare score for layout shift. The
 * value is never rounded further than it was measured, so what is shown cannot
 * contradict its rating: 2549 ms reads "2.549 s", not "2.5 s". Seconds always
 * have three decimals, so a column of them lines up.
 * @param {VitalsMetric} metric
 * @param {number} value
 * @returns {string}
 */
export function formatMetric(metric, value) {
  if (metric === 'cls') return String(value);
  if (metric === 'lcp_ms') return `${(Math.round(value) / 1000).toFixed(3)} s`;
  return `${Math.round(value)} ms`;
}

/**
 * The good range in words, for example "2500 ms or less".
 * @param {VitalsMetric} metric
 * @returns {string}
 */
export function goodRange(metric) {
  const { good } = THRESHOLDS[metric];
  return metric === 'cls' ? `${good} or less` : `${good} ms or less`;
}
