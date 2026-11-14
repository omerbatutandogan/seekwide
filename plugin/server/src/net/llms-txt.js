// Reading the audited site's /llms.txt (ai module): one GET after robots.txt,
// through the same polite reader as the app association files. The result is
// information only; no score depends on it.

import { LIMITS } from '../config.js';
import { clip } from '../util/strings.js';
import { createSiteFileReader, mediaTypeOf } from './site-files.js';

/** @import { LlmsTxtResult } from '../types.js' */
/** @import { SiteFileOptions } from './site-files.js' */

export const LLMS_TXT_PATH = '/llms.txt';
/** Markdown links counted, at most. */
const MAX_LINKS = 10_000;
/** Characters kept of the H1 line. */
const H1_CHARS = 200;

/**
 * What a Markdown file's text says about its llms.txt structure (llmstxt.org:
 * an H1 with the site's name is the only required section, and comes first,
 * after an optional byte-order mark). Linear in the text.
 * @param {string} text
 * @returns {{h1: string|null, h1First: boolean, links: number}}
 */
export function readLlmsTxt(text) {
  /** @type {string|null} */
  let h1 = null;
  let h1First = false;
  let seenContent = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (h1 === null && /^# \S/.test(line)) {
      h1 = clip(line.slice(2).trim(), H1_CHARS);
      h1First = !seenContent;
      break;
    }
    seenContent = true;
  }
  let links = 0;
  for (let at = text.indexOf(']('); at !== -1 && links < MAX_LINKS; at = text.indexOf('](', at + 2)) links += 1;
  return { h1, h1First, links };
}

/**
 * Read `<origin>/llms.txt` once.
 *
 * Guarantees: everything `createSiteFileReader` guarantees (robots.txt first,
 * the host gates, `guardFetch`, redirects followed by hand only where
 * `sameSite` allows, at most 3 steps). One GET that says it accepts plain text
 * and Markdown, reading at most `maxBytes`. The outcome is 'found' for a 200
 * whose body is text that does not start with markup, 'not_found' for 404,
 * 410, an empty body, an HTML page or a redirect that ends at the start page
 * (a site that answers every address with a page has no file), 'disallowed'
 * when robots.txt does not allow the crawler to ask, and 'unverifiable' for
 * anything else. The body is never returned: only its H1 line, clipped, the
 * number of Markdown links and whether the part read was the whole file.
 * @param {string} siteOrigin
 * @param {SiteFileOptions & {maxBytes?: number, startUrl?: string|null}} [options]  `startUrl`: the start page's final URL.
 * @returns {Promise<LlmsTxtResult>}
 */
export async function fetchLlmsTxt(siteOrigin, options = {}) {
  const { maxBytes = LIMITS.llmsTxtMaxBytes, startUrl = null, ...readerOptions } = options;
  const reader = createSiteFileReader(siteOrigin, readerOptions);
  const url = `${reader.origin}${LLMS_TXT_PATH}`;
  const answer = await reader.read(url, { accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.5', maxBytes });
  /** @type {LlmsTxtResult} */
  const out = {
    url, outcome: 'unverifiable', status: answer.status, reason: null, final_url: answer.final_url, content_type: null,
    h1: null, links: 0, bytes: 0, truncated: false,
  };
  /** @param {LlmsTxtResult['outcome']} outcome @param {string} reason @returns {LlmsTxtResult} */
  const stop = (outcome, reason) => ({ ...out, outcome, reason });
  if (answer.stopped !== null) return stop(answer.stopped.outcome, answer.stopped.reason);
  const result = /** @type {import('../types.js').FetchResult} */ (answer.result);
  out.content_type = mediaTypeOf(result);
  if (result.status === 404 || result.status === 410) return stop('not_found', `status_${result.status}`);
  if (result.status !== 200) return stop('unverifiable', `status_${result.status}`);
  const end = answer.final_url;
  if (end !== null && (end === startUrl || new URL(end).pathname === '/')) return stop('not_found', 'redirects_to_start');
  const body = (result.body ?? Buffer.alloc(0)).toString('utf8').replace(/^﻿/, '');
  if (body.trim() === '') return stop('not_found', 'empty');
  if (body.trimStart().startsWith('<')) return stop('not_found', 'html_page');
  const read = readLlmsTxt(body);
  return { ...out, outcome: 'found', h1: read.h1, links: read.links, bytes: result.body?.length ?? 0, truncated: result.truncated, reason: read.h1 === null ? 'no_h1' : read.h1First ? null : 'h1_not_first' };
}
