// PageSpeed Insights client: one lab test of one page on an emulated phone.
//
// API reference, read on 2026-11-11 together with the API's discovery
// document (revision 20261109):
// https://developers.google.com/speed/docs/insights/rest/v5/pagespeedapi/runpagespeed
//
// The answer also carries Chrome UX Report data (`loadingExperience`). Google
// plans to stop including it and recommends the Chrome UX Report API, so this
// client reads the lab result only; field data comes from crux.js.

import { LIMITS } from '../config.js';
import { normalizeUrl } from '../util/url.js';
import { asObject, nonNegative, requestJson } from './google-api.js';

/** @import { LabMetrics } from '../types.js' */
/** @import { ApiFailure, ApiRequestOptions } from './google-api.js' */

export const PSI_ENDPOINT = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed';

/** Lighthouse audit ids of the three lab metrics. */
const AUDITS = Object.freeze({
  lcp: 'largest-contentful-paint',
  cls: 'cumulative-layout-shift',
  tbt: 'total-blocking-time',
});

const VERSION = /^[0-9A-Za-z.+-]{1,40}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const MAX_URL_LENGTH = 2048;

/**
 * @param {ApiFailure['kind']} kind
 * @param {string|null} reason
 * @returns {{ok: false, failure: ApiFailure}}
 */
const fail = (kind, reason) => ({ ok: false, failure: { kind, status: 200, reason } });

/**
 * The numeric value of one audit; null when the audit is missing, failed, or
 * holds something that is not a measurement.
 * @param {Record<string, unknown>} audits
 * @param {string} id
 * @returns {number|null}
 */
function auditValue(audits, id) {
  const audit = asObject(audits[id]);
  if (audit.scoreDisplayMode === 'error' || typeof audit.numericValue !== 'number') return null;
  return nonNegative(audit.numericValue);
}

/**
 * Read the lab metrics out of a PageSpeed Insights answer.
 * @param {Record<string, unknown>} data
 * @param {string} pageUrl
 * @returns {{ok: true, lab: LabMetrics} | {ok: false, failure: ApiFailure}}
 */
function readLab(data, pageUrl) {
  const lighthouse = asObject(data.lighthouseResult);

  // Lighthouse reports a page it could not load here, with HTTP 200.
  const runtimeCode = asObject(lighthouse.runtimeError).code;
  if (typeof runtimeCode === 'string' && runtimeCode !== '' && runtimeCode !== 'NO_ERROR') {
    return fail('page_error', CODE.test(runtimeCode) ? runtimeCode : null);
  }

  // The thresholds used here are the mobile ones, so a desktop run must not be rated with them.
  const settings = asObject(lighthouse.configSettings);
  const formFactor = settings.formFactor ?? settings.emulatedFormFactor;
  if (typeof formFactor === 'string' && formFactor.toLowerCase() !== 'mobile') return fail('bad_response', 'NOT_MOBILE');

  const audits = asObject(lighthouse.audits);
  const lcp = auditValue(audits, AUDITS.lcp);
  const cls = auditValue(audits, AUDITS.cls);
  const tbt = auditValue(audits, AUDITS.tbt);
  if (lcp === null && cls === null && tbt === null) return fail('bad_response', 'NO_METRICS');

  const version = lighthouse.lighthouseVersion;
  const ended = lighthouse.finalDisplayedUrl ?? lighthouse.finalUrl;
  const finalUrl = typeof ended === 'string' && ended.length <= MAX_URL_LENGTH ? normalizeUrl(ended) : null;
  return {
    ok: true,
    lab: {
      lcp_ms: lcp === null ? null : Math.round(lcp),
      cls: cls === null ? null : Math.round(cls * 1000) / 1000,
      tbt_ms: tbt === null ? null : Math.round(tbt),
      lighthouse_version: typeof version === 'string' && VERSION.test(version) ? version : null,
      final_url: finalUrl !== null && finalUrl !== normalizeUrl(pageUrl) ? finalUrl : null,
    },
  };
}

/**
 * Ask PageSpeed Insights to load one page on an emulated phone and return its
 * lab metrics: Largest Contentful Paint, Cumulative Layout Shift and Total
 * Blocking Time.
 *
 * Guarantees: one GET request through `safeFetch`, with the page URL as the
 * only thing named to Google besides the key; no redirect is followed; a
 * refusal, a timeout, a page Google could not load and an unreadable answer are
 * returned as a failure, never thrown; a desktop result is refused, because the
 * values are rated against the mobile thresholds; times are whole milliseconds
 * and the layout shift score has three decimals.
 *
 * @param {string} pageUrl  An absolute http(s) URL.
 * @param {Pick<ApiRequestOptions, 'apiKey'|'fetch'|'fetchOptions'|'timeoutMs'> & {endpoint?: string}} [options]
 *   Without `apiKey` the request is sent without one. `endpoint` is for tests.
 * @returns {Promise<{ok: true, lab: LabMetrics} | {ok: false, failure: ApiFailure}>}
 */
export async function runPagespeed(pageUrl, options = {}) {
  const { apiKey = null, endpoint = PSI_ENDPOINT, fetch, fetchOptions, timeoutMs = LIMITS.psiTimeoutMs } = options;
  const query = new URLSearchParams({ url: pageUrl, category: 'PERFORMANCE', strategy: 'MOBILE' });
  const response = await requestJson(`${endpoint}?${query}`, {
    apiKey, fetch, fetchOptions, timeoutMs, maxBytes: LIMITS.psiMaxBodyBytes,
  });
  return response.ok ? readLab(response.data, pageUrl) : response;
}
