// Helpers shared by the smo check tests. Not a test file itself.

import { buildContext, runChecks } from '../../../plugin/server/src/checks/engine.js';
import { checks } from '../../../plugin/server/src/checks/smo/index.js';
import { SITE, makeCrawl, makePage } from '../../helpers/factories.js';

/** @import { CheckStat, CrawlResult, Finding, ImageFileResult, PageRecord } from '../../../plugin/server/src/types.js' */

export const NOW = '2026-11-13T00:00:00.000Z';

/** Open Graph tags of a page that gives every one the module asks for. */
export const FULL_OG = Object.freeze({
  title: 'Title', type: 'website', url: '', description: 'Description', image: `${SITE}/share.png`,
  'image:width': '1200', 'image:height': '630', 'image:alt': 'A product photo',
});

/**
 * A page with complete Open Graph tags (og:url names the page itself), unless overridden.
 * @param {string} path
 * @param {Partial<PageRecord>} [overrides]
 */
export function sharedPage(path, overrides = {}) {
  const url = `${SITE}${path}`;
  return makePage({ url, og: { ...FULL_OG, url }, ...overrides });
}

/**
 * What the check of one sharing image found: by default a 1200 × 630 PNG of 100 KB.
 * @param {string} url
 * @param {Partial<ImageFileResult>} [overrides]
 * @returns {ImageFileResult}
 */
export function sharingFile(url, overrides = {}) {
  return {
    url, outcome: 'ok', status: 206, reason: null, final_url: null, content_type: 'image/png', bytes: 100_000, vary: null,
    modern_accepted: true, google: 'allowed', google_agent: null, google_host: null, size: { format: 'png', width: 1200, height: 630 }, ...overrides,
  };
}

/**
 * Run every smo check against a crawl of `pages`.
 * @param {PageRecord[]} pages
 * @param {{files?: ImageFileResult[]|null, crawl?: Partial<CrawlResult>}} [options]  `files`: the checked sharing images; null when not checked.
 */
export function audit(pages, options = {}) {
  const files = options.files === undefined ? [] : options.files;
  const ctx = buildContext(makeCrawl({ pages, ...options.crawl }), { socialImages: files === null ? null : new Map(files.map((file) => [file.url, file])) });
  return runChecks(checks, ctx, { modules: ['smo'], detectedAt: NOW });
}

/**
 * @param {{checks: CheckStat[]}} result
 * @param {string} id
 * @returns {CheckStat}
 */
export function statFor(result, id) {
  const stat = result.checks.find((entry) => entry.id === id);
  if (!stat) throw new Error(`no stat for ${id}`);
  return stat;
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
 * [units, failures] of a check.
 * @param {{checks: CheckStat[]}} result
 * @param {string} id
 */
export const counts = (result, id) => [statFor(result, id).applicable, statFor(result, id).failed];
