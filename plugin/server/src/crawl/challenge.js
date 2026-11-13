// Recognizing bot challenges and rate limiting. The crawler uses these only to
// decide when to stop; it never tries to get past a challenge.

/** @import { FetchResult } from '../types.js' */

const CHALLENGE_STATUSES = new Set([403, 429, 503]);
const BODY_MARKERS = ['just a moment', 'cf-chl', 'challenge-platform', 'captcha', 'incapsula'];
/** Only the start of the body is searched for markers. */
const SCAN_BYTES = 128 * 1024;

/** Longest wait the crawler accepts from a Retry-After header. */
export const RETRY_AFTER_MAX_MS = 30_000;

/**
 * True when a response is a bot challenge: a 403, 429 or 503 with
 * `cf-mitigated: challenge` or a known challenge marker in the body.
 * @param {FetchResult} result
 * @returns {boolean}
 */
export function isBotChallenge(result) {
  if (!CHALLENGE_STATUSES.has(result.status)) return false;
  if ((result.headers['cf-mitigated'] ?? '').toLowerCase().includes('challenge')) return true;
  if (result.body === null) return false;
  const text = result.body.subarray(0, SCAN_BYTES).toString('latin1').toLowerCase();
  return BODY_MARKERS.some((marker) => text.includes(marker));
}

/**
 * Milliseconds a `Retry-After` header asks for, between 0 and `RETRY_AFTER_MAX_MS`.
 * Accepts delta-seconds and HTTP dates; anything else gives 0.
 * @param {string|undefined} value
 * @param {Date} now
 * @returns {number}
 */
export function retryAfterMs(value, now) {
  if (typeof value !== 'string') return 0;
  const trimmed = value.trim();
  let ms = 0;
  if (/^\d+$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    const date = Date.parse(trimmed);
    if (!Number.isNaN(date)) ms = date - now.getTime();
  }
  return Math.min(RETRY_AFTER_MAX_MS, Math.max(0, ms));
}
