// The parts of audit_run that the smo and aso modules add: checking the
// sharing images, reading the app association files and the apps the profile
// declares, and saying what was never requested by rule (rule set 0.1.9).
// None of them ever fails the audit.

/** @import { AppFiles, AppFilesSummary, AppsProfile, CrawlResult, ImageFileResult, NotRequestedSummary, SocialImagesSummary } from '../types.js' */
/** @import { ToolDeps } from './index.js' */

import { LIMITS } from '../config.js';
import { notRequestedHosts, selectSocialImages } from '../checks/smo/select.js';
import { log } from '../log.js';
import { isStoredHost } from '../store/run-validate.js';
import { profileSite } from '../util/profile-site.js';
import { crawlIdentity } from '../util/site-identity.js';
import { countBy } from './common.js';

export const SOCIAL_IMAGES_NOT_ASKED = 'Sharing images were not checked (check_social_images was false), so the checks that need them were skipped.';
export const SOCIAL_IMAGES_FAILED = 'Sharing images could not be checked because of an internal error. The rest of the audit is not affected.';
export const APP_FILES_NOT_ASKED = 'The app association files were not read (check_app_files was false), so the checks that need them were skipped.';
export const APP_FILES_FAILED = 'The app association files could not be read because of an internal error. The rest of the audit is not affected.';
export const APP_FILES_LOCAL = 'The app association files were not read: this is a site on this machine, and Apple and Google read them from the deployed site over https. Audit the deployed site for them.';
export const REFUSED = "the site refused the crawler (a bot challenge or rate limiting), so nothing more was requested from it. The checks that need them were skipped.";
export const PROFILE_UNREADABLE = 'The site profile could not be read, so the apps it may declare were not used: the app association files were judged without app identifiers, and their absence was not judged.';
export const APPS_OTHER_SITE = "The site profile declares apps, but its site_url is not this site, so they were not used: the app association files were judged without app identifiers, and their absence was not judged. To check a site's own apps, set its address as site_url with /seekwide:setup in that site's folder.";
export const APPS_NO_SITE_URL = 'The site profile declares apps but no site_url, so they were not used: the app association files were judged without app identifiers, and their absence was not judged. Set site_url with /seekwide:setup to check them.';

/** Refusals after which nothing more is sent to the site. */
const REFUSALS = new Set(['bot_challenge', 'rate_limited']);
/** Hosts named in the run and the notes. */
const MAX_HOSTS = 20;

/** Arguments of audit_run that steer the requests of the smo and aso modules. */
export const SHARING_ARGUMENTS = Object.freeze({
  check_social_images: {
    type: 'boolean',
    default: true,
    description:
      `With the smo module, check up to ${LIMITS.maxSocialImageChecks} sharing images (og:image) the pages give: the robots.txt of each host, ` +
      `then one GET that reads at most the first ${LIMITS.socialImageReadBytes / 1024} KiB for the pixel size. Images on social platforms are never requested.`,
  },
  check_app_files: {
    type: 'boolean',
    default: true,
    description: 'With the aso module, read /.well-known/apple-app-site-association and /.well-known/assetlinks.json of the audited site, after its robots.txt. Not for a site on this machine.',
  },
});

/** @param {CrawlResult} crawl */
const refusedSome = (crawl) => crawl.pages.some((page) => REFUSALS.has(page.fetch_error ?? ''));
/** @param {CrawlResult} crawl */
const refusedAll = (crawl) => crawl.blocked !== null && REFUSALS.has(crawl.blocked.reason);

/**
 * @typedef {Object} SocialImagesCollected
 * @property {Map<string, ImageFileResult>|null} files
 * @property {SocialImagesSummary|null} summary
 * @property {string|undefined} reason
 * @property {string[]} notRequested  Sharing images on hosts the plugin never contacts.
 */

/**
 * Check the sharing images of a crawl for the smo module. Never throws but
 * when the audit was cancelled: an unexpected error is logged and becomes the
 * reason the checks that need the images give when they are skipped.
 * @param {ToolDeps} deps
 * @param {CrawlResult} crawl
 * @param {{requested: boolean, check: boolean, signal?: AbortSignal}} options
 * @returns {Promise<SocialImagesCollected>}
 */
