// The stored form of a run: `<project>/.seekwide/runs/<run_id>/findings.json`.
//
// A finding repeats its check's title, recommendation, documentation link,
// severity and the other fields every finding of that check shares. On a large
// site that is most of the file, so the stored form writes those fields once per
// check, under `finding_defaults`, and keeps in each finding only what differs.
// Reading joins them back. A run written before this form existed has no
// `finding_defaults` and whole findings, and reads unchanged.

/** @import { Run } from '../types.js' */

import { storeError } from './errors.js';
import { STORE_LIMITS } from './fs-util.js';
import { MAX_URL_LENGTH } from '../util/url.js';
import { clipStoredUrl, isRunShape, storedRunProblem } from './run-validate.js';

/**
 * Finding fields that can be written once per check: the check's constants, and `line` and `fix`, which
 * are the same (often 1 and null) for many findings of a check. Only scalar values are written once.
 */
const SHARED_FIELDS = Object.freeze(['module', 'engine', 'title', 'severity', 'weight', 'impact', 'effort', 'confidence', 'status', 'line', 'recommendation', 'fix', 'doc_ref', 'detected_at']);
const SHARED = new Set(SHARED_FIELDS);

/** The order of a finding's keys as the check engine writes them; `source` is added in repo mode. */
const FINDING_KEYS = Object.freeze([
  'id', 'check_id', 'module', 'engine', 'title', 'severity', 'weight', 'impact', 'effort', 'confidence', 'status',
  'url', 'selector', 'line', 'evidence', 'related_urls', 'recommendation', 'fix', 'doc_ref', 'detected_at', 'source',
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value */
const isScalar = (value) => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));

/**
 * The stored form of `run`: the same object with `finding_defaults` added and
 * each shared field left out of every finding whose value equals its check's.
 * A field is shared by a check only when every finding of the check has it,
 * with a scalar value; the check's value is its first finding's.
 * @param {Run} run
 * @returns {Record<string, unknown>}
 */
export function packRun(run) {
  /** @type {Map<string, Record<string, unknown>>} */
  const defaults = new Map();
  const records = /** @type {Record<string, unknown>[]} */ (/** @type {unknown} */ (run.findings));
  for (const record of records) {
    const checkId = /** @type {string} */ (record.check_id);
    const shared = defaults.get(checkId);
    /** @param {string} field */
    const present = (field) => Object.hasOwn(record, field) && record[field] !== undefined && isScalar(record[field]);
    if (shared === undefined) {
      defaults.set(checkId, Object.fromEntries(SHARED_FIELDS.filter(present).map((field) => [field, record[field]])));
    } else {
      // A field a later finding lacks is not shared: written once, it would come back on that finding too.
      for (const field of Object.keys(shared)) if (!present(field)) delete shared[field];
    }
  }
  const findings = records.map((record) => {
    const own = /** @type {Record<string, unknown>} */ (defaults.get(/** @type {string} */ (record.check_id)));
    return Object.fromEntries(Object.entries(record).filter(([key, value]) => !(Object.hasOwn(own, key) && own[key] === value)));
  });
  return { ...run, findings, finding_defaults: Object.fromEntries(defaults) };
}

/**
 * @param {Record<string, unknown>} finding
 * @param {Record<string, unknown>|null} shared
 * @returns {Record<string, unknown>}
 */
function joinFinding(finding, shared) {
  /** @type {Record<string, unknown>} */
  const whole = {};
  for (const key of FINDING_KEYS) {
    if (Object.hasOwn(finding, key)) whole[key] = finding[key];
    else if (shared !== null && Object.hasOwn(shared, key)) whole[key] = shared[key];
  }
  for (const [key, value] of Object.entries(finding)) {
    if (!Object.hasOwn(whole, key)) whole[key] = value;
  }
  return whole;
}

/**
 * A stored run with its findings made whole again, or the name of the field
 * that keeps it from being joined. `finding_defaults` must map check ids to
 * objects of shared fields with scalar values; anything else is damage.
 * @param {Record<string, unknown>} stored  A value that passed `isRunShape`.
 * @returns {{run: Record<string, unknown>, problem: null}|{run: null, problem: string}}
 */
