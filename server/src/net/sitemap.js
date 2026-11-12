// XML sitemap loading: urlset and sitemapindex files, plain or gzip-compressed.

import zlib from 'node:zlib';

import { LIMITS } from '../config.js';
import { isInternalUrl, normalizeUrl } from '../util/url.js';
import { safeFetch } from './safe-fetch.js';
import { scanSitemap } from './sitemap-scan.js';

/** @import { FetchResult, SitemapFile, SitemapSummary } from '../types.js' */

/**
 * The sitemap protocol caps an uncompressed file at 50 MB; a compressed file
 * that unpacks to more is not read. Unpacking costs that much memory at most;
 * the scanner's limits on nesting and on `loc` values keep the rest bounded.
 */
const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
/** At most this many sitemap files are listed in the summary, read or not; an index can name thousands. */
const MAX_LISTED_FILES = 100;
const ACCEPT = 'application/xml,text/xml;q=0.9,*/*;q=0.5';
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const EXTERNAL_ERROR = 'On another host; not read';
const DISALLOWED_ERROR = 'robots.txt does not allow this request or could not be read; not read';

/**
 * @param {number} value
 * @param {string} name
 */
function checkLimit(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`loadSitemaps ${name} must be a positive integer`);
}

/**
 * Turn a fetched body into text, gunzipping it when it starts with the gzip magic bytes.
 * @param {Buffer} body
 * @returns {{text: string} | {error: string}}
 */
function bodyText(body) {
  let data = body;
  if (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b) {
    try {
      data = zlib.gunzipSync(data, { maxOutputLength: MAX_UNCOMPRESSED_BYTES });
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ERR_BUFFER_TOO_LARGE') return { error: 'gzip data could not be decompressed' };
      return { error: `the file unpacks to more than ${MAX_UNCOMPRESSED_BYTES / (1024 * 1024)} MB` };
    }
  }
  return { text: data.toString('utf8').replace(/^﻿/, '') };
}

/**
 * @typedef {{kind: 'response', result: FetchResult} | {kind: 'external'} | {kind: 'disallowed'} | {kind: 'failed', status: number, error: string}} Fetched
 */

/**
 * Request one sitemap URL, following redirects only while they stay on the site
 * and robots.txt allows them. The first URL must already be allowed.
 * Every hop is a separate request through `fetch`, so a caller's pacing applies to each.
 * @param {string} url
 * @param {(url: string) => boolean} onSite
 * @param {(url: string) => Promise<boolean>} allowed
 * @param {(url: string) => Promise<FetchResult>} request
 * @returns {Promise<Fetched>}
 */
async function fetchOnSite(url, onSite, allowed, request) {
  let current = url;
  const seen = new Set([url]);
  for (let hops = 0; ; hops += 1) {
    const result = await request(current);
    if (result.error !== null || !REDIRECT_STATUSES.has(result.status)) return { kind: 'response', result };
    const target = normalizeUrl(result.headers.location ?? '', current);
    if (target === null) return { kind: 'failed', status: result.status, error: 'redirect without a valid http(s) Location' };
    if (seen.has(target)) return { kind: 'failed', status: result.status, error: 'redirect_loop: the redirects go round in a circle' };
    if (hops + 1 > LIMITS.maxRedirects) return { kind: 'failed', status: result.status, error: `too_many_redirects: more than ${LIMITS.maxRedirects} redirects` };
    if (!onSite(target)) return { kind: 'external' };
    if (!(await allowed(target))) return { kind: 'disallowed' };
    seen.add(target);
    current = target;
  }
}

/**
 * Load XML sitemaps breadth-first, following sitemap indexes.
 *
 * Guarantees:
 * - only sitemaps on the audited site (`siteHost`, when given) are requested; a
 *   sitemap on another host, listed or reached by a redirect, is a file of type
 *   'external' that was not read;
 * - `isAllowed` is asked before every request (listed files, index children, the
 *   guess and every redirect hop); a file it refuses, or whose redirect leads to
 *   a URL it refuses, is a file of type 'disallowed' that was not read. A file
 *   refused before any request does not count toward `maxFiles`; one whose
 *   redirect was refused was requested, so it does count;
 * - at most `maxFiles` files are read and at most `maxUrls` page URLs returned,
 *   normalized and de-duplicated in file order; `truncated` is true when a limit
 *   (or a body cut at the fetch size limit) left URLs out;
 * - with `probe: true` the single URL is a guess: it counts only when it answers
 *   200 with a document that parses as a sitemap, otherwise there are no files;
 *   a guess that was not read (refused itself, redirecting to a refused URL,
 *   or redirecting to another host) gives `loaded: false` and one 'disallowed'
 *   or 'external' file for the guess URL;
 * - otherwise `loaded` is true: the sitemaps were looked for.
 *
 * @param {string[]} sitemapUrls
 * @param {{fetch?: typeof safeFetch, fetchOptions?: Parameters<typeof safeFetch>[1], maxFiles?: number, maxUrls?: number,
 *          probe?: boolean, siteHost?: string, includeSubdomains?: boolean,
 *          isAllowed?: (url: string) => boolean | Promise<boolean>}} [options]
 * @returns {Promise<SitemapSummary>}
 */