export async function collectSocialImages(deps, crawl, { requested, check, signal }) {
  if (!requested) return { files: null, summary: null, reason: undefined, notRequested: [] };
  const { urls, images, notRequested } = selectSocialImages(crawl, LIMITS.maxSocialImageChecks, refusedSome(crawl));
  if (!check) return { files: null, summary: null, reason: SOCIAL_IMAGES_NOT_ASKED, notRequested };
  if (refusedAll(crawl)) return { files: null, summary: null, reason: `Sharing images were not checked: ${REFUSED}`, notRequested };
  const local = crawl.options.local === true;
  const rate = crawl.options.rate_per_sec;
  try {
    const files = urls.length === 0 ? new Map() : await deps.checkImageFiles(urls, {
      maxImages: LIMITS.maxSocialImageChecks,
      concurrency: LIMITS.imageCheckConcurrency,
      perHostDelayMs: Number.isFinite(rate) && rate > 0 ? 1000 / rate : 1000 / LIMITS.ratePerSecDefault,
      readBytes: LIMITS.socialImageReadBytes,
      onlyOrigin: local ? crawl.site_origin : null,
      fetchOptions: local ? { allowLoopback: crawl.site_origin } : {},
      ...(signal ? { signal } : {}),
    });
    const results = [...files.values()];
    /** @type {SocialImagesSummary} */
    const summary = {
      images, selected: urls.length, outcomes: countBy(results, (file) => file.outcome),
      sized: results.filter((file) => file.size).length, local,
    };
    return { files, summary, reason: undefined, notRequested };
  } catch (error) {
    if (signal?.aborted) throw error;
    log.error('sharing image check failed', { message: error instanceof Error ? error.message : String(error) });
    return { files: null, summary: null, reason: SOCIAL_IMAGES_FAILED, notRequested };
  }
}

/**
 * What audit_run's notes say about the sharing images.
 * @param {SocialImagesCollected} collected
 * @returns {string[]}
 */
export function socialImagesNotes(collected) {
  if (collected.summary === null) return collected.reason ? [collected.reason] : [];
  const { images, selected, outcomes, sized, local } = collected.summary;
  if (images === 0) return [];
  const answered = (outcomes.ok ?? 0) + (outcomes.broken ?? 0);
  const notes = [
    `The pages give ${images} distinct sharing ${images === 1 ? 'image' : 'images'}; ${selected} ${selected === 1 ? 'was' : 'were'} chosen for the check, ${answered} answered and the pixel size of ${sized} was read from the file.`,
  ];
  if (local) notes.push('This is a site on this machine, so only sharing images on its own address were requested.');
  return notes;
}

/**
 * @typedef {Object} AppFilesCollected
 * @property {AppFiles|null} files
 * @property {AppFilesSummary|null} summary
 * @property {string|undefined} reason
 * @property {AppsProfile|null} apps  What the profile declares for this site; null when it could not be read, empty when it
 *   declares none or declares them for another site.
 * @property {string|null} appsNote  Why declared apps were not used, when they were not.
 */

/**
 * The apps a profile declares, when they belong to the audited site: only a
 * profile whose `site_url` is the audited site's own host (`profileSite`:
 * with or without `www.`, on the same port) speaks for it, so an audit of
 * another address from the same folder (a competitor, a client, a subdomain
 * with its own association files) never judges that site by the user's apps.
 * @param {import('../types.js').Profile|null} profile
 * @param {CrawlResult} crawl
 * @returns {{apps: AppsProfile, note: string|null}}
 */
export function appsFor(profile, crawl) {
  const declared = profile?.apps ?? {};
  if (Object.keys(declared).length === 0) return { apps: {}, note: null };
  const match = profileSite(profile?.site_url, crawl);
  if (match === 'no_site_url') return { apps: {}, note: APPS_NO_SITE_URL };
  return match === 'site' ? { apps: declared, note: null } : { apps: {}, note: APPS_OTHER_SITE };
}

/**
 * Read the app association files and the apps the profile declares, for the
 * aso module. Never throws but when the audit was cancelled.
 * @param {ToolDeps} deps
 * @param {CrawlResult} crawl
 * @param {string} projectDir
 * @param {{requested: boolean, check: boolean, signal?: AbortSignal}} options
 * @returns {Promise<AppFilesCollected>}
 */
