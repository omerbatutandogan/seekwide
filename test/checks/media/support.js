// Helpers shared by the media check tests. Not a test file itself.

import { buildContext, runChecks } from '../../../server/src/checks/engine.js';
import { checks } from '../../../server/src/checks/media/index.js';
import { SITE, makeCrawl, makeImage, makePage } from '../../helpers/factories.js';

/** @import { CheckStat, CrawlResult, Finding, ImageFileResult, ImageRecord, PageRecord } from '../../../server/src/types.js' */

export const NOW = '2026-11-12T00:00:00.000Z';

/**
 * An image as the media module records it: every field set, rendered and exposed.
 * @param {Partial<ImageRecord>} [overrides]
 * @returns {ImageRecord}
 */
export function mediaImage(overrides = {}) {
  return makeImage({
    aria_hidden: false, role: null, named: false, hidden: false, pixel: false, style_sized: false, class_sized: false, chrome: false,
    fetchpriority: null, preloaded: false, figure_caption: false, picture_sources: false, modern_source: false, ...overrides,
  });
}

/**
 * @param {string} path
 * @param {Partial<PageRecord>} [overrides]
 */
export function mediaPage(path, overrides = {}) {
  return makePage({ url: `${SITE}${path}`, ...overrides });
}

/**
 * What the check of one image file found: by default a small WebP that answered 200 and that Google may fetch.
 * @param {string} url
 * @param {Partial<ImageFileResult>} [overrides]
 * @returns {ImageFileResult}
 */
export function imageFile(url, overrides = {}) {
  return {
    url, outcome: 'ok', status: 200, reason: null, final_url: null, content_type: 'image/webp', bytes: 10_000, vary: null,
    modern_accepted: true, google: 'allowed', google_agent: null, google_host: null, ...overrides,
  };
}

/**
 * Run every media check against a crawl of `pages`.
 * @param {PageRecord[]} pages
 * @param {{files?: ImageFileResult[]|null, crawl?: Partial<CrawlResult>}} [options]  `files`: the checked image files; null when not checked.
 */
export function audit(pages, options = {}) {
  const files = options.files === undefined ? [] : options.files;
  const ctx = buildContext(makeCrawl({ pages, ...options.crawl }), { imageFiles: files === null ? null : new Map(files.map((file) => [file.url, file])) });
  return runChecks(checks, ctx, { modules: ['media'], detectedAt: NOW });
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
