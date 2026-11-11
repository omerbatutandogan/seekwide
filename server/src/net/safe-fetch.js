// The only way server code talks to the network. It refuses non-public
// addresses, pins the socket to the address it checked, and never throws for
// network problems.

import http from 'node:http';
import https from 'node:https';

import { LIMITS, USER_AGENT } from '../config.js';
import { readBody } from './body.js';
import { FetchFailure, pinnedLookup, resolveAndCheck, toFailure } from './connect.js';

export { pinnedLookup };

/** @import { FetchResult, RedirectHop } from '../types.js' */
/** @import { CheckedAddress } from './connect.js' */

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5';
/** Errors that keep the status of the last redirect; every other error means status 0. */
const KEEPS_STATUS = new Set(['too_many_redirects', 'redirect_loop']);

/**
 * @typedef {Object} SafeFetchOptions
 * @property {'GET'|'HEAD'|'POST'} [method]
 * @property {string|Buffer} [body]  Request body. Only with POST, which is for API calls and is never redirected.
 * @property {Record<string,string>} [headers]
 * @property {string} [userAgent]
 * @property {number} [timeoutMs]
 * @property {number} [maxBytes]
 * @property {number} [maxRedirects]
 * @property {boolean|string} [allowLoopback]  true: any loopback address (tests). An origin such as
 *   "http://localhost:3000": loopback only for URLs with exactly that origin.
 */

/**
 * @param {SafeFetchOptions} options
 * @returns {Required<Omit<SafeFetchOptions, 'headers'|'allowLoopback'|'body'>> & {headers: Record<string,string>, allowLoopback: boolean, loopbackOrigin: string|null, body: Buffer|null}}
 */
function validateOptions(options) {
  if (options === null || typeof options !== 'object') throw new TypeError('safeFetch options must be an object');
  const { method = 'GET', headers = {}, userAgent = USER_AGENT, timeoutMs = LIMITS.requestTimeoutMs } = options;
  const { maxBytes = LIMITS.maxBodyBytes, maxRedirects = LIMITS.maxRedirects, allowLoopback = false } = options;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') throw new TypeError('safeFetch method must be GET, HEAD or POST');
  const rawBody = options.body;
  if (rawBody !== undefined && method !== 'POST') throw new TypeError('safeFetch body is only sent with POST');
  if (rawBody !== undefined && typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody)) throw new TypeError('safeFetch body must be a string or a Buffer');
  const body = method === 'POST' ? Buffer.from(rawBody ?? '') : null;
  if (headers === null || typeof headers !== 'object') throw new TypeError('safeFetch headers must be an object');
  for (const value of Object.values(headers)) {
    if (typeof value !== 'string') throw new TypeError('safeFetch header values must be strings');
  }
  if (typeof userAgent !== 'string' || userAgent.trim() === '') throw new TypeError('safeFetch userAgent must be a non-empty string');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('safeFetch timeoutMs must be a positive number');
  if (!Number.isInteger(maxBytes) || maxBytes < 0) throw new TypeError('safeFetch maxBytes must be a non-negative integer');
  if (!Number.isInteger(maxRedirects) || maxRedirects < 0) throw new TypeError('safeFetch maxRedirects must be a non-negative integer');
  let loopbackOrigin = null;
  if (typeof allowLoopback === 'string') {
    let parsed = null;
    try {
      parsed = new URL(allowLoopback);
    } catch {
      parsed = null;
    }
    if (parsed === null || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      throw new TypeError('safeFetch allowLoopback must be a boolean or an http(s) origin');
    }
    loopbackOrigin = parsed.origin;
  } else if (typeof allowLoopback !== 'boolean') {
    throw new TypeError('safeFetch allowLoopback must be a boolean or an http(s) origin');
  }
  return { method, headers, userAgent, timeoutMs, maxBytes, maxRedirects, allowLoopback: allowLoopback === true, loopbackOrigin, body };
}


/**
 * Send one request and wait for the response head.
 * @param {URL} url
 * @param {{method: string, headers: Record<string,string>, body: Buffer|null, addresses: CheckedAddress[], signal: AbortSignal}} params
 * @returns {Promise<http.IncomingMessage>}
 */
function sendRequest(url, { method, headers, body, addresses, signal }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? https : http;
    // agent: false gives every request its own connection, so no pooled socket
    // from an earlier check is ever reused for a different target.
    const req = transport.request(url, { method, headers, agent: false, lookup: /** @type {any} */ (pinnedLookup(addresses)), signal });
    req.on('response', resolve);
    req.on('error', (error) => reject(signal.aborted ? signal.reason : error));
    if (body === null) req.end();
    else req.end(body);
  });
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal} signal
 * @returns {Promise<T>}
 */
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/**
 * @param {string[]} rawHeaders
 * @returns {{headers: Record<string,string>, headerLines: Record<string,string[]>}}
 */
function collectHeaders(rawHeaders) {
  /** @type {Record<string,string[]>} */
  const headerLines = {};
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = rawHeaders[i].toLowerCase();
    (headerLines[name] ??= []).push(rawHeaders[i + 1]);
  }
  /** @type {Record<string,string>} */
  const headers = {};
  for (const [name, values] of Object.entries(headerLines)) headers[name] = values.join(', ');
  return { headers, headerLines };
}

