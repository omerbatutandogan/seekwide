// What the smo and aso modules collect before the checks run: the sharing
// images, the app association files, and the apps a profile declares (rule set
// 0.1.9). No runtime code.

export {};

/**
 * What a run records about the sharing images it checked (smo module).
 * @typedef {Object} SocialImagesSummary
 * @property {number} images          Distinct http(s) `og:image` URLs (else `twitter:image`) of the crawled html pages.
 * @property {number} selected        URLs chosen to check (at most `LIMITS.maxSocialImageChecks`).
 * @property {Record<string, number>} outcomes  Count per outcome.
 * @property {number} sized           Files whose pixel size their first bytes gave.
 * @property {boolean} local          The crawl was of a site on this machine, so only images on its origin were requested.
 */

/**
 * One app association file of the audited site (aso module).
 * @typedef {Object} AppFileResult
 * @property {string} url             The file's address on the audited site.
 * @property {'answered'|'not_found'|'unverifiable'|'disallowed'} outcome
 *   'answered': a file came back: status 200 with a body that is not empty and does not start with markup, whatever its
 *   content type, possibly after
 *   redirects. 'not_found': 404 or 410, or an HTML page or an empty body instead of the file (a site that answers every
 *   unknown address with a page), also at the end of redirects. 'unverifiable': anything else: a refusal (401, 403,
 *   429), another status, a server error, a network error, a body over the size limit, a redirect off the site's
 *   organisation or past 3 steps, or a robots.txt that could not be read. 'disallowed': robots.txt does not allow the
 *   crawler to request it, so it was not requested.
 * @property {number} status          Status of the first answer; 0 when there was none.
 * @property {string|null} location   Where the first answer redirects, when it is a redirect; null otherwise.
 * @property {string|null} final_url  Where the answer that was read came from, when that is not `url`.
 * @property {string|null} content_type  Lower-cased media type of the answer that was read, without parameters.
 * @property {string|null} body       That answer's body as UTF-8 text, for 'answered'; null otherwise. Never stored in a run.
 * @property {string|null} reason     Short reason for every outcome but 'answered'.
 */

/**
 * @typedef {Object} AppFiles
 * @property {AppFileResult} aasa         `/.well-known/apple-app-site-association`
 * @property {AppFileResult} assetlinks   `/.well-known/assetlinks.json`
 */

/**
 * What a run records about the app association files (aso module): each file's outcome and status, never its body.
 * @typedef {Object} AppFilesSummary
 * @property {{url: string, outcome: string, status: number}} aasa
 * @property {{url: string, outcome: string, status: number}} assetlinks
 */

/**
 * The apps a site profile declares (`profile.apps`, aso module).
 * @typedef {Object} AppsProfile
 * @property {{app_ids: string[], universal_links: boolean}} [ios]  App identifiers (`<Team ID>.<bundle ID>`) and whether
 *   the app opens the site's links (universal links), which needs the association file.
 * @property {{packages: string[], app_links: boolean}} [android]  Package names and whether the app is verified to open the
 *   site's links (Android App Links), which needs `assetlinks.json`.
 */

/**
 * Links and image files on hosts the plugin never contacts (Google Play and social platforms), by module.
 * @typedef {Object} NotRequestedSummary
 * @property {number} links           External links of the links module.
 * @property {number} images          Image files of the media module.
 * @property {number} social_images   Sharing images of the smo module.
 * @property {string[]} hosts         The hosts, sorted, at most 20.
 */
