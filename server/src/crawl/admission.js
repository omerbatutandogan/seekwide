// Which crawls may start now: one per site, and a few at most.

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

/**
 * Which site a crawl is of, for the one-crawl-per-site rule: the host name
 * without a leading "www." or a trailing dot, whatever the scheme or port,
 * since one server answers them all; for a site on this machine, the port,
 * since localhost, 127.0.0.1 and [::1] name the same server.
 * @param {string} startUrl
 * @param {boolean} loopback
 * @returns {string}
 */
export function siteKey(startUrl, loopback) {
  const url = new URL(startUrl);
  if (loopback) return `loopback:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
  return `host:${url.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '')}`;
}
