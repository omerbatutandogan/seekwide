// What the check of image files collects before the checks run (media module,
// CHECKS-SPEC "Which image files are checked"). No runtime code.

export {};

/**
 * One image URL the audit chose to check.
 * @typedef {Object} ImageFileResult
 * @property {string} url
 * @property {'ok'|'broken'|'unverifiable'|'disallowed'|'not_checked'} outcome
 *   'ok': the final answer is below 400. 'broken': 404, 410, or a host name that does not exist. 'unverifiable': any other
 *   status or error, a robots.txt that could not be read, a refused redirect step, too many redirects. 'disallowed': robots.txt
 *   does not allow the crawler to request it. 'not_checked': the time for image checks ran out first.
 * @property {number} status          Status of the final answer; 0 when there was none.
 * @property {string|null} reason     Short reason for every outcome but 'ok'.
 * @property {string|null} final_url  URL of the final answer, when it differs from `url`.
 * @property {string|null} content_type  Lower-cased media type of the final answer, without parameters.
 * @property {number|null} bytes      Size of the whole file: `Content-Range` total or `Content-Length`; null when unknown.
 * @property {string|null} vary       The `Vary` header of the final answer, clipped.
 * @property {boolean} modern_accepted  The request said it accepts AVIF and WebP.
 * @property {'allowed'|'disallowed'|null} google  What robots.txt says to Googlebot and Googlebot-Image about the URL and
 *   each redirect step that was followed; null when a robots.txt involved could not be read or was not reached.
 * @property {string|null} google_agent  The crawler that robots.txt keeps out ('Googlebot' or 'Googlebot-Image'), when `google` is 'disallowed'.
 * @property {string|null} google_host  The host whose robots.txt keeps it out, when `google` is 'disallowed'.
 */

/**
 * What a run records about the image files it checked.
 * @typedef {Object} ImageFilesSummary
 * @property {number} images          Distinct http(s) image URLs of rendered images on the crawled html pages.
 * @property {number} selected        URLs chosen to check (at most `LIMITS.maxImageChecks`).
 * @property {Record<string, number>} outcomes  Count per outcome.
 * @property {boolean} local          The crawl was of a site on this machine, so only images on its origin were chosen.
 * @property {boolean} [site_skipped]  The site refused some page requests of the crawl, so no image on its own host was chosen.
 */
