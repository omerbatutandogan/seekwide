// Runs one SEO check against a test crawl through the real engine.

/** @import { CheckResult, CrawlResult, Finding, CheckStat, OutboundResult, PageRecord } from '../../../server/src/types.js' */

import { buildContext, runChecks } from '../../../server/src/checks/engine.js';
import { checks } from '../../../server/src/checks/seo/index.js';
import { makeCrawl } from '../../helpers/factories.js';

const NOW = '2026-11-11T12:00:00.000Z';

/**
 * @param {string} id
 * @param {Partial<CrawlResult> & {pages?: PageRecord[]}} [crawl]
 * @param {{outbound?: Map<string, OutboundResult>|null}} [extras]
 * @returns {{stat: CheckStat, findings: Finding[], results: CheckResult[], units: (string|null)[], failed: (string|null)[]}}
 */
export function audit(id, crawl = {}, extras = {}) {
  const check = checks.find((def) => def.id === id);
  if (!check) throw new Error(`no check ${id}`);
  const ctx = buildContext(makeCrawl(crawl), extras);
  const { checks: stats, findings } = runChecks([check], ctx, { detectedAt: NOW });
  const results = stats[0].status === 'run' ? check.run(ctx) : [];
  return {
    stat: stats[0],
    findings,
    results,
    units: results.map((result) => result.url).sort(),
    failed: findings.map((finding) => finding.url),
  };
}
