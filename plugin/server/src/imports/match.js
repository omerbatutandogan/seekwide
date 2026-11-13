// Joining the pages of an import to the pages of an audit. Both sides are
// normalized with the crawler's `normalizeUrl`, so the join is exact: a page
// is matched when it has the same address once tracking parameters, the
// fragment and escapes of unreserved characters are normalized. A local audit
// that was told the deployed address (`site_url`) reads the export's addresses
// on that origin as the same paths on the local server, as the crawl does (ARCHITECTURE 4.5).

/** @import { CrawlResult, Run } from '../types.js' */
/** @import { SearchImport } from './parse.js' */
/** @import { PageRow } from './search-data.js' */

import { normalizeUrl } from '../util/url.js';

const EXAMPLES = 10;

/**
 * @typedef {Object} PageMatch
 * @property {Map<string, PageRow>} byUrl  The import's pages under the address the audit uses for them.
 * @property {number} imported            Pages in the import.
 * @property {'crawl'|'findings'} against   What the pages were matched with: the crawl's pages, or, when the crawl
 *   is no longer in the cache, the addresses the run's findings name.
 * @property {number} matched             Pages of the import the audit has.
 * @property {number|null} crawledWithout Indexable HTML pages of the crawl that the import does not list; null without the crawl.
 * @property {PageRow[]} notCrawled       Up to ten pages of the import the audit does not have, most impressions first.
 * @property {number} onSiteHost          Pages of the import on the audited site's host (or its deployed address).
 * @property {Set<string>} audited         The addresses the pages were matched with.
 */

/**
 * The address the audit uses for an imported page.
 * @param {string} url
 * @param {{local: string|null, deployed: string|null}} origins
 * @returns {string}
 */
function auditAddress(url, origins) {
  if (origins.local === null || origins.deployed === null) return url;
  const parsed = new URL(url);
  if (parsed.origin !== origins.deployed) return url;
  return normalizeUrl(`${origins.local}${parsed.pathname}${parsed.search}`) ?? url;
}

/**
 * @param {string} url
 * @returns {string}
 */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Join an import to an audit.
 *
 * Guarantees: deterministic; each page of the import appears once in `byUrl`;
 * `notCrawled` is ordered by impressions, then clicks, then address.
 * @param {SearchImport} data
 * @param {Run} run
 * @param {CrawlResult|null} crawl  The crawl behind the run, when the cache still holds it.
 * @returns {PageMatch}
 */
export function matchPages(data, run, crawl) {
  const deployed = typeof run.repo?.deployed_origin === 'string' ? run.repo.deployed_origin : crawl?.options.deployed_origin ?? null;
  let local = null;
  try {
    local = new URL(run.start_url).origin;
  } catch {
    local = null;
  }
  const origins = { local, deployed: deployed ?? null };
  /** @type {Map<string, PageRow>} */
  const byUrl = new Map();
  for (const page of data.pages) {
    const address = auditAddress(page.url, origins);
    if (!byUrl.has(address)) byUrl.set(address, page);
  }
  const known = new Set(crawl ? crawl.pages.map((page) => page.url) : run.findings.map((finding) => finding.url).filter((url) => typeof url === 'string'));
  const siteHosts = new Set([hostOf(run.start_url), hostOf(run.site_origin), ...(deployed ? [hostOf(deployed)] : [])]);
  const missing = [...byUrl.entries()].filter(([address]) => !known.has(address)).map(([, page]) => page);
  missing.sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
  return {
    byUrl,
    imported: data.pages.length,
    against: crawl ? 'crawl' : 'findings',
    matched: byUrl.size - missing.length,
    crawledWithout: crawl ? crawl.pages.filter((page) => page.is_html && page.indexability.indexable && !byUrl.has(page.url)).length : null,
    notCrawled: missing.slice(0, EXAMPLES),
    onSiteHost: data.pages.filter((page) => siteHosts.has(hostOf(page.url))).length,
    audited: known,
  };
}

/**
 * The impressions and clicks of the page a finding is on, for ordering
 * findings. A finding about the whole site (no address) counts the site's
 * totals; a page the import does not list counts 0.
 * @param {PageMatch} match
 * @param {SearchImport} data
 * @param {string|null} url
 * @returns {{impressions: number, clicks: number}}
 */
export function trafficOf(match, data, url) {
  if (url === null) return { impressions: data.totals.impressions, clicks: data.totals.clicks };
  const page = match.byUrl.get(url);
  return page ? { impressions: page.impressions, clicks: page.clicks } : { impressions: 0, clicks: 0 };
}
