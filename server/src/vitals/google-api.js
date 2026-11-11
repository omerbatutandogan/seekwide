// One JSON request to a Google API, sent through safeFetch, with the answer
// sorted into data or one of a few kinds of failure. The API key travels in a
// request header, as Google recommends, so it is never part of a URL, a log
// line, a stored file or a tool result.

import { LIMITS } from '../config.js';
import { safeFetch } from '../net/safe-fetch.js';

/** @import { SafeFetchOptions } from '../net/safe-fetch.js' */

/**
 * @typedef {'quota'|'key_invalid'|'permission'|'not_found'|'bad_request'|'server_error'|'timeout'|'network'|'page_error'|'bad_response'} ApiFailureKind
 *   `page_error`: the service answered, but could not test the page it was given.
 */

/**
 * Why a request gave no data. It never carries text written by the service,
 * because such text can name the user's Google Cloud project.
 * @typedef {Object} ApiFailure
 * @property {ApiFailureKind} kind
 * @property {number} status        HTTP status; 0 when there was no response.
 * @property {string|null} reason   Google's machine-readable reason (for example "API_KEY_INVALID") or the code of a network error.
 */

/**
 * @typedef {Object} ApiRequestOptions
 * @property {'GET'|'POST'} [method]
 * @property {unknown} [body]        Sent as JSON; only with POST.
 * @property {string|null} [apiKey]
 * @property {typeof safeFetch} [fetch]
 * @property {SafeFetchOptions} [fetchOptions]  Tests pass `allowLoopback` here.
 * @property {number} [timeoutMs]
 * @property {number} [maxBytes]
 */

/** Machine-readable codes only: upper-case words joined by underscores. */
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Failures that asking again during the same audit cannot cure. */
const SERVICE_FAILURES = new Set(['quota', 'key_invalid', 'permission', 'network']);

const SERVICE_NAMES = Object.freeze({ psi: 'PageSpeed Insights', crux: 'The Chrome UX Report API' });

/** What was wrong with an answer that arrived, by the reason a client gave. */
const BAD_RESPONSES = Object.freeze({
  TOO_LARGE: 'sent an answer that was too large to read',
  NOT_MOBILE: 'tested the page as a desktop browser, not as the phone that was asked for',
  NO_METRICS: 'sent an answer without any of the lab metrics',
});

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>} The value when it is a plain object, otherwise an empty one.
 */
export function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/**
 * @param {unknown} value  A number, or a string holding one (the Chrome UX Report sends some numbers as strings).
 * @returns {number|null} A finite number that is zero or above, otherwise null.
 */
export function nonNegative(value) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/**
 * Google's machine-readable reason for an error, from `error.details[].reason`
 * or, failing that, `error.status`.
 * @param {Record<string, unknown>} error
 * @returns {string|null}
 */
function reasonOf(error) {
  for (const detail of Array.isArray(error.details) ? error.details : []) {
    const reason = asObject(detail).reason;
    if (typeof reason === 'string' && CODE.test(reason)) return reason;
  }
  return typeof error.status === 'string' && CODE.test(error.status) ? error.status : null;
}

/**
 * Send one request to a Google API and read the JSON answer.
 *
 * Guarantees: the request goes through `safeFetch` and follows no redirect, so
 * the key is sent to the named URL only, in the `x-goog-api-key` header; a
 * failure is returned, never thrown, and holds only a kind, the HTTP status and
 * a machine-readable reason; `not_found` is reported only when Google itself
 * says so in a JSON error, so a wrong address is not mistaken for "no data".
 *
 * @param {string} url
 * @param {ApiRequestOptions} [options]
 * @returns {Promise<{ok: true, data: Record<string, unknown>} | {ok: false, failure: ApiFailure}>}
 */
