// Which crawls may start now: one per site (`crawlKey`, site-identity.js), and a few at most.

/**
 * Crawls that may run at once. Each crawl paces its own requests, so two crawls
 * of one site would double the rate the site gets: a site has one crawl at a time.
 */
export const MAX_RUNNING = 3;

/**
 * A TypeError for a crawl that cannot start now, marked so that the tool does
 * not tell the model to change its arguments.
 * @param {string} message
 * @returns {TypeError & {busy: true}}
 */
export function busy(message) {
  return Object.assign(new TypeError(message), { busy: /** @type {const} */ (true) });
}
