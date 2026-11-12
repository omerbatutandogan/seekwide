// Core Web Vitals as measured through Google (ARCHITECTURE.md 4.11). No runtime code.

export {};

/**
 * One simulated page load by PageSpeed Insights (Lighthouse on an emulated phone).
 * @typedef {Object} LabMetrics
 * @property {number|null} lcp_ms      Largest Contentful Paint, whole milliseconds.
 * @property {number|null} cls         Cumulative Layout Shift, three decimals.
 * @property {number|null} tbt_ms      Total Blocking Time, whole milliseconds.
 * @property {string|null} lighthouse_version
 * @property {string|null} final_url   URL the test ended on, when Google was redirected away from the tested URL; null otherwise.
 */

/**
 * One metric of a Chrome UX Report record.
 * @typedef {Object} FieldMetric
 * @property {number} p75              75th percentile: milliseconds, or the unitless layout shift score.
 * @property {number|null} good        Share of page loads in the good range, 0–1; null when the histogram does not use the documented boundary.
 */

/**
 * What real Chrome users on phones experienced over the collection period.
 * @typedef {Object} FieldRecord
 * @property {FieldMetric|null} lcp_ms
 * @property {FieldMetric|null} inp_ms
 * @property {FieldMetric|null} cls
 * @property {{first: string, last: string}|null} period  Collection period, YYYY-MM-DD, both days included.
 */

/**
 * @typedef {Object} VitalsPage
 * @property {string} url
 * @property {string} why              Why this page was chosen, for example "Start page".
 * @property {LabMetrics|null} lab
 * @property {string|null} lab_note    Why there is no lab data for this page; null when there is.
 * @property {FieldRecord|null} field
 * @property {string|null} field_note  Why there is no field data for this page; null when there is.
 */

/**
 * Core Web Vitals collected for one audit. Stored in the run as `core_web_vitals`.
 * @typedef {Object} VitalsData
 * @property {{available: boolean, reason: string|null, device: 'mobile'}} lab
 *   `available`: PageSpeed Insights returned values for one or more pages. `reason` says why not.
 * @property {{available: boolean, reason: string|null, form_factor: 'phone'}} field
 *   `available`: the Chrome UX Report API answered, with a record or with "no data". `reason` says why not.
 * @property {{origin: string, field: FieldRecord|null, field_note: string|null}} origin  The whole site.
 * @property {VitalsPage[]} pages      The tested pages, in the order they were chosen.
 * @property {string[]} notes          Plain statements about anything that limits what the numbers say.
 * @property {string} [measured_at]    ISO 8601: when Google was asked. Set by audit_run; absent in runs stored before it existed.
 * @property {boolean} [reused]        True when audit_run took the measurement from an earlier audit of the same crawl
 *   instead of asking Google again. Absent in runs stored before it existed.
 */
