// The "Observed (not scored)" section of the report (rule set 0.2.1): each
// observation of the run in plain sentences. Pure; nothing in the stored run is
// taken on trust: a value of the wrong type reads as missing, and an
// observation this version does not know is shown by its value names.

/** @import { Run } from '../types.js' */

import { num, obj, str, text } from './values.js';

export const OBSERVED_NOTE = 'These measurements have no pass or fail threshold. They never change a score and are not findings.';

/**
 * @typedef {Object} ObservationView
 * @property {string} title
 * @property {string[]} lines
 * @property {string|null} note
 * @property {string[]} urls
 * @property {string|null} source
 */

const TITLES = /** @type {Record<string, string>} */ ({
  'cro.consent_tool': 'Consent tool',
  'cro.contact_path': 'Ways to make contact',
  'cro.first_action': 'First action element on the start page (HTML order)',
  'sxo.crux_ad_metrics': 'Ads real Chrome users saw (Chrome UX Report, experimental)',
});

const NOTES = /** @type {Record<string, string>} */ ({
  'cro.consent_tool': 'Read from the scripts the pages load and the IAB TCF consent API (__tcfapi). Whether the banner blocks the page cannot be seen without rendering it, and this is not a legal assessment.',
  'cro.contact_path': 'Forms a script adds, and forms inside frames, are not in the HTML and are not seen; an embedded form service is named when its script or frame is on a page. Checkout steps behind a cart are not reached.',
  'cro.first_action': 'This is its place in the HTML\'s order and the words before it there. Style sheets can show it elsewhere, so its visual position (above or below the fold) is not measured.',
  'sxo.crux_ad_metrics': 'The 75th percentile over the last 28 days on phones. Chrome publishes no threshold for these experimental metrics, so none is applied; there is data only for sites with ads and an ads.txt file.',
});

/** @param {unknown} value */
const shown = (value) => (value === null || value === undefined ? 'none' : typeof value === 'boolean' ? (value ? 'yes' : 'no') : String(value));

/**
 * @param {Record<string, unknown>} v
 * @param {string} key
 * @returns {string} "N of M pages read".
 */
const ofPages = (v, key) => `${num(v[key])} of ${num(v.pages_read)} pages read`;

/**
 * Sentences for the observations this version knows; null for another.
 * @param {string} id
 * @param {Record<string, unknown>} v
 * @returns {string[]|null}
 */
function knownLines(id, v) {
  if (id === 'cro.consent_tool') {
    return [
      typeof v.providers === 'string' ? `Consent tool scripts: ${text(v.providers)} (on ${ofPages(v, 'provider_pages')}).` : 'No known consent tool script on the pages read.',
      `IAB TCF consent API on ${ofPages(v, 'tcf_pages')}.`,
    ];
  }
  if (id === 'cro.contact_path') {
    return [
      `Pages with a tel: link: ${ofPages(v, 'tel_pages')}.`,
      `Pages with a mailto: link: ${ofPages(v, 'mailto_pages')}.`,
      `Pages with a form (not a search form): ${ofPages(v, 'form_pages')}.`,
      `Pages that link to a contact page: ${ofPages(v, 'contact_link_pages')}.`,
      typeof v.form_services === 'string' ? `Embedded form services: ${text(v.form_services)} (on ${ofPages(v, 'form_service_pages')}).` : 'No embedded form service seen.',
    ];
  }
  if (id === 'cro.first_action') {
    if (v.found !== true) return ['No button or submit control in the main element (or, without one, in the body).'];
    const where = v.in_main === true ? 'the main element' : 'the body (the page has no main element)';
    return [`The first ${v.tag === 'input' ? 'submit control' : 'button'} in ${where} comes after ${num(v.words_before)} words and ${num(v.elements_before)} elements of the HTML.`];
  }
  if (id === 'sxo.crux_ad_metrics') {
    const parts = [
      ['Ad density (share of the viewport)', v.density], ['Ads shown at once', v.count], ['Ad CPU time', v.cpu_ms === null || v.cpu_ms === undefined ? null : `${shown(v.cpu_ms)} ms`],
      ['Ad network weight', v.kilobytes === null || v.kilobytes === undefined ? null : `${shown(v.kilobytes)} KB`],
    ];
    const period = typeof v.period_first === 'string' && typeof v.period_last === 'string' ? [`Collection period: ${text(v.period_first)} to ${text(v.period_last)}.`] : [];
    return [...parts.map(([label, value]) => `${label}: ${shown(value)}.`), ...period];
  }
  return null;
}

/**
 * The observations of a run as the report shows them, or null when the run has none.
 * @param {Run} run
 * @returns {ObservationView[]|null}
 */
export function viewObservations(run) {
  const list = /** @type {unknown} */ (run.observations);
  if (!Array.isArray(list) || list.length === 0) return null;
  return list.map((entry) => {
    const o = obj(entry);
    const id = str(o.id);
    const values = obj(o.values);
    const title = TITLES[id] ?? text(id, 'Observation');
    if (o.status !== 'measured') {
      return { title, lines: [`Not available: ${text(o.reason, 'no reason recorded.')}`], note: null, urls: [], source: typeof o.source === 'string' ? o.source : null };
    }
    const lines = knownLines(id, values) ?? Object.entries(values).map(([name, value]) => `${name.replace(/_/g, ' ')}: ${shown(value)}`);
    return {
      title, lines, note: NOTES[id] ?? null,
      urls: Array.isArray(o.urls) ? o.urls.filter((url) => typeof url === 'string') : [],
      source: typeof o.source === 'string' ? o.source : null,
    };
  });
}
