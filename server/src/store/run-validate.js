// What a stored run must look like before any tool uses it.
//
// A `.seekwide/` folder can arrive with a repository someone else wrote, so a
// run file is untrusted input. Tools put some of its values into their own
// sentences, file paths and keys: ids, addresses, versions, line numbers, file
// names. Those values are checked here against the forms the plugin writes, and
// a run with any other form is refused as damaged. Free text (titles,
// evidence, recommendations) is not checked here; the tools clip it and return
// it as data.

import { MODULES, SCORE_GROUPS, SEVERITIES } from '../config.js';
import { originOf } from '../util/url.js';

/** Finding ids are the first 16 hex digits of a SHA-1 (util/hash.js shortId). */
const FINDING_ID = /^[0-9a-f]{16}$/;
const CHECK_ID = /^[a-z0-9_]+(?:\.[a-z0-9_]+){1,4}$/;
const MAX_CHECK_ID = 100;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[0-9A-Za-z.]{1,40})?$/;
/** The form `Date.prototype.toISOString` writes. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const JOB_ID = /^[0-9A-Za-z._-]{1,100}$/;
/** Control, format (direction, zero-width, tag) and line separator characters. */
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/** Longer than any URL the crawler stores today, to accept runs saved before URLs were capped. */
const MAX_STORED_URL = 8192;
const MAX_STORED_PATH = 1024;
const FRAMEWORKS = new Set(['next-app', 'html', 'unsupported', 'none']);
const BLOCK_REASONS = new Set(['robots_unreachable', 'robots_disallow', 'bot_challenge', 'rate_limited']);

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isStoredUrl(value) {
  return typeof value === 'string' && value.length <= MAX_STORED_URL && /^https?:\/\/[^\s]+$/i.test(value) && !CONTROL.test(value) && URL.canParse(value);
}

/** How far past this machine's clock a stored date may lie (clocks of two machines differ). */
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * A date in the form `toISOString` writes, and not more than a day after the
 * current time: runs are newest first by date, and a run dated in the future
 * would stay the newest whatever is audited later.
 * @param {unknown} value
 * @param {number} [now]
 * @returns {boolean}
 */
export function isPastDate(value, now = Date.now()) {
  return isIsoDate(value) && Date.parse(/** @type {string} */ (value)) <= now + FUTURE_SLACK_MS;
}

/**
 * A path relative to the project folder: forward slashes, no "." or ".."
 * segment, no control or direction characters.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRelativePath(value) {
  if (typeof value !== 'string' || value === '' || value.length > MAX_STORED_PATH || CONTROL.test(value)) return false;
  if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value)) return false;
  return value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** @param {unknown} value */
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** @param {unknown} value */
const isCount = (value) => Number.isSafeInteger(value) && /** @type {number} */ (value) >= 0;
/** @param {unknown} value */
const isCheckId = (value) => typeof value === 'string' && value.length <= MAX_CHECK_ID && CHECK_ID.test(value);

/**
 * @param {Record<string, unknown>} finding
 * @returns {string|null}
 */
function findingProblem(finding) {
  if (typeof finding.id !== 'string' || !FINDING_ID.test(finding.id)) return 'id';
  if (!isCheckId(finding.check_id)) return 'check_id';
  if (typeof finding.severity !== 'string' || !SEVERITIES.includes(finding.severity)) return 'severity';
  if (finding.url !== null && !isStoredUrl(finding.url)) return 'url';
  if (!Array.isArray(finding.related_urls) || !finding.related_urls.every(isStoredUrl)) return 'related_urls';
  if (finding.line !== undefined && finding.line !== null && !isCount(finding.line)) return 'line';
  const source = finding.source;
  if (source === undefined || source === null) return null;
  if (!isObject(source)) return 'source';
  const { file, line, route } = /** @type {Record<string, unknown>} */ (source);
  if (!isRelativePath(file)) return 'source.file';
  if (line !== null && !(isCount(line) && /** @type {number} */ (line) > 0)) return 'source.line';
  if (route !== null && route !== undefined && typeof route !== 'string') return 'source.route';
  return null;
}

/** @param {string} name @returns {boolean} A module, or a score of its own (`SCORE_GROUPS`) that a module's checks count toward. */
const isScoreKey = (name) => MODULES.includes(name) || Object.hasOwn(SCORE_GROUPS, name);

/**
 * @param {Record<string, unknown>} crawl
 * @returns {string|null}
 */
