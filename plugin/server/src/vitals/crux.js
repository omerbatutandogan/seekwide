// Chrome UX Report (CrUX) client: what real Chrome users on phones experienced
// on a site or on one page over the last 28 days.
//
// API reference, read on 2026-11-11 together with the API's discovery
// document (revision 20261110): https://developer.chrome.com/docs/crux/api
// The API requires a key and allows 150 queries a minute per Google Cloud
// project; an audit sends at most 11.

import { LIMITS } from '../config.js';
import { asObject, nonNegative, requestJson } from './google-api.js';
import { THRESHOLDS } from './thresholds.js';

/** @import { FieldMetric, FieldRecord } from '../types.js' */
/** @import { ApiFailure, ApiRequestOptions } from './google-api.js' */

export const CRUX_ENDPOINT = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

/** The API's names for the three Core Web Vitals. */
const METRICS = Object.freeze({
  lcp_ms: 'largest_contentful_paint',
  inp_ms: 'interaction_to_next_paint',
  cls: 'cumulative_layout_shift',
});

/**
 * @param {unknown} raw   One entry of `record.metrics`.
 * @param {keyof typeof METRICS} key
 * @returns {FieldMetric|null} Null when the record has no 75th percentile for the metric.
 */
function readMetric(raw, key) {
  const metric = asObject(raw);
  const p75 = nonNegative(asObject(metric.percentiles).p75);
  if (p75 === null) return null;
  // The first histogram bin is the good range. Its share is reported only when
  // Google draws the boundary where this plugin does. Google's bin ends just
  // below the boundary and the good range includes it, so the share can be a
  // hair lower than "at or below the threshold"; it is shown as a whole percentage.
  const first = asObject(Array.isArray(metric.histogram) ? metric.histogram[0] : null);
  const density = nonNegative(first.density);
  const sameBoundary = nonNegative(first.start) === 0 && nonNegative(first.end) === THRESHOLDS[key].good;
  return {
    // Layout shift arrives as a string with two decimals; the times are whole milliseconds.
    p75: key === 'cls' ? Math.round(p75 * 100) / 100 : Math.round(p75),
    good: sameBoundary && density !== null && density <= 1 ? Math.round(density * 10_000) / 10_000 : null,
  };
}

/**
 * @param {unknown} raw  `{year, month, day}`.
 * @returns {string|null} "YYYY-MM-DD", or null when the date is not a real calendar date.
 */
function readDate(raw) {
  const { year, month, day } = asObject(raw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const [y, m, d] = /** @type {number[]} */ ([year, month, day]);
  if (y < 2000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Ask the Chrome UX Report for the phone record of one origin or one page.
 *
 * Guarantees: one POST request through `safeFetch`, naming only that origin or
 * URL to Google besides the key; no redirect is followed; "Google has no data
 * for it" is a normal answer (`record: null`), reported only when Google says
 * so itself; every other problem is returned as a failure, never thrown; a
 * record for another form factor is refused; times are whole milliseconds and
 * the layout shift score has two decimals.
 *
 * @param {{url: string} | {origin: string}} target
 * @param {Pick<ApiRequestOptions, 'fetch'|'fetchOptions'|'timeoutMs'> & {apiKey: string, endpoint?: string}} options
 *   `endpoint` is for tests.
 * @returns {Promise<{ok: true, record: FieldRecord|null} | {ok: false, failure: ApiFailure}>}
 */
export async function queryCrux(target, options) {
  const { apiKey, endpoint = CRUX_ENDPOINT, fetch, fetchOptions, timeoutMs = LIMITS.requestTimeoutMs } = options;
  const identifier = 'url' in target ? { url: target.url } : { origin: target.origin };
  const response = await requestJson(endpoint, {
    method: 'POST',
    body: { ...identifier, formFactor: 'PHONE', metrics: Object.values(METRICS) },
    apiKey, fetch, fetchOptions, timeoutMs,
  });
  if (!response.ok) return response.failure.kind === 'not_found' ? { ok: true, record: null } : response;

  const record = asObject(response.data.record);
  const formFactor = asObject(record.key).formFactor;
  if (typeof formFactor === 'string' && formFactor !== 'PHONE') {
    return { ok: false, failure: { kind: 'bad_response', status: 200, reason: null } };
  }
  const metrics = asObject(record.metrics);
  const lcp = readMetric(metrics[METRICS.lcp_ms], 'lcp_ms');
  const inp = readMetric(metrics[METRICS.inp_ms], 'inp_ms');
  const cls = readMetric(metrics[METRICS.cls], 'cls');
  if (lcp === null && inp === null && cls === null) return { ok: true, record: null };

  const period = asObject(record.collectionPeriod);
  const first = readDate(period.firstDate);
  const last = readDate(period.lastDate);
  return {
    ok: true,
    record: { lcp_ms: lcp, inp_ms: inp, cls, period: first !== null && last !== null ? { first, last } : null },
  };
}
