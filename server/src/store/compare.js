/** @import { Run, Finding } from '../types.js' */

/**
 * @typedef {Object} RunComparison
 * @property {string} base_run_id
 * @property {string} run_id
 * @property {Finding[]} resolved    In the base run, gone from the current run.
 * @property {Finding[]} added       In the current run, not in the base run.
 * @property {number} persisting     Findings present in both runs.
 * @property {Record<string, {from: number|null, to: number|null, delta: number|null}>} scores
 * @property {string[]} notes        Reasons the comparison may be unreliable.
 */

/**
 * @param {Run} run
 * @returns {Set<string>}
 */
function ranChecks(run) {
  return new Set(run.checks.filter((check) => check.status === 'run').map((check) => check.id));
}

/**
 * @param {Run} run
 * @param {string} label
 * @returns {string|null}
 */
function crawlNote(run, label) {
  const problems = [];
  if (run.crawl.blocked) problems.push(`was blocked (${run.crawl.blocked.reason})`);
  if (run.crawl.truncated) problems.push(run.crawl.time_limit_reached === true ? 'stopped at its time limit' : 'stopped at its page limit');
  if (problems.length === 0) return null;
  return `The ${label} run's crawl ${problems.join(' and ')}, so it covers only part of the site and findings may appear or disappear because of coverage.`;
}

/** Check ids of the Core Web Vitals lab checks, whose values change from one audit to the next. */
const LAB_CHECK_PREFIX = 'seo.cwv.lab_';

/**
 * @param {Run} base
 * @param {Run} current
 * @param {Finding[]} changed  Findings that are in only one of the two runs.
 * @returns {string[]}
 */
function buildNotes(base, current, changed) {
  /** @type {string[]} */
  const notes = [];
  if (base.rules_version !== current.rules_version) {
    notes.push(`The rules version changed from ${base.rules_version} to ${current.rules_version}, so some differences come from changed checks and not from changes to the site.`);
  }
  if (base.start_url !== current.start_url) {
    notes.push(`The runs started from different URLs (${base.start_url} and ${current.start_url}), so they may describe different sites or sections.`);
  }
  if (base.crawl.max_pages !== current.crawl.max_pages) {
    notes.push(`The page budget changed from ${base.crawl.max_pages} to ${current.crawl.max_pages} pages, so the runs may have looked at different pages.`);
  }
  for (const [label, run] of /** @type {const} */ ([['base', base], ['current', current]])) {
    const note = crawlNote(run, label);
    if (note) notes.push(note);
  }
  const baseRan = ranChecks(base);
  const currentRan = ranChecks(current);
  const different = [...new Set([...baseRan, ...currentRan])].filter((id) => baseRan.has(id) !== currentRan.has(id)).sort();
  if (different.length > 0) {
    const shown = different.slice(0, 5).join(', ');
    notes.push(`${different.length} check${different.length === 1 ? '' : 's'} ran in only one of the two runs (${shown}${different.length > 5 ? ', ...' : ''}), so their findings cannot be compared.`);
  }
  if (changed.some((finding) => typeof finding.check_id === 'string' && finding.check_id.startsWith(LAB_CHECK_PREFIX))) {
    notes.push('A Core Web Vitals lab finding appeared or went away. Lab values come from one simulated page load per audit and change from run to run, so this can happen without any change to the site. The real-user (field) values are steadier, but they also follow a 28-day window that moves every day.');
  }
  return notes;
}

/**
 * Compare two runs of the same project. Findings are matched by `id`, so a
 * finding counts as resolved only when its URL and selector no longer fail. The
 * result never changes either run. `notes` lists everything that makes the
 * comparison unreliable: a different rules version, start URL or page budget, a
 * blocked or truncated crawl on either side, checks that ran in only one run,
 * and a Core Web Vitals lab finding that appeared or went away.
 * @param {Run} base     The earlier run.
 * @param {Run} current  The later run.
 * @returns {RunComparison}
 */
export function compareRuns(base, current) {
  const baseIds = new Set(base.findings.map((finding) => finding.id));
  const currentIds = new Set(current.findings.map((finding) => finding.id));
  const resolved = base.findings.filter((finding) => !currentIds.has(finding.id));
  const added = current.findings.filter((finding) => !baseIds.has(finding.id));

  /** @type {RunComparison['scores']} */
  const scores = {};
  for (const name of [...new Set([...Object.keys(base.modules), ...Object.keys(current.modules)])].sort()) {
    const from = base.modules[name]?.score ?? null;
    const to = current.modules[name]?.score ?? null;
    scores[name] = { from, to, delta: from === null || to === null ? null : to - from };
  }

  return {
    base_run_id: base.run_id,
    run_id: current.run_id,
    resolved,
    added,
    persisting: current.findings.filter((finding) => baseIds.has(finding.id)).length,
    scores,
    notes: buildNotes(base, current, [...resolved, ...added]),
  };
}