export async function requestJson(url, options = {}) {
  const { method = 'GET', body, apiKey = null, fetch = safeFetch, fetchOptions = {} } = options;
  const { timeoutMs = LIMITS.requestTimeoutMs, maxBytes = LIMITS.maxBodyBytes } = options;
  /** @type {Record<string, string>} */
  const headers = { accept: 'application/json' };
  if (apiKey !== null) headers['x-goog-api-key'] = apiKey;
  /** @type {SafeFetchOptions} */
  const request = { ...fetchOptions, method, headers, timeoutMs, maxBytes, maxRedirects: 0 };
  if (method === 'POST') {
    headers['content-type'] = 'application/json';
    request.body = JSON.stringify(body ?? {});
  }

  /** @param {ApiFailureKind} kind @param {number} status @param {string|null} reason */
  const fail = (kind, status, reason) => ({ ok: /** @type {const} */ (false), failure: { kind, status, reason } });

  const result = await fetch(url, request);
  if (result.error !== null) return fail(result.error.code === 'timeout' ? 'timeout' : 'network', 0, result.error.code);

  /** @type {unknown} */
  let payload;
  if (result.body !== null && !result.truncated) {
    try {
      payload = JSON.parse(result.body.toString('utf8'));
    } catch {
      payload = undefined;
    }
  }
  const { status } = result;
  if (status >= 200 && status < 300) {
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return fail('bad_response', status, result.truncated ? 'TOO_LARGE' : null);
    return { ok: true, data: /** @type {Record<string, unknown>} */ (payload) };
  }

  const error = asObject(asObject(payload).error);
  const reason = reasonOf(error);
  if (status === 429 || error.status === 'RESOURCE_EXHAUSTED') return fail('quota', status, reason);
  if (reason === 'API_KEY_INVALID' || reason === 'API_KEY_EXPIRED') return fail('key_invalid', status, reason);
  if (status === 401 || status === 403) return fail('permission', status, reason);
  if (status === 404) return fail(error.status === 'NOT_FOUND' ? 'not_found' : 'bad_response', status, reason);
  if (status >= 400 && status < 500) return fail('bad_request', status, reason);
  if (status >= 500) return fail('server_error', status, reason);
  return fail('bad_response', status, reason);
}

/**
 * True when the failure concerns the service or the key and not one page, so
 * the remaining requests of this audit would fail the same way.
 * @param {ApiFailure} failure
 * @returns {boolean}
 */
export function isServiceFailure(failure) {
  return SERVICE_FAILURES.has(failure.kind);
}

/**
 * One plain sentence about a failure: what happened and, where the user can do
 * something about it, what to do.
 * @param {'psi'|'crux'} service
 * @param {ApiFailure} failure
 * @param {boolean} hasKey  Whether the request carried an API key.
 * @returns {string}
 */
export function describeFailure(service, failure, hasKey) {
  const name = SERVICE_NAMES[service];
  const code = failure.reason ? `, ${failure.reason}` : '';
  switch (failure.kind) {
    case 'quota':
      return hasKey
        ? `${name} refused the request: the quota of the Google API key is used up for now. Try again later.`
        : `${name} refused the request: Google's quota for requests without an API key is used up. Add a Google API key in the plugin settings.`;
    case 'key_invalid':
      return `${name} did not accept the Google API key. Check the key in the plugin settings.`;
    case 'permission':
      return hasKey
        ? `${name} refused the Google API key. Enable this API for the key's Google Cloud project and check the key's restrictions.`
        : `${name} refused the request because it carried no API key. Add a Google API key in the plugin settings.`;
    case 'timeout':
      return `${name} did not answer in time.`;
    case 'network':
      return `${name} could not be reached (${failure.reason ?? 'network error'}).`;
    case 'not_found':
      return `${name} has no data for this address.`;
    case 'bad_request':
      return `${name} could not handle the request (HTTP ${failure.status}${code}).`;
    case 'server_error':
      return `${name} answered with an error of its own (HTTP ${failure.status}${code}).`;
    case 'page_error':
      return `${name} could not load the page (${failure.reason ?? 'no reason given'}).`;
    default: {
      const known = failure.reason !== null && Object.hasOwn(BAD_RESPONSES, failure.reason);
      if (known) return `${name} ${BAD_RESPONSES[/** @type {keyof typeof BAD_RESPONSES} */ (failure.reason)]}.`;
      return `${name} sent an answer that could not be read${failure.status ? ` (HTTP ${failure.status})` : ''}.`;
    }
  }
}
