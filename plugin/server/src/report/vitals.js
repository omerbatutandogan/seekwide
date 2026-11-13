// The Core Web Vitals section of the report, built from what a run stored.
// A run is a JSON file that people can edit, so every value is coerced before
// it is shown, and every value is rated here with the same thresholds the
// checks use.

/** @import { Run } from '../types.js' */
/** @import { VitalsMetric, VitalsRating } from '../vitals/thresholds.js' */

import { clip } from '../util/strings.js';
import { formatMetric, rateMetric } from '../vitals/thresholds.js';
import { NO_DATA, NO_DATA_RUN, SEARCH_LAYER_EMPTY, STATIC_LAYERS, VITALS_LEGEND } from './copy.js';
import { plural } from './facts.js';
import { obj, str, text } from './values.js';

const NOTE_MAX = 600;
const MAX_ROWS = 10;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** @typedef {{value: string, rating: VitalsRating}} VitalsCell */

/** Columns of the table, in display order. Field first: it is what users got. */
const COLUMNS = /** @type {const} */ ([
  { label: 'LCP (field)', source: 'field', metric: 'lcp_ms' },
  { label: 'INP (field)', source: 'field', metric: 'inp_ms' },
  { label: 'CLS (field)', source: 'field', metric: 'cls' },
  { label: 'LCP (lab)', source: 'lab', metric: 'lcp_ms' },
  { label: 'CLS (lab)', source: 'lab', metric: 'cls' },
  { label: 'TBT (lab)', source: 'lab', metric: 'tbt_ms' },
]);

/**
 * @param {VitalsMetric} metric
 * @param {unknown} value
 * @returns {VitalsCell|null} Null when the run holds no usable number.
 */
function cell(metric, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return { value: formatMetric(metric, value), rating: rateMetric(metric, value) };
}

/**
 * The cells of one row, one per column: a field cell reads the 75th
 * percentile of the record, a lab cell the measured value.
 * @param {unknown} field
 * @param {unknown} lab
 * @returns {(VitalsCell|null)[]}
 */
function cells(field, lab) {
  const records = { field: obj(field), lab: obj(lab) };
  return COLUMNS.map(({ source, metric }) => {
    const raw = records[source][metric];
    return cell(metric, source === 'field' ? obj(raw).p75 : raw);
  });
}

/**
 * @param {unknown} field  A field record.
 * @returns {string} ", collected 2026-10-12 to 2026-11-08", or '' when the record has no valid period.
 */
function periodText(field) {
  const period = obj(obj(field).period);
  const first = str(period.first);
  const last = str(period.last);
  return DATE.test(first) && DATE.test(last) ? `, collected ${first} to ${last}` : '';
}

/**
 * Build the Core Web Vitals section from a run.
 *
 * Guarantees: null when the run did not ask for the measurement (or was stored
 * before it existed); otherwise one status line per source that says what was
 * collected or why nothing was; a table that holds only the columns with one
 * or more values, with the whole-site row first; and the run's own notes, less
 * those a status line already states.
 *
 * @param {Run} run
 */