export function unpackRun(stored) {
  const { finding_defaults: table, ...run } = stored;
  if (table === undefined) return { run, problem: null };
  if (!isObject(table)) return { run: null, problem: 'finding_defaults' };
  for (const shared of Object.values(table)) {
    if (!isObject(shared) || !Object.entries(shared).every(([key, value]) => SHARED.has(key) && isScalar(value))) {
      return { run: null, problem: 'finding_defaults' };
    }
  }
  run.findings = /** @type {unknown[]} */ (run.findings).map((finding) => {
    if (!isObject(finding)) return finding;
    const checkId = finding.check_id;
    const shared = typeof checkId === 'string' && Object.hasOwn(table, checkId) ? /** @type {Record<string, unknown>} */ (table[checkId]) : null;
    return joinFinding(finding, shared);
  });
  return { run, problem: null };
}

/**
 * The text `saveRun` writes for `run`: the stored form as compact JSON. The text
 * is read back with `parseStoredRun` before it is returned, so a run that is
 * saved can always be loaded, and it loads as it was saved.
 *
 * Throws `RUN_INVALID` naming the first field without the form the plugin
 * stores (`storedRunProblem`, applied to the run and to the text read back), or
 * a URL longer than the 2048 characters the crawler keeps (it would be cut when
 * read), and `RUN_TOO_LARGE` when the text is larger than `STORE_LIMITS.runBytes`.
 * @param {Run} run  A value that passed `isRunShape`.
 * @returns {string}
 */
export function serializeRun(run) {
  /** @param {string} field */
  const invalid = (field) => storeError('RUN_INVALID', `The audit produced a run whose ${field} does not have the form the plugin stores, so it was not saved.`);
  const problem = storedRunProblem(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (run))) ?? longUrlField(run);
  if (problem !== null) throw invalid(problem);
  const text = `${JSON.stringify(packRun(run))}\n`;
  const bytes = Buffer.byteLength(text);
  if (bytes > STORE_LIMITS.runBytes) {
    throw storeError(
      'RUN_TOO_LARGE',
      `The run has ${run.findings.length} findings, which take ${Math.round(bytes / 1024)} KB, more than the ` +
        `${Math.round(STORE_LIMITS.runBytes / 1024)} KB a saved run may hold, so it was not saved.`,
    );
  }
  // What JSON makes of the run (an array hole becomes null, for one) is checked as loadRun will check it.
  const readBack = parseStoredRun(text, run.run_id);
  if (readBack.run === null) throw invalid(readBack.problem.replace(/ in its findings\.json.*$/, ''));
  return text;
}

/**
 * The first URL of a run longer than the 2048 characters the crawler keeps, as a field name, or null.
 * @param {Run} run
 * @returns {string|null}
 */
function longUrlField(run) {
  if (run.start_url.length > MAX_URL_LENGTH) return 'start_url';
  for (let i = 0; i < run.findings.length; i += 1) {
    const { url, related_urls: related } = run.findings[i];
    if (url !== null && url.length > MAX_URL_LENGTH) return `findings[${i}].url`;
    if (related.some((item) => item.length > MAX_URL_LENGTH)) return `findings[${i}].related_urls`;
  }
  return null;
}

/**
 * Parse the text of a stored run. Returns the run, or the reason it is refused
 * in words that name fields, never their values.
 *
 * Guarantees: a returned run passed `isRunShape`, has the id `runId`, and passed
 * `storedRunProblem` after its findings were made whole; its start URL and the
 * URLs of its findings are at most 2048 characters long (`clipStoredUrl`).
 * @param {string} text
 * @param {string} runId
 * @returns {{run: Run, problem: null}|{run: null, problem: string}}
 */
export function parseStoredRun(text, runId) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { run: null, problem: 'its findings.json is not valid JSON' };
  }
  if (!isRunShape(parsed) || parsed.run_id !== runId) return { run: null, problem: 'its findings.json does not describe this run' };
  const joined = unpackRun(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (parsed)));
  const field = joined.run === null ? joined.problem : storedRunProblem(joined.run);
  if (field !== null) return { run: null, problem: `${field} in its findings.json does not have the form the plugin writes` };
  const run = /** @type {Run} */ (/** @type {unknown} */ (joined.run));
  run.start_url = clipStoredUrl(run.start_url);
  for (const finding of run.findings) {
    if (finding.url !== null) finding.url = clipStoredUrl(finding.url);
    finding.related_urls = finding.related_urls.map(clipStoredUrl);
  }
  return { run, problem: null };
}
