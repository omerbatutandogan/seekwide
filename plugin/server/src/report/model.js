/** @import { Run } from '../types.js' */
/** @import { RunComparison } from '../store/compare.js' */
/** @import { SearchEntry } from './search.js' */

import { countText } from '../checks/scoring.js';
import { SEVERITIES } from '../config.js';
import { InputError } from '../util/errors.js';
import { clip, collapseWhitespace } from '../util/strings.js';
import { methodSections, reportTitle } from './copy.js';
import { changeList, groupByCheck, viewFinding, withLimits } from './findings.js';
import { viewFixes } from './fixes.js';
import { factualSummary, moduleLabel } from './facts.js';
import { REPO_FRAMEWORKS, orderModules, startFacts, unreadablePages, viewBlock, viewScope } from './scope.js';
import { compareText, num, obj, str, text } from './values.js';
import { prioritize, searchLayer, viewSearch } from './search.js';
import { describeVitals, viewLayers, viewVitals } from './vitals.js';

const DEFAULT_MAX_URLS = 10;
const TOP_FIX_GROUPS = 10;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LOGO = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * @param {string} iso
 * @returns {{long: string, iso: string}}
 */
function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { long: clip(iso, 40), iso: clip(iso, 40) };
  return { long: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`, iso: date.toISOString().slice(0, 10) };
}

/**
 * Check and normalize the options. Throws `InputError` for text of the caller's
 * that cannot be rendered faithfully (a recommendation without a title or
 * detail), so a caller mistake is never hidden in a report, and `TypeError` for
 * an option of the wrong type, which the tool never passes.
 * @param {Run} run
 * @param {object} options
 */
function readOptions(run, options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('The report options must be an object.');
  const o = obj(options);
  if (o.brandName !== undefined && typeof o.brandName !== 'string') throw new TypeError('brandName must be a string.');
  const maxUrls = o.maxUrlsPerCheck ?? DEFAULT_MAX_URLS;
  if (!Number.isInteger(maxUrls) || /** @type {number} */ (maxUrls) < 1) throw new TypeError('maxUrlsPerCheck must be a positive integer.');
  if (o.executiveSummary !== undefined && typeof o.executiveSummary !== 'string') throw new TypeError('executiveSummary must be a string.');
  if (o.logoDataUri !== undefined && !(typeof o.logoDataUri === 'string' && LOGO.test(o.logoDataUri))) {
    throw new TypeError('logoDataUri must be a base64 data URI of a PNG, JPEG, WebP or SVG image.');
  }
  const recommendations = o.recommendations ?? [];
  if (!Array.isArray(recommendations)) throw new TypeError('recommendations must be an array of {title, detail}.');
  const search = o.search ?? [];
  if (!Array.isArray(search) || !search.every((entry) => obj(entry).data !== undefined && obj(entry).match !== undefined)) {
    throw new TypeError('search must be an array of {data, match}.');
  }
  const comparison = o.comparison ?? null;
  if (comparison !== null && obj(comparison).run_id !== run.run_id) {
    throw new TypeError(`The comparison belongs to run ${String(obj(comparison).run_id)}, not to run ${run.run_id}.`);
  }
  return {
    maxUrls: /** @type {number} */ (maxUrls),
    summary: str(o.executiveSummary).trim(),
    logo: /** @type {string|undefined} */ (o.logoDataUri),
    brand: text(o.brandName).slice(0, 200),
    comparison: /** @type {RunComparison|null} */ (comparison),
    search: /** @type {SearchEntry[]} */ (search),
    recommendations: recommendations.map((item, index) => {
      const entry = obj(item);
      const title = text(entry.title);
      const detail = str(entry.detail).trim();
      if (!title || !detail) throw new InputError(`recommendations[${index}] needs a non-empty title and detail.`);
      return { title, detail };
    }),
  };
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
const roundedOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null);

/**
 * A stored count of a score given as one, checked again: whole numbers, `passed` at most `of`. Null otherwise.
 * @param {unknown} value
 * @returns {{passed: number, of: number}|null}
 */
function viewCount(value) {
  const { passed, of } = obj(value);
  return Number.isSafeInteger(passed) && Number.isSafeInteger(of) && 0 <= /** @type {number} */ (passed) && /** @type {number} */ (passed) <= /** @type {number} */ (of)
    ? { passed: /** @type {number} */ (passed), of: /** @type {number} */ (of) }
    : null;
}

/**
 * The text of a score that is given as a count, or null for a score of 0 to 100.
 * @param {string} name
 * @param {unknown} value
 * @returns {string|null}
 */
function countView(name, value) {
  const count = viewCount(value);
  return count === null ? null : countText(name, count);
}

/**
 * @param {RunComparison} comparison
 */
function viewComparison(comparison) {
  const scores = obj(comparison.scores);
  const list = (/** @type {unknown} */ value) => (Array.isArray(value) ? value : []);
  return {
    baseRunId: str(comparison.base_run_id),
    runId: str(comparison.run_id),
    persisting: num(comparison.persisting),
    resolved: changeList(list(comparison.resolved).map(viewFinding)),
    added: changeList(list(comparison.added).map(viewFinding)),
    scores: orderModules(Object.keys(scores)).map((name) => {
      const entry = obj(scores[name]);
      return {
        label: moduleLabel(name), from: roundedOrNull(entry.from), to: roundedOrNull(entry.to), delta: roundedOrNull(entry.delta),
        // A score given as a count is shown as the count ("2 of 3 recommended headers set").
        fromText: countView(name, entry.from_count), toText: countView(name, entry.to_count),
      };
    }),
    notes: list(comparison.notes).filter((note) => typeof note === 'string').map((note) => clip(note, 600)),
  };
}

/**
 * @param {Run} run
 */
function viewScores(run) {
  const modules = obj(run.modules);
  return orderModules(Object.keys(modules)).map((name) => {
    const m = obj(modules[name]);
    const counted = countView(name, m.count);
    const score = counted === null && typeof m.score === 'number' && Number.isFinite(m.score) ? Math.min(100, Math.max(0, Math.round(m.score))) : null;
    return {
      module: name,
      label: moduleLabel(name),
      score,
      // A score given as a count ("0 of 3 recommended headers set"), shown instead of a number out of 100.
      counted,
      coverage: Math.min(1, Math.max(0, num(m.coverage))),
      checksRun: num(m.checks_run),
      checksTotal: num(m.checks_total),
      checksSkipped: num(m.checks_skipped),
      // Why there is no score. Runs stored before the note existed have none.
      note: score === null && counted === null ? text(m.note) || null : null,
    };
  });
}

/**
 * Build the format-neutral content of the report. Both renderers display this
 * same structure, so Markdown and HTML always agree. Pure: depends only on its
 * arguments, and dates come from `run.created_at`.
 * @param {Run} run
 * @param {object} [options] Same options as `renderMarkdown`.
 */
export function buildReport(run, options = {}) {
  if (run === null || typeof run !== 'object' || !Array.isArray(run.findings) || !Array.isArray(run.checks)) {
    throw new TypeError('A report needs a Run with `findings` and `checks` arrays.');
  }
  const opts = readOptions(run, options);
  const crawl = obj(run.crawl);
  const findings = run.findings.map(viewFinding);
  // With imported search data, groups of one severity are ordered by the impressions of their pages (report/search.js).
  const groups = withLimits(prioritize(groupByCheck(findings), opts.search), opts.maxUrls);
  const severityCounts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));
  const checksRun = run.checks.filter((check) => check.status === 'run').length;
  // A crawl blocked before any page was read: count the checks that had anything to look at, not those that ran on nothing.
  const blockedUnread = obj(crawl.blocked).reason !== undefined && crawl.html_pages === 0;
  const checksWithUnits = run.checks.filter((check) => check.status === 'run' && num(obj(check).applicable) > 0).length;
  const scores = viewScores(run);
  const blocked = viewBlock(crawl.blocked);
  const vitals = viewVitals(run);
  let host = text(run.site_origin);
  try {
    host = new URL(str(run.start_url)).host || host;
  } catch {
    // An unparsable start URL is shown as stored.
  }

  const factual = () =>
    factualSummary({
      host,
      pages: num(crawl.pages_crawled),
      htmlPages: num(crawl.html_pages),
      indexablePages: num(crawl.indexable_pages),
      maxPages: num(crawl.max_pages),
      checksRun,
      checksTotal: run.checks.length,
      findings: findings.length,
      checksWithFindings: groups.length,
      severityCounts,
      scores: scores.map(({ label, score, counted }) => ({ label, score, counted })),
      truncated: crawl.truncated === true,
      timeLimited: crawl.time_limit_reached === true,
      blocked,
      unreadablePages: unreadablePages(run),
      vitals: describeVitals(vitals),
      nothingRead: blockedUnread,
      ...startFacts(crawl),
    });

  return {
    title: reportTitle(run.modules_requested),
    host,
    startUrl: str(run.start_url),
    runId: str(run.run_id),
    date: formatDate(str(run.created_at)),
    brand: opts.brand,
    logo: opts.logo,
    summary: opts.summary
      ? { written: true, paragraphs: opts.summary.split(/\n\s*\n/).map((p) => collapseWhitespace(p)).filter(Boolean) }
      : { written: false, paragraphs: factual() },
    figures: [
      { label: 'Pages crawled', value: String(num(crawl.pages_crawled)) },
      { label: 'Findings', value: String(findings.length) },
      { label: 'Critical or high', value: String(severityCounts.critical + severityCounts.high) },
      blockedUnread
        ? { label: 'Checks with anything to check', value: `${checksWithUnits} of ${run.checks.length}` }
        : { label: 'Checks run', value: `${checksRun} of ${run.checks.length}` },
    ],
    scope: viewScope(run, { host, blocked }),
    fixes: viewFixes(run),
    layers: viewLayers(vitals, opts.search.length > 0 ? searchLayer(opts.search) : null),
    search: viewSearch(opts.search, findings),
    scores,
    vitals,
    groups,
    topFixes: groups.slice(0, TOP_FIX_GROUPS),
    recommendations: opts.recommendations,
    notRun: run.checks
      .filter((check) => check.status !== 'run')
      .map((check) => ({ id: str(check.id), status: check.status === 'error' ? 'error' : 'skipped', reason: text(check.skip_reason, 'No reason recorded.') }))
      .sort((a, b) => compareText(a.id, b.id)),
    comparison: opts.comparison ? viewComparison(opts.comparison) : null,
    method: methodSections({
      pluginVersion: text(run.plugin_version, 'unknown'), rulesVersion: text(run.rules_version, 'unknown'), vitals: vitals !== null,
      repo: REPO_FRAMEWORKS.includes(str(obj(run.repo).framework)), security: Array.isArray(run.modules_requested) && run.modules_requested.includes('security'),
      media: Array.isArray(run.modules_requested) && run.modules_requested.includes('media'), search: opts.search.length > 0,
    }),
    pluginVersion: text(run.plugin_version, 'unknown'),
    rulesVersion: text(run.rules_version, 'unknown'),
  };
}
