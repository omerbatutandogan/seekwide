// Reading the audited site's app association files (aso module): Apple's
// apple-app-site-association and Android's assetlinks.json, at the addresses
// both platforms read them from. robots.txt first; one GET each.

import { LIMITS } from '../config.js';
import { createSiteFileReader, mediaTypeOf } from './site-files.js';
import { safeFetch } from './safe-fetch.js';

/** @import { AppFileResult, AppFiles } from '../types.js' */
/** @import { HostGates } from './polite.js' */
/** @import { RobotsCache } from './robots-cache.js' */

/** Where Apple (Supporting associated domains) and Android (Configure assetlinks) read the files. */
export const APP_FILE_PATHS = Object.freeze({
  aasa: '/.well-known/apple-app-site-association',
  assetlinks: '/.well-known/assetlinks.json',
});
const HTML_TYPES = new Set(['text/html', 'application/xhtml+xml']);

/**
 * Read the two app association files of a site, politely.
 *
 * Guarantees: the files are asked for at `siteOrigin` + `APP_FILE_PATHS`, one
 * after the other. Before the first request to an origin its robots.txt is
 * read once (or taken from `robotsCache`, where another check of this process
 * left it); a file it disallows is 'disallowed' and never requested, and a
 * file of an origin whose robots.txt cannot be read is 'unverifiable'. Each
 * file gets one GET that reads at most `maxBytes`. A redirect is recorded and,
 * to learn whether the file is behind it, followed by hand up to 3 steps, each
 * only on a host `sameSite` accepts and its robots.txt allows; nothing is ever
 * sent to Google Play or a social platform. Requests to one host are
 * `perHostDelayMs` apart, or the host's crawl-delay when that is longer (at
 * most `LIMITS.crawlDelayMaxSec`), and pass the process-wide host gates
 * (`hosts`). The outcome is 'answered' for a 200 whose body is neither empty
 * nor an HTML page (a site that answers every unknown address with a page),
 * 'not_found' for 404, 410, an empty body or an HTML page, and 'unverifiable'
 * for anything else (a refusal, a server error, a body over `maxBytes`, a
 * network error, a redirect off the site or past 3 steps). Only an 'answered'
 * file keeps its body. No request starts after `signal` fired: the call
 * rejects with its reason.
 *
 * @param {string} siteOrigin
 * @param {{fetch?: typeof safeFetch, fetchOptions?: Parameters<typeof safeFetch>[1], perHostDelayMs?: number,
 *          sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, signal?: AbortSignal, hosts?: HostGates,
 *          robotsCache?: RobotsCache, maxBytes?: number, sameSite?: (url: string) => boolean}} [options]
 * @returns {Promise<AppFiles>}
 */
export async function fetchAppFiles(siteOrigin, options = {}) {
  const { maxBytes = LIMITS.appFileMaxBytes, ...readerOptions } = options;
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new TypeError('fetchAppFiles maxBytes must be a positive integer');
  /** @type {ReturnType<typeof createSiteFileReader>} */
  let reader;
  try {
    reader = createSiteFileReader(siteOrigin, readerOptions);
  } catch (error) {
    throw new TypeError(String(error instanceof Error ? error.message : error).replace('createSiteFileReader', 'fetchAppFiles'));
  }

  /**
   * @param {string} url
   * @returns {Promise<AppFileResult>}
   */
  const readFile = async (url) => {
    const answer = await reader.read(url, { accept: 'application/json', maxBytes });
    /** @type {AppFileResult} */
    const out = { url, outcome: 'unverifiable', status: answer.status, reason: null, location: answer.location, final_url: answer.final_url, content_type: null, body: null };
    /** @param {AppFileResult['outcome']} outcome @param {string} reason */
    const stop = (outcome, reason) => ({ ...out, outcome, reason });
    if (answer.stopped !== null) return stop(answer.stopped.outcome, answer.stopped.reason);
    const result = /** @type {import('../types.js').FetchResult} */ (answer.result);
    out.content_type = mediaTypeOf(result);
    if (result.status === 404 || result.status === 410) return stop('not_found', `status_${result.status}`);
    if (result.status !== 200) return stop('unverifiable', `status_${result.status}`);
    if (result.truncated) return stop('unverifiable', `Larger than ${Math.round(maxBytes / 1024)} KiB, so not read`);
    const body = (result.body ?? Buffer.alloc(0)).toString('utf8').replace(/^\uFEFF/, '');
    if (body.trim() === '') return stop('not_found', 'empty');
    // A page is known by its body: a server can send the real file as text/html (Apple reads no content type).
    if (body.trimStart().startsWith('<')) return stop('not_found', HTML_TYPES.has(out.content_type ?? '') ? 'html_page' : 'markup');
    return { ...out, outcome: 'answered', body };
  };

  const aasa = await readFile(`${reader.origin}${APP_FILE_PATHS.aasa}`);
  const assetlinks = await readFile(`${reader.origin}${APP_FILE_PATHS.assetlinks}`);
  return { aasa, assetlinks };
}
