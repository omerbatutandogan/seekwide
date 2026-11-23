// What the fix planners share: the context of one plan, and the helpers that
// keep a stored run's text out of what the plan says.

/** @import { CrawlResult, Finding, PageRecord } from '../types.js' */
/** @import { ProjectSources } from './sources.js' */
/** @import { FixEntry } from './fixes.js' */

/** Longest file name passed on from a run, and longest text quoted from a page. */
export const CURRENT_CLIP = 300;
/** Other pages and dynamic routes listed with a fix. */
export const MAX_SHARED = 10;
const PLAIN_PATH = /^[\w@()[\].~+,=-]+(?:\/[\w@()[\].~+,=-]+)*$/;

/**
 * A file name taken from a stored run, when it is a plain relative path and
 * short; otherwise null. A run is a JSON file that can come with a repository
 * someone else wrote, so a "file name" in it may be a sentence meant for the
 * model. Such a value is never passed on.
 * @param {unknown} file
 * @returns {string|null}
 */
export function plainPath(file) {
  if (typeof file !== 'string' || file.length > CURRENT_CLIP || !PLAIN_PATH.test(file)) return null;
  return file.split('/').some((part) => part === '..' || part === '.') ? null : file;
}

/**
 * The path and query of a URL, as a canonical or a sitemap names it.
 * @param {string} url
 * @returns {string|null}
 */
export function pathOf(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

/**
 * The project file a page finding names, as the project's listing has it, or
 * null after the finding was refused: no source file is known, or the project
 * no longer has it.
 * @param {PlanContext} ctx
 * @param {Finding} finding
 * @returns {{file: string, source: NonNullable<Finding['source']>}|null}
 */
export function resolvePageFile(ctx, finding) {
  const { source } = finding;
  if (!source || finding.url === null) {
    ctx.refuse(finding, 'The audit could not say which source file this page comes from (the notes of the run say what limits the mapping), so there is no file to change safely.');
    return null;
  }
  const file = ctx.listed(source.file);
  if (file === null) {
    ctx.refuse(finding, 'The source file this finding names is no longer in the project. Audit again, then plan the fixes from the new run.');
    return null;
  }
  return { file, source };
}

/**
 * One plan in the making, as the planners of page, link and sitemap fixes see it.
 * @typedef {Object} PlanContext
 * @property {ProjectSources} sources
 * @property {Set<string>} files       The project's listing, relative to the source folder.
 * @property {CrawlResult|null} crawl
 * @property {string|null} siteUrl
 * @property {string|null} appDir
 * @property {boolean} isNext          A Next.js App Router project.
 * @property {Map<string, PageRecord>} pages  The crawl's records by URL, the first of each.
 * @property {Map<string, Finding>} byCheckAndUrl  The run's findings by check id and URL.
 * @property {Map<string, import('../util/image-size.js').ImageSize|null>} imageSizes  Pixel sizes of image files, by their name in the listing.
 * @property {(checkId: string) => Finding[]} findingsOf  The run's findings of one check, in the run's order.
 * @property {(file: string) => string[]} layoutsOf  Next.js: the layout files above a file of the app folder, nearest first, relative to the source folder.
 * @property {(file: string) => string} inProject  A file of the listing, relative to the project folder.
 * @property {(file: string) => string|null} listed  A finding's file as the listing names it, or null when the project does not have it.
 * @property {(finding: Finding, reason: string, file?: string|null) => void} refuse
 *   Record the finding as not fixable. `reason` is a fixed sentence; `file` defaults to the finding's own, when it is a plain path.
 * @property {(finding: Finding) => {finding_id: string, check_id: string, title: string, severity: string, url: string|null}} base
 *   The fields every fix starts with.
 * @property {(fix: FixEntry) => void} add
 */
