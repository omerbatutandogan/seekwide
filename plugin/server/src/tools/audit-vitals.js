// The Core Web Vitals part of audit_run: its arguments, collecting the numbers
// without ever failing the audit, and what goes into the tool result.

/** @import { CrawlResult, VitalsData } from '../types.js' */
/** @import { ToolDeps } from './index.js' */

import { LIMITS } from '../config.js';
import { log } from '../log.js';
import { unavailableVitals } from '../vitals/measure.js';

export const VITALS_FAILED = 'Core Web Vitals could not be measured because of an internal error. The rest of the audit is not affected.';
export const VITALS_NOT_ASKED = 'Core Web Vitals were not measured (check_core_web_vitals was false), so the checks that need them were skipped.';

/** Arguments of audit_run that steer the measurement. */
export const VITALS_ARGUMENTS = Object.freeze({
  check_core_web_vitals: {
    type: 'boolean',
    default: true,
    description:
      'With the seo module, measure Core Web Vitals. This sends the URLs of a few pages to Google: to PageSpeed Insights for a lab test and, ' +
      'when a Google API key is set, to the Chrome UX Report for real-user data. A site on this machine is never sent.',
  },
  core_web_vitals_pages: {
    type: 'integer',
    minimum: 1,
    maximum: LIMITS.vitalsPagesMax,
    default: LIMITS.vitalsPagesDefault,
    description: 'How many pages to measure: the start page, then one page from each of the largest groups of similar pages. Each test takes many seconds.',
  },
});

/**
 * The sentence that says a measurement was taken from an earlier audit.
 * @param {string} measuredAt
 */
export function reusedNote(measuredAt) {
  return `These Core Web Vitals were measured on ${measuredAt} for an earlier audit of this crawl and reused: this audit sent nothing to Google, so the values and the findings based on them match that audit. Crawl the site again for a new measurement.`;
}

/**
 * A measurement under way, shared by the audits of one crawl that wait for it.
 * @typedef {{result: Promise<{vitals: VitalsData, stored: boolean}>, controller: AbortController, waiting: number}} Measurement
 */

/**
 * Ask Google, or take what is stored for the crawl. A measurement that has
 * values from either source is stored; one that has none (Google refused, a
 * site that is not public) is not, so the next audit asks again.
 * @param {ToolDeps} deps
 * @param {CrawlResult} crawl
 * @param {number} maxPages
 * @param {AbortSignal} signal  Fires when every audit waiting for the measurement was cancelled: no request to
 *   Google starts after that, and what was measured is not stored.
 * @returns {Promise<{vitals: VitalsData, stored: boolean}>}  `stored`: taken from an earlier audit.
 */
async function measureOnce(deps, crawl, maxPages, signal) {
  let stored = null;
  try {
    stored = await deps.crawlManager.storedVitals(crawl.id, maxPages);
  } catch (error) {
    log.warn('could not read stored core web vitals', { id: crawl.id, error: String(error) });
  }
  if (stored !== null) return { vitals: { ...stored.vitals, measured_at: stored.measured_at }, stored: true };
  const measuredAt = deps.now().toISOString();
  /** @type {VitalsData} */
  let vitals;
  try {
    vitals = await deps.measureVitals(crawl, { maxPages, signal });
  } catch (error) {
    log.error('core web vitals measurement failed', { error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
    return { vitals: unavailableVitals(crawl.site_origin, VITALS_FAILED), stored: false };
  }
  vitals = { ...vitals, measured_at: measuredAt };
  if ((vitals.lab.available || vitals.field.available) && !signal.aborted) {
    try {
      await deps.crawlManager.storeVitals(crawl.id, maxPages, vitals, measuredAt);
    } catch (error) {
      log.warn('could not store core web vitals', { id: crawl.id, error: String(error) });
    }
  }
  return { vitals, stored: false };
}

/**
 * Core Web Vitals for a crawl, measured once per crawl and page count.
 *
 * Guarantees: Google is asked only when nothing is stored for this crawl and
 * page count and no other audit of it is asking right now; a measurement with
 * values is kept with the crawl, and every later audit of the crawl with the
 * same page count gets those same numbers, marked `reused` with a note that
 * says when they were measured. Whatever goes wrong, the audit goes on: an
 * unexpected error is logged and becomes a result that says nothing was
 * measured.
 * @param {ToolDeps} deps
 * @param {CrawlResult} crawl
 * @param {number} maxPages
 * @param {Map<string, Measurement>} pending  Measurements under way in this server, by crawl and page count.
 * @param {AbortSignal} [signal]  Fires when this audit is cancelled. The measurement stops (no new request to
 *   Google) once every audit waiting for it was cancelled.
 * @returns {Promise<VitalsData>}
 */
export async function collectVitals(deps, crawl, maxPages, pending, signal) {
  const key = `${crawl.id}\n${maxPages}`;
  let measurement = pending.get(key);
  // Another audit of this crawl is measuring: wait for its numbers instead of asking Google twice.
  const joined = measurement !== undefined;
  if (measurement === undefined) {
    const controller = new AbortController();
    const result = measureOnce(deps, crawl, maxPages, controller.signal).finally(() => pending.delete(key));
    measurement = { result, controller, waiting: 0 };
    pending.set(key, measurement);
  }
  const shared = measurement;
  shared.waiting += 1;
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    shared.waiting -= 1;
    if (shared.waiting === 0 && signal?.aborted) shared.controller.abort(signal.reason);
  };
  signal?.addEventListener('abort', leave, { once: true });
  let outcome;
  try {
    outcome = await shared.result;
  } finally {
    signal?.removeEventListener('abort', leave);
    leave();
  }
  const { vitals, stored } = outcome;
  const available = vitals.lab.available || vitals.field.available;
  if (!(stored || (joined && available)) || vitals.measured_at === undefined) return { ...vitals, reused: false };
  return { ...vitals, reused: true, notes: [reusedNote(vitals.measured_at), ...vitals.notes] };
}

/**
 * The measurement as audit_run returns it: which pages were tested and why,
 * their values, why a source gave nothing, when Google was asked and whether
 * an earlier audit's measurement was reused. The notes are returned with the
 * run's other notes.
 * @param {VitalsData|null} vitals
 * @returns {{measured_at: string|null, reused: boolean, lab: VitalsData['lab'], field: VitalsData['field'], origin: VitalsData['origin'], pages: VitalsData['pages']}|null}
 *   Null when the measurement was not asked for. Otherwise every tested page with the reason it was
 *   chosen, in the order it was chosen, whether or not Google returned values for it.
 */
export function vitalsOutput(vitals) {
  if (vitals === null) return null;
  return {
    measured_at: vitals.measured_at ?? null,
    reused: vitals.reused === true,
    lab: { available: vitals.lab.available, reason: vitals.lab.reason, device: vitals.lab.device },
    field: { available: vitals.field.available, reason: vitals.field.reason, form_factor: vitals.field.form_factor },
    origin: vitals.origin,
    pages: vitals.pages,
  };
}

/**
 * @param {{requested: boolean, checked: boolean, vitals: VitalsData|null}} info
 *   `requested`: the seo module ran; `checked`: the measurement was asked for.
 * @returns {string[]} Plain statements about what limits the Core Web Vitals of this run.
 */
export function vitalsNotes({ requested, checked, vitals }) {
  if (!requested) return [];
  if (!checked) return [VITALS_NOT_ASKED];
  return vitals === null ? [] : [...vitals.notes];
}
