// Helpers shared by the security check tests. Not a test file itself.

import { buildContext, runChecks } from '../../../plugin/server/src/checks/engine.js';
import { checks } from '../../../plugin/server/src/checks/security/index.js';
import { makeCrawl } from '../../helpers/factories.js';

/** @import { CheckStat, CrawlResult, Finding, PageRecord } from '../../../plugin/server/src/types.js' */

export const NOW = '2026-11-12T00:00:00.000Z';

/**
 * Run every security check against a crawl of `pages` (the first is the start page unless the crawl says otherwise).
 * @param {PageRecord[]} pages
 * @param {Partial<CrawlResult>} [crawl]
 */
export function audit(pages, crawl = {}) {
  const ctx = buildContext(makeCrawl({ pages, ...crawl }));
  return runChecks(checks, ctx, { modules: ['security'], detectedAt: NOW });
}

/**
 * @param {{checks: CheckStat[]}} result
 * @param {string} id
 * @returns {CheckStat}
 */
export function statFor(result, id) {
  const found = result.checks.find((stat) => stat.id === id);
  if (!found) throw new Error(`no stat for ${id}`);
  return found;
}

/**
 * @param {{findings: Finding[]}} result
 * @param {string} id
 * @returns {Finding[]}
 */
export function findingsFor(result, id) {
  return result.findings.filter((finding) => finding.check_id === id);
}
