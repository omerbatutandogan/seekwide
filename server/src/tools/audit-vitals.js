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
 * Measure Core Web Vitals for a crawl. Whatever goes wrong, the audit goes on:
 * an unexpected error is logged and becomes a result that says nothing was measured.
 * @param {ToolDeps} deps
 * @param {CrawlResult} crawl
 * @param {number} maxPages
 * @returns {Promise<VitalsData>}
 */
export async function collectVitals(deps, crawl, maxPages) {
  try {
    return await deps.measureVitals(crawl, { maxPages });
  } catch (error) {
    log.error('core web vitals measurement failed', { error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
    return unavailableVitals(crawl.site_origin, VITALS_FAILED);
  }
}

/**
 * The measurement as audit_run returns it: which pages were tested and why,
 * their values, and why a source gave nothing. The notes are returned with
 * the run's other notes.
 * @param {VitalsData|null} vitals
 * @returns {{lab: VitalsData['lab'], field: VitalsData['field'], origin: VitalsData['origin'], pages: VitalsData['pages']}|null}
 *   Null when the measurement was not asked for. Otherwise every tested page with the reason it was
 *   chosen, in the order it was chosen, whether or not Google returned values for it.
 */
export function vitalsOutput(vitals) {
  if (vitals === null) return null;
  return {
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