function crawlProblem(crawl) {
  if (crawl.id !== undefined && (typeof crawl.id !== 'string' || !JOB_ID.test(crawl.id))) return 'crawl.id';
  if (crawl.max_pages !== undefined && crawl.max_pages !== null && !isCount(crawl.max_pages)) return 'crawl.max_pages';
  if (crawl.start_gate !== undefined && !isStoredUrl(crawl.start_gate)) return 'crawl.start_gate';
  if (crawl.start_shell_words !== undefined && !isCount(crawl.start_shell_words)) return 'crawl.start_shell_words';
  const blocked = crawl.blocked;
  if (blocked === undefined || blocked === null) return null;
  if (!isObject(blocked)) return 'crawl.blocked';
  const { reason, url, status, redirected_to: redirectedTo } = /** @type {Record<string, unknown>} */ (blocked);
  if (typeof reason !== 'string' || !BLOCK_REASONS.has(reason)) return 'crawl.blocked.reason';
  if (url !== undefined && url !== null && !isStoredUrl(url)) return 'crawl.blocked.url';
  if (redirectedTo !== undefined && !isStoredUrl(redirectedTo)) return 'crawl.blocked.redirected_to';
  if (status !== undefined && !isCount(status)) return 'crawl.blocked.status';
  return null;
}

/**
 * @param {unknown} repo
 * @returns {string|null}
 */
function repoProblem(repo) {
  if (repo === undefined || repo === null) return null;
  if (!isObject(repo)) return 'repo';
  const { framework, source_dir: sourceDir, deployed_origin: deployed } = /** @type {Record<string, unknown>} */ (repo);
  if (typeof framework !== 'string' || !FRAMEWORKS.has(framework)) return 'repo.framework';
  if (sourceDir !== undefined && sourceDir !== '.' && !isRelativePath(sourceDir)) return 'repo.source_dir';
  if (deployed !== undefined && deployed !== null && (typeof deployed !== 'string' || originOf(deployed) !== deployed)) return 'repo.deployed_origin';
  return null;
}

/**
 * The first field of a stored run that does not have the form the plugin
 * writes, as a dotted name ("findings[3].source.line"), or null when every
 * checked field has it. Only names are returned, never the values.
 *
 * Guarantees: when this returns null, every finding id is 16 hex digits,
 * every check id and module name has the plugin's form, every URL the run
 * names is an http(s) URL without spaces or control characters, line numbers
 * are positive integers, file names are relative paths inside the project
 * without control characters, dates and versions have their fixed forms, and
 * the run is not dated more than a day in the future.
 * @param {Record<string, unknown>} run  A value that passed `isRunShape`.
 * @returns {string|null}
 */
export function storedRunProblem(run) {
  if (!isPastDate(run.created_at)) return 'created_at';
  if (!isStoredUrl(run.start_url)) return 'start_url';
  if (run.site_origin !== undefined && (typeof run.site_origin !== 'string' || originOf(run.site_origin) !== run.site_origin)) return 'site_origin';
  if (run.rules_version !== undefined && (typeof run.rules_version !== 'string' || !VERSION.test(run.rules_version))) return 'rules_version';
  if (run.plugin_version !== undefined && (typeof run.plugin_version !== 'string' || !VERSION.test(run.plugin_version))) return 'plugin_version';
  const requested = run.modules_requested;
  if (requested !== undefined && !(Array.isArray(requested) && requested.every((name) => MODULES.includes(name)))) return 'modules_requested';
  for (const [name, module] of Object.entries(/** @type {object} */ (run.modules))) {
    if (!isScoreKey(name)) return 'modules';
    const score = /** @type {{score?: unknown}|null} */ (module)?.score;
    if (!isObject(module) || !(score === null || score === undefined || (typeof score === 'number' && Number.isFinite(score)))) return `modules.${name}.score`;
  }
  const crawl = crawlProblem(/** @type {Record<string, unknown>} */ (run.crawl));
  if (crawl !== null) return crawl;
  const repo = repoProblem(run.repo);
  if (repo !== null) return repo;
  const findings = /** @type {unknown[]} */ (run.findings);
  for (let i = 0; i < findings.length; i += 1) {
    const finding = findings[i];
    const problem = isObject(finding) ? findingProblem(/** @type {Record<string, unknown>} */ (finding)) : '';
    if (problem !== null) return `findings[${i}]${problem === '' ? '' : `.${problem}`}`;
  }
  const checks = /** @type {unknown[]} */ (run.checks);
  for (let i = 0; i < checks.length; i += 1) {
    const check = /** @type {Record<string, unknown>|null} */ (checks[i]);
    if (!isObject(check) || !isCheckId(check?.id)) return `checks[${i}].id`;
  }
  return null;
}

/**
 * Whether an index entry has the plugin's form, so that `runs_list` returns
 * nothing but a run id, a date, an address, scores by module and a count.
 * @param {Record<string, unknown>} entry  A value with the keys of a RunIndexEntry.
 * @returns {boolean}
 */
export function isStoredEntry(entry) {
  if (!isPastDate(entry.created_at) || !isStoredUrl(entry.start_url) || !isCount(entry.findings) || !isObject(entry.scores)) return false;
  return Object.entries(/** @type {object} */ (entry.scores)).every(([name, score]) => isScoreKey(name) && (score === null || (typeof score === 'number' && Number.isFinite(score))));
}
