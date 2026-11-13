// A FetchResult builder for tests that replace safeFetch.

/** @import { FetchResult } from '../../plugin/server/src/types.js' */

/**
 * @param {string} url
 * @param {Partial<FetchResult> & {text?: string}} [overrides]
 * @returns {FetchResult}
 */
export function fetchResult(url, overrides = {}) {
  const { text, ...rest } = overrides;
  const body = text === undefined ? (rest.body ?? null) : Buffer.from(text);
  return {
    url,
    finalUrl: url,
    status: 200,
    headers: {},
    headerLines: {},
    redirectChain: [],
    body,
    truncated: false,
    bytes: body ? body.length : 0,
    elapsedMs: 1,
    error: null,
    ...rest,
    ...(text === undefined ? {} : { body }),
  };
}

/**
 * A fake safeFetch that answers from a table and records every call.
 * Unknown URLs answer 404.
 * @param {Record<string, Partial<FetchResult> & {text?: string}>} table
 */
export function fakeFetch(table) {
  /** @type {{url: string, options: any}[]} */
  const calls = [];
  /** @param {string} url @param {any} [options] */
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const entry = table[url];
    return fetchResult(url, entry ?? { status: 404, text: 'not found' });
  };
  return { fetch, calls };
}