/**
 * Fetch a URL over http or https, refusing any non-public address.
 *
 * Guarantees:
 * - every hop (the first request and each redirect) is checked for protocol and
 *   address before a connection is made, and the socket connects only to an
 *   address that passed the check;
 * - loopback is reachable only with `allowLoopback` (with an origin string, only for that origin), other non-public ranges never;
 * - user names and passwords in the URL or a redirect are removed before the request, never reported and never sent;
 * - when `error` is set, `status` is 0 and there are no headers, except for `too_many_redirects` and `redirect_loop`,
 *   which keep the last redirect's status and headers;
 * - the identifying user agent is always sent; TLS verification is never disabled;
 * - a POST is never redirected: a 3xx answer is its final response, so a request body and the headers
 *   that came with it are sent to the URL the caller named and nowhere else;
 * - network failures are returned in `error`, never thrown. Only invalid options throw `TypeError`.
 *
 * @param {string} url
 * @param {SafeFetchOptions} [options]
 * @returns {Promise<FetchResult>}
 */
export async function safeFetch(url, options = {}) {
  if (typeof url !== 'string') throw new TypeError('safeFetch url must be a string');
  const opts = validateOptions(options);
  const started = performance.now();
  /** @type {Record<string,string>} */
  const headers = { accept: DEFAULT_ACCEPT };
  for (const [name, value] of Object.entries(opts.headers)) headers[name.toLowerCase()] = value;
  delete headers.authorization;
  delete headers['proxy-authorization'];
  headers['user-agent'] = opts.userAgent;
  headers['accept-encoding'] = 'gzip, deflate, br';
  if (opts.body !== null) headers['content-length'] = String(opts.body.length);
  else delete headers['content-length'];
  const followRedirects = opts.maxRedirects > 0 && opts.method !== 'POST';

  /** @type {FetchResult} */
  const result = {
    url, finalUrl: url, status: 0, headers: {}, headerLines: {}, redirectChain: [],
    body: null, truncated: false, bytes: 0, elapsedMs: 0, error: null,
  };
  const controller = new AbortController();
  const timeoutError = new FetchFailure('timeout', `No complete response within ${opts.timeoutMs} ms`);
  const timer = setTimeout(() => controller.abort(timeoutError), opts.timeoutMs);
  const { signal } = controller;

  try {
    /** @type {URL} */
    let current;
    try {
      current = new URL(url);
    } catch {
      throw new FetchFailure('invalid_url', `Not a valid URL: ${url}`);
    }
    current.hash = '';
    if (current.username !== '' || current.password !== '') {
      current.username = '';
      current.password = '';
      result.url = current.href;
    }
    const seen = new Set([current.href]);

    for (;;) {
      result.finalUrl = result.redirectChain.length === 0 ? result.url : current.href;
      if (current.protocol !== 'http:' && current.protocol !== 'https:') {
        throw new FetchFailure('unsupported_protocol', `Only http and https are supported, not ${current.protocol}`);
      }
      const permitLoopback = opts.allowLoopback || current.origin === opts.loopbackOrigin;
      const addresses = await abortable(resolveAndCheck(current, permitLoopback), signal).catch((error) => {
        if (error === timeoutError) throw new FetchFailure('dns_temporary', `DNS lookup did not finish within ${opts.timeoutMs} ms`);
        throw error;
      });
      /** @type {http.IncomingMessage} */
      const res = await sendRequest(current, { method: opts.method, headers, body: opts.body, addresses, signal }).catch((error) => {
        throw toFailure(error);
      });
      result.status = res.statusCode ?? 0;
      Object.assign(result, collectHeaders(res.rawHeaders));

      const location = res.headers.location;
      if (REDIRECT_STATUSES.has(result.status) && location !== undefined && followRedirects) {
        let next = null;
        try {
          next = new URL(location, current);
          next.hash = '';
          next.username = '';
          next.password = '';
        } catch {
          next = null;
        }
        if (next !== null) {
          res.destroy();
          /** @type {RedirectHop} */
          const hop = { url: current.href, status: result.status, location: next.href };
          result.redirectChain.push(hop);
          if (seen.has(next.href)) throw new FetchFailure('redirect_loop', `Redirect loop: ${next.href} was already visited`);
          if (result.redirectChain.length > opts.maxRedirects) {
            throw new FetchFailure('too_many_redirects', `More than ${opts.maxRedirects} redirects`);
          }
          seen.add(next.href);
          current = next;
          continue;
        }
      }

      if (opts.method === 'HEAD') {
        res.destroy();
        break;
      }
      try {
        const { body, truncated } = await readBody(res, opts.maxBytes, signal);
        result.body = body;
        result.truncated = truncated;
        result.bytes = body.length;
      } catch (error) {
        if (error instanceof FetchFailure) throw error;
        throw new FetchFailure('body_error', /** @type {Error} */ (error)?.message ?? 'Could not read the body');
      }
      break;
    }
  } catch (error) {
    const failure = error instanceof FetchFailure ? error : toFailure(error);
    result.error = { code: failure.code, message: failure.message };
    if (!KEEPS_STATUS.has(failure.code)) {
      result.status = 0;
      result.headers = {};
      result.headerLines = {};
    }
    result.body = null;
    result.truncated = false;
    result.bytes = 0;
  } finally {
    clearTimeout(timer);
  }
  result.elapsedMs = Math.round(performance.now() - started);
  return result;
}