export async function loadSitemaps(sitemapUrls, options = {}) {
  if (!Array.isArray(sitemapUrls)) throw new TypeError('loadSitemaps needs an array of URLs');
  const {
    fetch = safeFetch, fetchOptions = {}, maxFiles = LIMITS.maxSitemapFiles, maxUrls = LIMITS.maxSitemapUrls,
    probe = false, siteHost, includeSubdomains = false, isAllowed = () => true,
  } = options;
  checkLimit(maxFiles, 'maxFiles');
  checkLimit(maxUrls, 'maxUrls');
  /** @param {string} url */
  const onSite = (url) => siteHost === undefined || isInternalUrl(url, siteHost, includeSubdomains);
  /** @param {string} url */
  const allowed = async (url) => (await isAllowed(url)) === true;
  /** @param {string} url */
  const request = (url) => fetch(url, { ...fetchOptions, method: 'GET', maxRedirects: 0, headers: { ...fetchOptions.headers, accept: ACCEPT } });
  const none = () => ({ loaded: true, files: [], urls: [], truncated: false });

  /** @type {SitemapSummary} */
  const summary = none();
  const pageSeen = new Set();
  const fileSeen = new Set();
  let read = 0;
  /** @type {string[]} */
  const queue = [];
  for (const raw of sitemapUrls) {
    const url = normalizeUrl(raw);
    if (url !== null && !fileSeen.has(url)) {
      fileSeen.add(url);
      queue.push(url);
    }
  }

  // An index into the queue instead of shift(): an index can name tens of thousands of files.
  let next = 0;
  while (next < queue.length) {
    const url = /** @type {string} */ (queue[next]);
    if (summary.files.length >= MAX_LISTED_FILES) {
      summary.truncated = true;
      break;
    }
    if (!onSite(url)) {
      next += 1;
      summary.files.push({ url, status: 0, type: 'external', count: 0, error: EXTERNAL_ERROR });
      continue;
    }
    if (read >= maxFiles || summary.urls.length >= maxUrls) {
      summary.truncated = true;
      break;
    }
    next += 1;
    const isGuess = probe && read === 0;
    /** @type {SitemapFile} */
    const file = { url, status: 0, type: 'unreachable', count: 0, error: null };
    const notRead = () => ({ loaded: false, files: [{ ...file, type: /** @type {const} */ ('disallowed'), error: DISALLOWED_ERROR }], urls: [], truncated: false });
    if (!(await allowed(url))) {
      if (isGuess) return notRead();
      summary.files.push({ ...file, type: 'disallowed', error: DISALLOWED_ERROR });
      continue;
    }
    read += 1;
    const fetched = await fetchOnSite(url, onSite, allowed, request);

    if (fetched.kind === 'disallowed') {
      if (isGuess) return notRead();
      summary.files.push({ ...file, type: 'disallowed', error: DISALLOWED_ERROR });
      continue;
    }
    if (fetched.kind === 'external') {
      // A guess that leads off the site was not read, so nothing is known about a sitemap.
      if (isGuess) return { loaded: false, files: [{ ...file, type: 'external', error: EXTERNAL_ERROR }], urls: [], truncated: false };
      summary.files.push({ ...file, type: 'external', error: EXTERNAL_ERROR });
      continue;
    }
    if (fetched.kind === 'failed') {
      if (isGuess) return none();
      summary.files.push({ ...file, status: fetched.status, error: fetched.error });
      continue;
    }
    const { result } = fetched;
    file.status = result.status;
    if (result.error !== null || result.status !== 200) {
      if (isGuess) return none();
      file.error = result.error ? `${result.error.code}: ${result.error.message}` : `HTTP status ${result.status}`;
      summary.files.push(file);
      continue;
    }
    const decoded = bodyText(result.body ?? Buffer.alloc(0));
    const scan = 'error' in decoded ? null : scanSitemap(decoded.text, { partial: result.truncated });
    if (scan === null || scan.type === null) {
      if (isGuess) return none();
      file.type = 'invalid';
      file.error = 'error' in decoded ? decoded.error : `not a valid XML sitemap: ${scan?.error}`;
      summary.files.push(file);
      continue;
    }
    summary.files.push(file);
    file.type = scan.type;
    file.count = scan.locs.length;
    if (result.truncated) {
      summary.truncated = true;
      file.error = 'file larger than the download limit; only the first part was read';
    }

    for (const loc of scan.locs) {
      const target = normalizeUrl(loc);
      if (target === null) continue;
      if (scan.type === 'index') {
        if (!fileSeen.has(target)) {
          fileSeen.add(target);
          queue.push(target);
        }
      } else if (!pageSeen.has(target)) {
        if (summary.urls.length >= maxUrls) {
          summary.truncated = true;
          break;
        }
        pageSeen.add(target);
        summary.urls.push(target);
      }
    }
  }
  return summary;
}
