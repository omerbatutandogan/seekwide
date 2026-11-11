// Helpers shared by the links check tests. Not a test file itself.

import { buildContext, runChecks } from '../../../server/src/checks/engine.js';
import { checks } from '../../../server/src/checks/links/index.js';
import { SITE, makeCrawl, makeLink } from '../../helpers/factories.js';

/** @import { CheckDef, CheckStat, CrawlResult, Finding, OutboundResult, PageRecord, LinkRecord } from '../../../server/src/types.js' */

export const NOW = '2026-01-02T03:04:05.000Z';

/**
 * Run every links check against a crawl of `pages`.
 * @param {PageRecord[]} pages
 * @param {{crawl?: Partial<CrawlResult>, outbound?: Map<string, OutboundResult>}} [options]
 */
export function audit(pages, options = {}) {
  const ctx = buildContext(makeCrawl({ pages, ...options.crawl }), { outbound: options.outbound });
  return { ctx, result: runChecks(checks, ctx, { modules: ['links'], detectedAt: NOW }) };
}

/**
 * @param {string} id
 * @returns {CheckDef}
 */
export function checkById(id) {
  const found = checks.find((check) => check.id === id);
  if (!found) throw new Error(`no links check named ${id}`);
  return found;
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

/**
 * A link whose fields are all given explicitly, including a null `url`
 * (mailto:, javascript:, empty href), which `makeLink` cannot build.
 * @param {Partial<LinkRecord>} overrides
 * @returns {LinkRecord}
 */
export function makeRawLink(overrides) {
  return { ...makeLink({ url: `${SITE}/placeholder` }), url: null, internal: false, text: 'Link text', ...overrides };
}

/**
 * @param {string} url
 * @param {'ok'|'broken'|'unverifiable'} outcome
 * @param {number} status
 * @param {string|null} [reason]
 * @returns {OutboundResult}
 */
export function outboundResult(url, outcome, status, reason = null) {
  return { url, status, outcome, reason, final_url: null };
}
