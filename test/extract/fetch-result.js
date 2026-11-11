// Builder for FetchResult values used by the extraction tests.

/** @import { FetchResult } from '../../server/src/types.js' */

export const PAGE_URL = 'https://example.test/page';

/**
 * A successful 200 HTML response for PAGE_URL unless overridden.
 * @param {Partial<FetchResult> & {html?: string}} [overrides]
 * @returns {FetchResult}
 */
export function makeFetch(overrides = {}) {
  const { html, ...rest } = overrides;
  const body = rest.body !== undefined ? rest.body : Buffer.from(html ?? '<!doctype html><title>T</title><p>Hello</p>', 'utf8');
  const url = rest.url ?? PAGE_URL;
  return {
    url,
    finalUrl: url,
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    headerLines: {},
    redirectChain: [],
    truncated: false,
    bytes: body ? body.length : 0,
    elapsedMs: 12,
    error: null,
    ...rest,
    body,
  };
}

/**
 * Input for extractPage.
 * @param {FetchResult} result
 * @param {{url?: string, siteHost?: string, includeSubdomains?: boolean}} [options]
 */
export function makeInput(result, options = {}) {
  return {
    url: options.url ?? result.url,
    result,
    depth: 1,
    discoveredVia: /** @type {('link')[]} */ (['link']),
    siteHost: options.siteHost ?? 'example.test',
    includeSubdomains: options.includeSubdomains ?? false,
  };
}