export function viewVitals(run) {
  const raw = /** @type {{core_web_vitals?: unknown}} */ (run).core_web_vitals;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const vitals = obj(raw);
  const lab = obj(vitals.lab);
  const field = obj(vitals.field);
  const origin = obj(vitals.origin);
  const pages = (Array.isArray(vitals.pages) ? vitals.pages : []).slice(0, MAX_ROWS).map(obj);

  const originCells = cells(origin.field, null);
  const originHasData = originCells.some((entry) => entry !== null);
  const pageRows = pages.map((page) => ({
    label: null,
    url: str(page.url),
    why: text(page.why),
    cells: cells(page.field, page.lab),
  }));
  const allRows = [
    ...(originHasData ? [{ label: 'Whole site', url: null, why: text(origin.origin), cells: originCells }] : []),
    ...pageRows,
  ];
  const shown = COLUMNS.map((_, index) => allRows.some((row) => row.cells[index] !== null));
  const columns = COLUMNS.filter((_, index) => shown[index]).map(({ label }) => label);
  const rows = columns.length === 0 ? [] : allRows.map((row) => ({ ...row, cells: row.cells.filter((_, index) => shown[index]) }));

  const labPages = pageRows.filter((row) => row.cells.some((entry, index) => entry !== null && COLUMNS[index].source === 'lab')).length;
  const fieldPages = pageRows.filter((row) => row.cells.some((entry, index) => entry !== null && COLUMNS[index].source === 'field')).length;
  const covered = [...(originHasData ? ['the site as a whole'] : []), ...(fieldPages > 0 ? [plural(fieldPages, 'tested page')] : [])];
  const period = periodText(origin.field) || pages.map((page) => periodText(page.field)).find(Boolean) || '';

  let labStatus = text(lab.reason, 'Not collected.');
  if (lab.available === true) labStatus = `PageSpeed Insights tested ${labPages} of ${plural(pages.length, 'page')} on an emulated phone.`;
  let fieldStatus = text(field.reason, 'Not collected.');
  if (field.available === true) {
    fieldStatus = covered.length > 0
      ? `The Chrome UX Report has data from real Chrome users on phones for ${covered.join(' and ')}${period}.`
      : 'The Chrome UX Report has no phone data for this site or for the tested pages.';
  }

  const sources = [
    { label: 'Lab data', value: clip(labStatus, NOTE_MAX) },
    { label: 'Field data', value: clip(fieldStatus, NOTE_MAX) },
  ];
  // A note that only repeats why a source gave nothing is already on the page.
  const notes = (Array.isArray(vitals.notes) ? vitals.notes : [])
    .filter((note) => typeof note === 'string')
    .slice(0, 20)
    .map((note) => clip(text(note), NOTE_MAX))
    .filter((note) => note !== '' && !sources.some((source) => source.value === note));

  return {
    sources,
    columns,
    rows,
    labPages,
    testedPages: pages.length,
    fieldCovered: covered,
    fieldAvailable: field.available === true,
    fieldReason: clip(text(field.reason), NOTE_MAX),
    legend: VITALS_LEGEND,
    notes,
  };
}

/** @typedef {NonNullable<ReturnType<typeof viewVitals>>} VitalsView */

/**
 * One sentence for the factual summary; null when the run has no measurement.
 * @param {VitalsView|null} view
 * @returns {string|null}
 */
export function describeVitals(view) {
  if (view === null) return null;
  if (view.labPages === 0 && view.fieldCovered.length === 0) {
    return 'Core Web Vitals could not be measured; the Core Web Vitals section says why.';
  }
  const lab = view.labPages > 0 ? `lab results for ${view.labPages} of ${plural(view.testedPages, 'tested page')}` : 'no lab results';
  const field = view.fieldCovered.length > 0 ? `real-user data for ${view.fieldCovered.join(' and ')}` : 'no real-user data';
  return `Core Web Vitals: ${lab}; ${field}.`;
}

/** @typedef {{name: string, measured: boolean, status: string, text: string, detail: string|null}} LayerView */

/**
 * The five layers of reporting, with the experience layer filled in from this
 * run: measured when real-user data arrived, otherwise "no data in this run"
 * with the reason; and the search visibility layer from imported data when
 * there is some, otherwise "no data in this run" with where the data comes from.
 * @param {VitalsView|null} view
 * @param {LayerView|null} [search]  The search visibility layer of imported data (report/search.js).
 * @returns {LayerView[]}
 */
export function viewLayers(view, search = null) {
  const fixed = STATIC_LAYERS.map((layer) => {
    if (layer.name === SEARCH_LAYER_EMPTY.name) return search ?? { ...SEARCH_LAYER_EMPTY };
    return {
      name: layer.name,
      measured: layer.measured,
      status: layer.measured ? 'Measured in this run' : NO_DATA,
      text: layer.text,
      detail: layer.measured ? null : `Planned source: ${layer.source}`,
    };
  });
  /** @type {LayerView} */
  let experience;
  if (view !== null && view.fieldCovered.length > 0) {
    experience = {
      name: 'Experience',
      measured: true,
      status: 'Measured in this run',
      text: `Real-user Core Web Vitals from the Chrome UX Report, for ${view.fieldCovered.join(' and ')}. The values are in the Core Web Vitals section. Not covered: usability and analytics data.`,
      detail: null,
    };
  } else {
    let why = 'It was not asked in this run.';
    if (view !== null) why = view.fieldAvailable ? 'It has no data for this site or for the tested pages.' : view.fieldReason || 'It gave no data in this run.';
    const lab = view !== null && view.labPages > 0 ? ' Lab test results, which are simulated and not real-user data, are in the Core Web Vitals section.' : '';
    experience = {
      name: 'Experience',
      measured: false,
      status: NO_DATA_RUN,
      text: 'Real-user speed and usability of the pages.',
      detail: `Source: the Chrome UX Report. ${why}${lab}`,
    };
  }
  // Experience sits fourth, between AI visibility and business results.
  return [...fixed.slice(0, 3), experience, ...fixed.slice(3)];
}
