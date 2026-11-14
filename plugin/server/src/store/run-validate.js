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
import { MAX_URL_LENGTH, originOf } from '../util/url.js';
import { isValidRunId } from './project.js';

/** @import { Run } from '../types.js' */

/**
 * Minimal shape every stored run must have for the store and the reports to work with it.
 * @param {unknown} value
 * @returns {value is Run}
 */
export function isRunShape(value) {
  const run = /** @type {Record<string, unknown>|null} */ (value);
  return (
    run !== null &&
    typeof run === 'object' &&
    isValidRunId(run.run_id) &&
    typeof run.created_at === 'string' &&
    typeof run.start_url === 'string' &&
    Array.isArray(run.findings) &&
    Array.isArray(run.checks) &&
    run.modules !== null &&
    typeof run.modules === 'object' &&
    !Array.isArray(run.modules) &&
    run.crawl !== null &&
    typeof run.crawl === 'object'
  );
}

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
 * A stored URL as the tools hand it on: whole up to `MAX_URL_LENGTH` (2048)
 * characters, the longest URL the crawler keeps; a longer one, which only a run
 * written by hand or before URLs were capped can hold, is cut there and ends in
 * "…", so it cannot be taken for a real address.
 * @param {string} url
 * @returns {string}
 */
export function clipStoredUrl(url) {
  return url.length <= MAX_URL_LENGTH ? url : `${url.slice(0, MAX_URL_LENGTH - 1)}…`;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isStoredUrl(value) {
  return typeof value === 'string' && value.length <= MAX_STORED_URL && /^https?:\/\/[^\s]+$/i.test(value) && !CONTROL.test(value) && URL.canParse(value);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIsoDate(value) {
  return typeof value === 'string' && ISO_DATE.test(value) && !Number.isNaN(Date.parse(value));
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
 * @param {unknown} count
 * @returns {boolean} Absent, null, or the count of a score given as one: `passed` of `of`, whole numbers up to 1000.
 */
const isScoreCount = (count) => {
  if (count === undefined || count === null) return true;
  if (!isObject(count)) return false;
  const { passed, of } = /** @type {Record<string, unknown>} */ (count);
  return isCount(passed) && isCount(of) && /** @type {number} */ (passed) <= /** @type {number} */ (of) && /** @type {number} */ (of) <= 1000;
};

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

const APP_FILE_OUTCOMES = new Set(['answered', 'not_found', 'unverifiable', 'disallowed']);
/** A host as `hostName` writes it: lower case letters, digits, hyphens and dots (an international name in its xn-- form). */
const PLAIN_HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/;

/**
 * True for a host name in the form a run stores in `not_requested.hosts`, so
 * that what an audit writes there is always what a later read accepts.
 * @param {unknown} host
 * @returns {host is string}
 */
export const isStoredHost = (host) => typeof host === 'string' && PLAIN_HOST.test(host);
const MAX_NOT_REQUESTED_HOSTS = 20;

/**
 * What the smo and aso modules stored (rule set 0.1.9): the sharing images,
 * the app association files and what was not requested by rule.
 * @param {Record<string, unknown>} run
 * @returns {string|null}
 */
function sharingProblem(run) {
  const social = run.social_images;
  if (social !== undefined && social !== null) {
    if (!isObject(social)) return 'social_images';
    const { images, selected, sized, outcomes, local } = /** @type {Record<string, unknown>} */ (social);
    if (![images, selected, sized].every(isCount) || typeof local !== 'boolean') return 'social_images';
    if (!isObject(outcomes) || !Object.values(/** @type {object} */ (outcomes)).every(isCount)) return 'social_images.outcomes';
  }
  const files = run.app_files;
  if (files !== undefined && files !== null) {
    if (!isObject(files)) return 'app_files';
    for (const name of ['aasa', 'assetlinks']) {
      const file = /** @type {Record<string, unknown>} */ (files)[name];
      if (!isObject(file)) return `app_files.${name}`;
      const { url, outcome, status } = /** @type {Record<string, unknown>} */ (file);
      if (!isStoredUrl(url)) return `app_files.${name}.url`;
      if (typeof outcome !== 'string' || !APP_FILE_OUTCOMES.has(outcome) || !isCount(status)) return `app_files.${name}`;
    }
  }
  const skipped = run.not_requested;
  if (skipped !== undefined && skipped !== null) {
    if (!isObject(skipped)) return 'not_requested';
    const { links, images, social_images: socialImages, hosts } = /** @type {Record<string, unknown>} */ (skipped);
    if (![links, images, socialImages].every(isCount)) return 'not_requested';
    if (!Array.isArray(hosts) || hosts.length > MAX_NOT_REQUESTED_HOSTS || !hosts.every(isStoredHost)) return 'not_requested.hosts';
  }
  return null;
}

const AI_POLICY_VALUES = new Set(['allow_all', 'allow_search', 'block_all']);
const ROBOTS_STATUSES = new Set(['ok', 'missing', 'unreachable']);
const TRAINING_PREFERENCES = new Set(['disallow', 'allow', 'empty', 'none', 'unknown']);
const LLMS_OUTCOMES = new Set(['found', 'not_found', 'unverifiable', 'disallowed']);
/**
 * A crawler token as a run stores it: the form of a robots.txt product token, not membership of the current bot data,
 * which is refreshed every month; a run written with older data stays readable.
 */
const AI_TOKEN = /^[A-Za-z0-9_-]{1,64}$/;
/** More tokens than the bot data will plausibly ever hold. */
export const MAX_STORED_AI_AGENTS = 200;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What the ai module stored (rule set 0.2.0). Every value has a fixed form: a
 * date, a policy, statuses, the tokens of the plugin's own bot data with a
 * boolean each, a count, and /llms.txt's address with an outcome and status.
 * @param {unknown} ai
 * @returns {string|null}
 */
function aiProblem(ai) {
  if (ai === undefined || ai === null) return null;
  if (!isObject(ai)) return 'ai';
  const { bots_verified: verified, policy, robots, agents, training_preference: training, preference_lines: lines, llms_txt: llms } = /** @type {Record<string, unknown>} */ (ai);
  if (typeof verified !== 'string' || !DAY.test(verified)) return 'ai.bots_verified';
  if (policy !== null && !(typeof policy === 'string' && AI_POLICY_VALUES.has(policy))) return 'ai.policy';
  if (robots !== null && !(typeof robots === 'string' && ROBOTS_STATUSES.has(robots))) return 'ai.robots';
  const refused = /** @type {Record<string, unknown>} */ (ai).robots_refused;
  if (refused !== undefined && !isCount(refused)) return 'ai.robots_refused';
  const failed = /** @type {Record<string, unknown>} */ (ai).robots_error;
  if (failed !== undefined && failed !== true) return 'ai.robots_error';
  if (!Array.isArray(agents) || agents.length > MAX_STORED_AI_AGENTS) return 'ai.agents';
  for (let i = 0; i < agents.length; i += 1) {
    const agent = agents[i];
    if (!isObject(agent) || typeof agent.token !== 'string' || !AI_TOKEN.test(agent.token) || typeof agent.allowed !== 'boolean') return `ai.agents[${i}]`;
  }
  if (typeof training !== 'string' || !TRAINING_PREFERENCES.has(training)) return 'ai.training_preference';
  if (!isCount(lines)) return 'ai.preference_lines';
  if (llms !== null) {
    if (!isObject(llms)) return 'ai.llms_txt';
    const { url, outcome, status } = /** @type {Record<string, unknown>} */ (llms);
    if (!isStoredUrl(url)) return 'ai.llms_txt.url';
    if (typeof outcome !== 'string' || !LLMS_OUTCOMES.has(outcome) || !isCount(status)) return 'ai.llms_txt';
  }
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
 * without control characters, the hosts listed as not requested are plain
 * host names, and dates and versions have their fixed forms.
 * @param {Record<string, unknown>} run  A value that passed `isRunShape`.
 * @returns {string|null}
 */
export function storedRunProblem(run) {
  // Any date is accepted, the future included: a run saved while the clock was wrong is still a run.
  // The index keeps runs in the order they were saved (run-index.js), so a date cannot make a run the newest.
  if (!isIsoDate(run.created_at)) return 'created_at';
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
    if (!isScoreCount(/** @type {{count?: unknown}} */ (module).count)) return `modules.${name}.count`;
  }
  const crawl = crawlProblem(/** @type {Record<string, unknown>} */ (run.crawl));
  if (crawl !== null) return crawl;
  const repo = repoProblem(run.repo);
  if (repo !== null) return repo;
  const sharing = sharingProblem(run);
  if (sharing !== null) return sharing;
  const ai = aiProblem(run.ai);
  if (ai !== null) return ai;
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
 * nothing but a run id, a date, an address, scores by module, the scores
 * given as counts, and a count of findings.
 * @param {Record<string, unknown>} entry  A value with the keys of a RunIndexEntry.
 * @returns {boolean}
 */
export function isStoredEntry(entry) {
  if (!isIsoDate(entry.created_at) || !isStoredUrl(entry.start_url) || !isCount(entry.findings) || !isObject(entry.scores)) return false;
  if (entry.counts !== undefined && !(isObject(entry.counts) && Object.entries(/** @type {object} */ (entry.counts)).every(([name, count]) => isScoreKey(name) && count !== null && isScoreCount(count)))) return false;
  return Object.entries(/** @type {object} */ (entry.scores)).every(([name, score]) => isScoreKey(name) && (score === null || (typeof score === 'number' && Number.isFinite(score))));
}
