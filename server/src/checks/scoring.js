/** @import { CheckDef, CheckStat, ModuleScore } from '../types.js' */

import { MODULES } from '../config.js';

/**
 * Score each module from its check statistics. A check with a `score_group`
 * counts toward that score instead of its module's (`SCORE_GROUPS`): the
 * security module is scored as `security` (signs of a hack) and
 * `security_headers`, each with its own coverage.
 *
 * score = 100 × Σ(weight × pass rate) / Σ(weight), over checks that ran, looked
 * at one or more units and have a weight above zero. A check's pass rate is
 * passed / applicable.
 *
 * The result is rounded to a whole number, but 100 is kept for a module with no
 * failed unit in a scored check: one failure caps the score at 99, so a clean
 * score never sits next to findings.
 *
 * Skipped checks, checks with nothing to look at and weight-0 (info) checks do
 * not move the score. `coverage` says how much of the module actually ran, so a
 * high score with low coverage is visible for what it is.
 *
 * @param {CheckStat[]} stats
 * @param {CheckDef[]} checks  Definitions for every stat in `stats`.
 * @returns {Record<string, ModuleScore>}
 */
export function scoreModules(stats, checks) {
  const weights = new Map(checks.map((check) => [check.id, check.weight]));
  const groups = new Map(checks.map((check) => [check.id, check.score_group ?? check.module]));
  /** @type {Record<string, {total: number, run: number, skipped: number, weightedPass: number, weightSum: number, failures: boolean}>} */
  const acc = {};

  for (const stat of stats) {
    const m = (acc[groups.get(stat.id) ?? stat.module] ??= { total: 0, run: 0, skipped: 0, weightedPass: 0, weightSum: 0, failures: false });
    m.total += 1;
    if (stat.status !== 'run') {
      m.skipped += 1;
      continue;
    }
    m.run += 1;
    const weight = weights.get(stat.id) ?? 0;
    if (weight > 0 && stat.applicable > 0) {
      m.weightedPass += weight * (stat.passed / stat.applicable);
      m.weightSum += weight;
      if (stat.passed < stat.applicable) m.failures = true;
    }
  }

  /** @type {Record<string, ModuleScore>} */
  const modules = {};
  for (const name of Object.keys(acc).sort()) {
    const m = acc[name];
    const scored = m.weightSum > 0;
    const rounded = Math.round((100 * m.weightedPass) / m.weightSum);
    modules[name] = {
      score: scored ? (m.failures ? Math.min(rounded, 99) : rounded) : null,
      coverage: m.total > 0 ? Math.round((100 * m.run) / m.total) / 100 : 0,
      checks_total: m.total,
      checks_run: m.run,
      checks_skipped: m.skipped,
      note: scored
        ? null
        : m.run === 0
          ? (MODULES.includes(name) ? 'None of this module\'s checks could run.' : 'None of the checks behind this score could run.')
          : 'No score: the scored checks had nothing to look at in this crawl.',
    };
  }
  return modules;
}
