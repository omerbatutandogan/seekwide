// The Core Web Vitals part of audit_run: its arguments, collecting the numbers
// without ever failing the audit, and what goes into the tool result.

/** @import { CrawlResult, Observation, VitalsData } from '../types.js' */
/** @import { ToolDeps } from './index.js' */

import { LIMITS } from '../config.js';
import { log } from '../log.js';
import { unavailableVitals } from '../vitals/measure.js';
import { adObservation, ADS_SOURCE } from '../observations/sxo.js';
import { notAvailable } from '../observations/cro.js';

export const VITALS_FAILED = 'Core Web Vitals could not be measured because of an internal error. The rest of the audit is not affected.';
export const ADS_NOT_ASKED = 'The ad metrics were not asked for (check_core_web_vitals was false).';
export const ADS_FAILED = 'The ad metrics could not be asked for because of an internal error. The rest of the audit is not affected.';
export const VITALS_NOT_ASKED = 'Core Web Vitals were not measured (check_core_web_vitals was false), so the checks that need them were skipped.';

/** Arguments of audit_run that steer the measurement. */
export const VITALS_ARGUMENTS = Object.freeze({
  check_core_web_vitals: {
    type: 'boolean',
    default: true,
    description:
      'With the seo or cro module, measure Core Web Vitals. This sends the URLs of a few pages to Google: to PageSpeed Insights for a lab test and, ' +
      'when a Google API key is set, to the Chrome UX Report for real-user data; with the sxo module and a key, the origin for its ad metrics. A site on this machine is never sent. ' +
      'False sends nothing to Google.',
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
 * The sentence that says a measurement was taken from an earlier audit and
 * this audit asked only for Lighthouse's audits it lacked.
 * @param {string} measuredAt
 */
export function auditsAddedNote(measuredAt) {
  return `These Core Web Vitals were measured on ${measuredAt} for an earlier audit of this crawl and reused unchanged; this audit asked PageSpeed Insights only for Lighthouse's accessibility and best-practices audits, which that measurement lacked, and did not ask the Chrome UX Report again.`;
}

export const AUDITS_FAILED = 'Lighthouse\'s accessibility and best-practices audits could not be asked for because of an internal error. The rest of the audit is not affected.';

/**
 * Work under way, shared by the audits of one crawl that wait for it.
 * @typedef {{result: Promise<{vitals: VitalsData, stored: boolean}>, controller: AbortController, waiting: number}} Measurement
 */

/**
 * Ask Google, or take what is stored for the crawl. A measurement that has
 * values from either source is stored; one that has none (Google refused, a
 * site that is not public) is not, so the next audit asks again. A stored
 * measurement is always taken as it is: its values never change.
 * @param {ToolDeps} deps
 * @param {CrawlResult} crawl
 * @param {number} maxPages
 * @param {AbortSignal} signal  Fires when every audit waiting for the measurement was cancelled: no request to
 *   Google starts after that, and what was measured is not stored.
 * @param {boolean} labAudits  A new measurement also asks for Lighthouse's accessibility and best-practices audits.
 * @returns {Promise<{vitals: VitalsData, stored: boolean}>}  `stored`: taken from an earlier audit.
 */
async function measureOnce(deps, crawl, maxPages, signal, labAudits) {
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
    vitals = await deps.measureVitals(crawl, { maxPages, signal, ...(labAudits ? { labAudits } : {}) });
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
 * Add Lighthouse's audits to a measurement made without them, and store the
 * result in its place with the measurement's own date: the Core Web Vitals
 * values stay those measured first (`deps.measureVitals` with `base`).
 * @param {ToolDeps} deps
 * @param {CrawlResult} crawl
 * @param {number} maxPages
 * @param {VitalsData} base
 * @param {AbortSignal} signal
 * @returns {Promise<{vitals: VitalsData, stored: boolean}>}
 */
async function auditsOnce(deps, crawl, maxPages, base, signal) {
  /** @type {VitalsData} */
  let vitals;
  try {
    vitals = await deps.measureVitals(crawl, { maxPages, signal, labAudits: true, base });
  } catch (error) {
    log.error('lab audits failed', { error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
    return { vitals: { ...base, lab: { ...base.lab, audits_requested: true, audits_reason: AUDITS_FAILED } }, stored: true };
  }
  vitals = { ...vitals, measured_at: base.measured_at };
  if (base.measured_at !== undefined && vitals.pages.some((page) => page.lab?.audits !== undefined) && !signal.aborted) {
    try {
      await deps.crawlManager.storeVitals(crawl.id, maxPages, vitals, base.measured_at);
    } catch (error) {
      log.warn('could not store core web vitals', { id: crawl.id, error: String(error) });
    }
  }
  return { vitals, stored: true };
}

/**
 * Run `start` once for all the audits that ask for `key` at the same time,
 * and wait for it. It stops (no new request) once every audit waiting for it
 * was cancelled.
 * @param {Map<string, Measurement>} pending
 * @param {string} key
 * @param {(signal: AbortSignal) => Promise<{vitals: VitalsData, stored: boolean}>} start
 * @param {AbortSignal} [signal]
 * @returns {Promise<{outcome: {vitals: VitalsData, stored: boolean}, joined: boolean}>}  `joined`: another audit started it.
 */
async function shared(pending, key, start, signal) {
  let measurement = pending.get(key);
  const joined = measurement !== undefined;
  if (measurement === undefined) {
    const controller = new AbortController();
    const result = start(controller.signal).finally(() => pending.delete(key));
    measurement = { result, controller, waiting: 0 };
    pending.set(key, measurement);
  }
  const work = measurement;
  work.waiting += 1;
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    work.waiting -= 1;
    if (work.waiting === 0 && signal?.aborted) work.controller.abort(signal.reason);
  };
  signal?.addEventListener('abort', leave, { once: true });
  try {
    return { outcome: await work.result, joined };
  } finally {
    signal?.removeEventListener('abort', leave);
    leave();
  }
}

/**
 * Core Web Vitals for a crawl, measured once per crawl and page count.
 *
 * Guarantees: Google is asked only when nothing is stored for this crawl and
 * page count and no other audit of it is asking right now; once stored, a
 * measurement's values never change, and every later audit of the crawl with
 * the same page count gets those same numbers, marked `reused` with a note
 * that says when they were measured. A cro audit (`labAudits`) of a crawl
 * whose measurement lacks Lighthouse's accessibility and best-practices audits
 * asks PageSpeed Insights only for those, once even when audits run at the
 * same time, and adds them; the Chrome UX Report is not asked again. Whatever
 * goes wrong, the audit goes on: an unexpected error is logged and becomes a
 * result that says nothing was measured.
 * @param {ToolDeps} deps
 * @param {CrawlResult} crawl
 * @param {number} maxPages
 * @param {Map<string, Measurement>} pending  Work under way in this server, by crawl and page count.
 * @param {AbortSignal} [signal]  Fires when this audit is cancelled. The work stops (no new request to
 *   Google) once every audit waiting for it was cancelled.
 * @param {boolean} [labAudits]  Lighthouse's accessibility and best-practices audits are needed (cro module).
 * @returns {Promise<VitalsData>}
 */
export async function collectVitals(deps, crawl, maxPages, pending, signal, labAudits = false) {
  const key = `${crawl.id}\n${maxPages}`;
  const first = await shared(pending, key, (stop) => measureOnce(deps, crawl, maxPages, stop, labAudits), signal);
  let { vitals, stored } = first.outcome;
  let { joined } = first;
  let added = false;
  if (labAudits && vitals.lab.available && vitals.lab.audits_requested !== true) {
    const base = vitals;
    const more = await shared(pending, `${key}\naudits`, (stop) => auditsOnce(deps, crawl, maxPages, base, stop), signal);
    ({ vitals } = more.outcome);
    stored = true;
    added = !more.joined;
    joined ||= more.joined;
  }
  const available = vitals.lab.available || vitals.field.available;
  if (!(stored || (joined && available)) || vitals.measured_at === undefined) return { ...vitals, reused: false };
  return { ...vitals, reused: true, notes: [(added ? auditsAddedNote : reusedNote)(vitals.measured_at), ...vitals.notes] };
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

/**
 * The sxo module's observation of ads: the Chrome UX Report's experimental ad
 * metrics for the audited origin, in a request of their own (`deps.measureAds`,
 * which holds the key). Never throws but when the audit was cancelled: an
 * unexpected error is logged and becomes an observation that says nothing was
 * measured.
 * @param {ToolDeps} deps
 * @param {CrawlResult} crawl
 * @param {{requested: boolean, check: boolean, signal?: AbortSignal}} options  `requested`: the sxo module runs; `check`:
 *   check_core_web_vitals, the switch for every request to Google.
 * @returns {Promise<Observation[]>}  Empty when the module does not run.
 */
export async function collectAds(deps, crawl, { requested, check, signal }) {
  if (!requested) return [];
  if (!check) return [notAvailable('sxo.crux_ad_metrics', ADS_NOT_ASKED, ADS_SOURCE)];
  try {
    return [adObservation(await deps.measureAds(crawl, signal ? { signal } : {}))];
  } catch (error) {
    log.error('ad metrics failed', { error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
    return [notAvailable('sxo.crux_ad_metrics', ADS_FAILED, ADS_SOURCE)];
  }
}

/**
 * For an audit that asked for the cro module: one sentence when Lighthouse's
 * accessibility and best-practices audits came back for some but not all of the
 * tested pages, worked out from the measurement at audit time (whether the
 * audits came with the first measurement or were asked for later); none
 * otherwise. When no page has them, the lab checks are skipped with their own
 * reason instead.
 * @param {VitalsData|null} vitals
 * @param {boolean} croRequested
 * @returns {string[]}
 */
export function labAuditsNotes(vitals, croRequested) {
  if (!croRequested || vitals === null) return [];
  const tested = vitals.pages.length;
  const judged = vitals.pages.filter((page) => page.lab?.audits !== undefined).length;
  if (judged === 0 || judged >= tested) return [];
  return [`Lighthouse's accessibility and best-practices audits came back for ${judged} of ${tested} tested pages, so the two lab checks (tap targets, console errors) judged only ${judged === 1 ? 'that page' : `those ${judged}`}.`];
}
