// The image-file part of audit_run (media module): its argument, checking the
// chosen files without ever failing the audit, and what the run and its notes
// say about it.

/** @import { CrawlResult, ImageFileResult, ImageFilesSummary } from '../types.js' */
/** @import { ToolDeps } from './index.js' */

import { LIMITS } from '../config.js';
import { selectImageFiles } from '../checks/media/select.js';
import { log } from '../log.js';
import { countBy } from './common.js';

export const IMAGE_FILES_NOT_ASKED = 'Image files were not checked (check_image_files was false), so the checks that need them were skipped.';
export const IMAGE_FILES_FAILED = 'Image files could not be checked because of an internal error. The rest of the audit is not affected.';
export const IMAGE_FILES_REFUSED = "Image files were not checked: the site refused the crawler (a bot challenge or rate limiting), so nothing more was requested from it. The checks that need them were skipped.";
export const SITE_IMAGES_SKIPPED = "The site refused some of the crawler's page requests (a bot challenge or rate limiting), so no image on the site's own hosts (its domain and subdomains) was requested; images on other hosts were checked.";

/** Refusals after which nothing more is sent to the site. */
const REFUSALS = new Set(['bot_challenge', 'rate_limited']);

/** Arguments of audit_run that steer the check of image files. */
export const MEDIA_ARGUMENTS = Object.freeze({
  check_image_files: {
    type: 'boolean',
    default: true,
    description:
      `With the media module, check up to ${LIMITS.maxImageChecks} image files the pages show: the robots.txt of each host, ` +
      'then a HEAD request, and a GET that reads at most 1 KiB when the HEAD says too little. For a site on this machine only its own address is contacted.',
  },
});

/**
 * @typedef {Object} ImageFilesCollected
 * @property {Map<string, ImageFileResult>|null} files  Null when the files were not checked.
 * @property {ImageFilesSummary|null} summary
 * @property {string|undefined} reason  Why they were not checked, when they were asked for.
 */

/**
 * Check the image files of a crawl for the media module. Never throws: an
 * unexpected error is logged and becomes a reason the checks that need the
 * files give when they are skipped.
 * @param {ToolDeps} deps
 * @param {CrawlResult} crawl
 * @param {{requested: boolean, check: boolean, signal?: AbortSignal}} options  `signal` fires when the audit is
 *   cancelled: no image request starts after that, and the call rejects.
 * @returns {Promise<ImageFilesCollected>}
 */
export async function collectImageFiles(deps, crawl, { requested, check, signal }) {
  if (!requested) return { files: null, summary: null, reason: undefined };
  if (!check) return { files: null, summary: null, reason: IMAGE_FILES_NOT_ASKED };
  if (crawl.blocked !== null && REFUSALS.has(crawl.blocked.reason)) return { files: null, summary: null, reason: IMAGE_FILES_REFUSED };
  const local = crawl.options.local === true;
  // A site that challenged or rate-limited the crawler on some pages gets no image request on any host of its organisation.
  const refused = crawl.pages.some((page) => REFUSALS.has(page.fetch_error ?? ''));
  const selection = selectImageFiles(crawl, LIMITS.maxImageChecks, refused);
  const { urls, images } = selection;
  const rate = crawl.options.rate_per_sec;
  try {
    const files = urls.length === 0 ? new Map() : await deps.checkImageFiles(urls, {
      maxImages: LIMITS.maxImageChecks,
      concurrency: LIMITS.imageCheckConcurrency,
      perHostDelayMs: Number.isFinite(rate) && rate > 0 ? 1000 / rate : 1000 / LIMITS.ratePerSecDefault,
      onlyOrigin: local ? crawl.site_origin : null,
      fetchOptions: local ? { allowLoopback: crawl.site_origin } : {},
      ...(signal ? { signal } : {}),
    });
    /** @type {ImageFilesSummary} */
    const summary = { images, selected: urls.length, outcomes: countBy([...files.values()], (file) => file.outcome), local, ...(refused ? { site_skipped: true } : {}) };
    return { files, summary, reason: undefined };
  } catch (error) {
    if (signal?.aborted) throw error;
    log.error('image file check failed', { message: error instanceof Error ? error.message : String(error) });
    return { files: null, summary: null, reason: IMAGE_FILES_FAILED };
  }
}

/**
 * What audit_run's notes say about the image files.
 * @param {ImageFilesCollected} collected
 * @returns {string[]}
 */
export function imageFilesNotes(collected) {
  if (collected.summary === null) return collected.reason ? [collected.reason] : [];
  const { images, selected, outcomes, local } = collected.summary;
  const notes = [];
  if (collected.summary.site_skipped === true) notes.push(SITE_IMAGES_SKIPPED);
  if (images === 0) return notes;
  if (selected === 0) {
    notes.push(`The pages show ${images} distinct ${images === 1 ? 'image' : 'images'}; none could be chosen to check.`);
    return notes;
  }
  const answered = (outcomes.ok ?? 0) + (outcomes.broken ?? 0);
  const chosen = selected < images
    ? `The pages show ${images} distinct images; ${selected} of them ${selected === 1 ? 'was' : 'were'} chosen to check, page by page in crawl order, and ${answered} answered.`
    : `The pages show ${images} distinct ${images === 1 ? 'image' : 'images'}; ${selected === 1 ? 'it was' : `all ${selected} were`} chosen to check, and ${answered} answered.`;
  const parts = [
    outcomes.unverifiable ? `${outcomes.unverifiable} could not be verified (refused, unreachable, or robots.txt could not be read)` : '',
    outcomes.disallowed ? `${outcomes.disallowed} were not requested because robots.txt does not allow it` : '',
    outcomes.not_checked ? `${outcomes.not_checked} were not reached within ${LIMITS.imageCheckDeadlineMs / 1000} seconds` : '',
  ].filter(Boolean);
  notes.push(parts.length === 0 ? chosen : `${chosen} Of the others, ${parts.join(', ')}.`);
  if (local) notes.push('This is a site on this machine, so only images on its own address were checked; images on other hosts were not requested.');
  return notes;
}
