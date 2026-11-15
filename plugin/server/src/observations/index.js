// The observations of an audit (rule set 0.2.1): measurements without a
// pass/fail threshold, stored in `Run.observations` and shown in their own
// report section. They never change a score and are not findings. Pure.

/** @import { CheckContext, Observation } from '../types.js' */

import { MAX_ANCESTORS } from '../extract/form-markup.js';
import { MAX_CONTROLS, MAX_FORMS, MAX_IDS, MAX_SEEN_CONTROLS } from '../extract/forms.js';
import { croObservations, formsFailedPages } from './cro.js';

/** Modules that observe something. */
export const OBSERVING_MODULES = Object.freeze(['cro', 'sxo']);

/**
 * The observations of the modules that ran, in a fixed order; null when none
 * of them observes anything.
 * @param {CheckContext} ctx
 * @param {string[]} modules
 * @param {{sxo?: Observation[]}} [collected]  Observations collected before the checks ran (the sxo module's Chrome UX
 *   Report query), given in their place.
 * @returns {Observation[]|null}
 */
export function buildObservations(ctx, modules, collected = {}) {
  if (!OBSERVING_MODULES.some((name) => modules.includes(name))) return null;
  return [
    ...(modules.includes('cro') ? croObservations(ctx) : []),
    ...(modules.includes('sxo') ? collected.sxo ?? [] : []),
  ];
}

/**
 * The notes on what limits the observations and the checks that read forms.
 * @param {CheckContext} ctx
 * @param {string[]} modules
 * @returns {string[]}
 */
export function observationNotes(ctx, modules) {
  if (!modules.includes('cro')) return [];
  let failed = 0;
  try {
    failed = formsFailedPages(ctx);
  } catch {
    failed = 0;
  }
  /** @param {string} name */
  const pagesWith = (name) => ctx.htmlPages.filter((page) => Array.isArray(page.limits_reached) && page.limits_reached.includes(name)).length;
  /** @param {number} n */
  const pages = (n) => (n === 1 ? '1 page' : `${n} pages`);
  const forms = pagesWith('forms');
  const controls = pagesWith('forms.controls');
  return [
    ...(failed === 0 ? [] : [`The forms of ${pages(failed)} could not be read, so those pages are not units of the checks that read forms and are not counted in the observations.`]),
    ...(forms === 0 ? [] : [`${pages(forms)} had more than ${MAX_FORMS} forms; the first ${MAX_FORMS} were read and the rest were not checked.`]),
    ...(controls === 0 ? [] : [`${pages(controls)} had more form controls than are kept (${MAX_CONTROLS} visible ones, ${MAX_SEEN_CONTROLS} looked at); the checks judged the controls that were kept, and the rest were not checked.`]),
    ...(pagesWith('forms.depth') === 0 ? [] : [`${pages(pagesWith('forms.depth'))} had form controls nested more than ${MAX_ANCESTORS} elements deep; they were not judged, since an element above them that was not read could hide them.`]),
    ...(pagesWith('forms.ids') === 0 ? [] : [`${pages(pagesWith('forms.ids'))} had more than ${MAX_IDS} element ids; a field named by an id past those was not judged.`]),
  ];
}