export async function collectAppFiles(deps, crawl, projectDir, { requested, check, signal }) {
  if (!requested) return { files: null, summary: null, reason: undefined, apps: {}, appsNote: null };
  const identity = crawlIdentity(crawl);
  /** @type {AppsProfile|null} */
  let apps;
  /** @type {string|null} */
  let appsNote = null;
  try {
    ({ apps, note: appsNote } = appsFor(await deps.readProfile(projectDir), crawl));
  } catch {
    apps = null;
  }
  if (!check) return { files: null, summary: null, reason: APP_FILES_NOT_ASKED, apps, appsNote };
  if (crawl.options.local !== false) return { files: null, summary: null, reason: APP_FILES_LOCAL, apps, appsNote };
  if (refusedAll(crawl) || refusedSome(crawl)) return { files: null, summary: null, reason: `The app association files were not read: ${REFUSED}`, apps, appsNote };
  const rate = crawl.options.rate_per_sec;
  try {
    const files = await deps.fetchAppFiles(crawl.site_origin, {
      perHostDelayMs: Number.isFinite(rate) && rate > 0 ? 1000 / rate : 1000 / LIMITS.ratePerSecDefault,
      // A redirect is followed only where the crawl itself would go: the site's host, on the same port.
      sameSite: (url) => identity.isInternal(url),
      ...(signal ? { signal } : {}),
    });
    /** @param {import('../types.js').AppFileResult} file */
    const brief = (file) => ({ url: file.url, outcome: file.outcome, status: file.status });
    return { files, summary: { aasa: brief(files.aasa), assetlinks: brief(files.assetlinks) }, reason: undefined, apps, appsNote };
  } catch (error) {
    if (signal?.aborted) throw error;
    log.error('app association file read failed', { message: error instanceof Error ? error.message : String(error) });
    return { files: null, summary: null, reason: APP_FILES_FAILED, apps, appsNote };
  }
}

const OUTCOME_WORDS = /** @type {Record<string, string>} */ ({
  answered: 'served',
  not_found: 'not found',
  unverifiable: 'could not be verified',
  disallowed: 'not requested (robots.txt)',
});

/**
 * What audit_run's notes say about the app association files.
 * @param {AppFilesCollected} collected
 * @returns {string[]}
 */
export function appFilesNotes(collected) {
  const notes = collected.apps === null ? [PROFILE_UNREADABLE] : collected.appsNote === null ? [] : [collected.appsNote];
  if (collected.summary === null) return collected.reason ? [...notes, collected.reason] : notes;
  const { aasa, assetlinks } = collected.summary;
  // A site without apps serves neither file; that needs no note, the report's scope says it.
  if (aasa.outcome === 'not_found' && assetlinks.outcome === 'not_found') return notes;
  notes.push(`App association files: apple-app-site-association ${OUTCOME_WORDS[aasa.outcome] ?? aasa.outcome}, assetlinks.json ${OUTCOME_WORDS[assetlinks.outcome] ?? assetlinks.outcome}.`);
  return notes;
}

/**
 * What the run records about links and images on hosts the plugin never
 * contacts: a count per module and the platform domains they are on (`facebook.com`, never the host a page wrote);
 * null when there were none.
 * @param {{links: string[], images: string[], socialImages: string[]}} lists  Distinct URLs of each module.
 * @returns {NotRequestedSummary|null}
 */
export function notRequestedSummary({ links, images, socialImages }) {
  if (links.length + images.length + socialImages.length === 0) return null;
  // The platforms' own domains, never a host a page wrote, and only in the form a stored run accepts.
  const hosts = notRequestedHosts([...links, ...images, ...socialImages]).filter(isStoredHost).slice(0, MAX_HOSTS);
  return { links: links.length, images: images.length, social_images: socialImages.length, hosts };
}

/**
 * What audit_run's notes say about what was not requested by rule.
 * @param {NotRequestedSummary|null} summary
 * @returns {string[]}
 */
export function notRequestedNotes(summary) {
  if (summary === null) return [];
  const parts = [
    summary.links > 0 ? `${summary.links} external ${summary.links === 1 ? 'link' : 'links'}` : '',
    summary.images > 0 ? `${summary.images} image ${summary.images === 1 ? 'file' : 'files'}` : '',
    summary.social_images > 0 ? `${summary.social_images} sharing ${summary.social_images === 1 ? 'image' : 'images'}` : '',
  ].filter(Boolean);
  return [`Not checked, by rule: ${parts.join(', ')} on Google Play or social platforms (${summary.hosts.join(', ')}). Seekwide never sends a request there.`];
}
