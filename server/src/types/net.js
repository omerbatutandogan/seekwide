// Network shapes: what `safeFetch` returns (ARCHITECTURE.md 4.1). No runtime code.

export {};

/**
 * @typedef {Object} RedirectHop
 * @property {string} url          URL that answered with a redirect.
 * @property {number} status       3xx status of that answer.
 * @property {string|null} location Absolute URL the hop pointed to; null when the header was missing or invalid.
 */

/**
 * @typedef {Object} FetchError
 * @property {'invalid_url'|'unsupported_protocol'|'blocked_address'|'dns_error'|'dns_temporary'|'timeout'|'too_many_redirects'|'redirect_loop'|'connection_error'|'tls_error'|'body_error'} code
 *   `dns_error` means the name does not exist; `dns_temporary` means the lookup failed for another reason and may work later.
 * @property {string} message
 */

/**
 * Result of `safeFetch`. Network failures are reported here; `safeFetch` never throws for them.
 * @typedef {Object} FetchResult
 * @property {string} url              URL that was requested.
 * @property {string} finalUrl         URL of the last response (equals `url` when there was no redirect).
 * @property {number} status           Status of the last complete response. 0 whenever `error` is set, except for
 *   `too_many_redirects` and `redirect_loop`, which keep the status of the last redirect. A response whose body
 *   failed part-way is a failed request: status 0, never the status from its headers.
 * @property {Record<string, string>} headers  Headers of the last response, lower-cased names; repeated headers joined with ", ".
 * @property {Record<string, string[]>} headerLines  The same headers with each repeated value kept separate.
 * @property {RedirectHop[]} redirectChain  Redirect hops that were followed, in order.
 * @property {Buffer|null} body        Decompressed body; null for HEAD requests and failures.
 * @property {boolean} truncated       True when the body was cut at `maxBytes`.
 * @property {number} bytes            Size of the decompressed body that was read.
 * @property {number} elapsedMs
 * @property {FetchError|null} error
 */
