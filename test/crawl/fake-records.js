// Stand-ins for the extract/page.js builders (extractPage, redirectRecord,
// unreadableRecord), so crawler tests do not depend on the extractor. Links are
// pulled out of href="..." attributes.

import { isInternalUrl, normalizeUrl } from '../../server/src/util/url.js';
import { makeLink, makePage, makeRedirect } from '../helpers/factories.js';

/** @import { FetchResult, PageRecord, RedirectHop } from '../../server/src/types.js' */

/**
 * @param {{url: string, result: FetchResult, depth: number|null, discoveredVia: PageRecord['discovered_via'],
 *          siteHost: string, includeSubdomains?: boolean}} input
 * @returns {PageRecord}
 */
function extractPage({ url, result, depth, discoveredVia, siteHost, includeSubdomains = false }) {
  const contentType = (result.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() || null;
  const isHtml = result.error === null && contentType === 'text/html';
  const html = isHtml && result.body ? result.body.toString('utf8') : '';
  const links = [...html.matchAll(/href="([^"]*)"/g)].map((match) => {
    const target = normalizeUrl(match[1], url);
    return makeLink({
      href: match[1],
      url: /** @type {string} */ (target),
      internal: target !== null && isInternalUrl(target, siteHost, includeSubdomains),
    });
  });
  return makePage({
    url,
    status: result.status,
    final_status: result.status,
    depth,
    discovered_via: discoveredVia,
    content_type: contentType,
    is_html: isHtml,
    fetch_error: result.error?.code ?? null,
    links,
  });
}

/**
 * @param {{url: string, hops: RedirectHop[], finalUrl: string, finalStatus: number, finalExternal: boolean,
 *          fetchError: string|null, depth: number|null, discoveredVia: PageRecord['discovered_via']}} input
 * @returns {PageRecord}
 */
function redirectRecord({ url, hops, finalUrl, finalStatus, finalExternal, fetchError, depth, discoveredVia }) {
  return makeRedirect(url, finalUrl, {
    status: hops[0].status,
    final_status: finalStatus,
    final_external: finalExternal,
    redirect_chain: hops,
    fetch_error: fetchError,
    depth,
    discovered_via: discoveredVia,
  });
}

/**
 * @param {{url: string, status: number, fetchError: string, depth: number|null, discoveredVia: PageRecord['discovered_via']}} input
 * @returns {PageRecord}
 */
function unreadableRecord({ url, status, fetchError, depth, discoveredVia }) {
  return makePage({
    url,
    status,
    final_status: status,
    depth,
    discovered_via: discoveredVia,
    content_type: null,
    is_html: false,
    fetch_error: fetchError,
    titles: [],
    meta_descriptions: [],
    canonicals: [],
    headings: [],
    links: [],
    word_count: 0,
    text_hash: '',
    text_excerpt: '',
    indexability: { indexable: false, reasons: ['fetch_error'] },
  });
}

export const fakeExtract = { extractPage, redirectRecord, unreadableRecord };
