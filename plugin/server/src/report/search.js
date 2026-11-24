// The search performance section of the report, built from imported exports,
// and the order of findings that the imported impressions give. The numbers
// come from a file the user supplied; they are shown as such and never change
// a check, a finding or a score.

/** @import { SearchImport } from '../imports/parse.js' */
/** @import { PageMatch } from '../imports/match.js' */
/** @import { FindingView } from './findings.js' */

import { trafficOf } from '../imports/match.js';
import { clicksOverImpressions } from '../imports/search-data.js';
import { SEVERITIES } from '../config.js';
import { clip } from '../util/strings.js';
import { plural } from './facts.js';

/** @typedef {{data: SearchImport, match: PageMatch}} SearchEntry */
/** @typedef {{impressions: number, clicks: number}} Traffic */

const TOP_PAGES = 10;
/** Pages with fewer impressions are not compared by click-through rate. */
export const CTR_MIN_IMPRESSIONS = 100;
/** Fewest compared pages a position band needs for its median to be used. */
export const CTR_MIN_BAND_PAGES = 5;
/** A page is listed when its click-through rate is below this share of its band's median. */
export const CTR_SHARE = 0.5;
const CTR_LISTED = 10;
/** Position bands, by the page's average position rounded to a whole number: 1, 2, 3, 4–5 and 6–10. */
const BANDS = [{ label: '1', low: 1, high: 1 }, { label: '2', low: 2, high: 2 }, { label: '3', low: 3, high: 3 }, { label: '4–5', low: 4, high: 5 }, { label: '6–10', low: 6, high: 10 }];
/** Findings about what a search result shows of a page: its title and its description. */
const SNIPPET_CHECKS = /^(?:seo\.title\.|seo\.meta_description\.|sxo\.title\.)/;
export const CTR_TOO_FEW = 'Too few pages to compare: each position band needs 5 pages with 100 or more impressions.';
export const CTR_NONE = 'No page has a click-through rate under half the median at its position.';
export const CTR_NOTE =
  'Pages whose click-through rate is under half the median of the site\'s own pages at about the same position, among pages with 100 or more impressions. ' +
  'Neither Google nor Bing publishes an expected click-through rate for a position, so pages are compared only with each other. ' +
  'A low rate can come from the title and description, from what else the results page shows, or from what people searched for; it is a place to look, not a finding.';
const SOURCE_NAMES = { google_search_console: 'Google Search Console', bing_webmaster_tools: 'Bing Webmaster Tools' };
const REPORT_NAMES = { google_search_console: 'Performance report', bing_webmaster_tools: 'Search Performance report' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const SEARCH_ORDER_NOTE =
  'With imported search data, findings of the same severity are listed by the impressions of the pages they are on, most first: a finding about the whole site counts the site\'s impressions, and a page the export does not list counts none. ' +
  'The order is all that changes; the checks, findings and scores are the same as without the data.';

/**
 * A whole number with thousands separated by commas: 12,345.
 * @param {number} value
 * @returns {string}
 */
export function formatCount(value) {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * @param {number} clicks
 * @param {number} impressions
 * @returns {string}  Clicks divided by impressions, as Google and Bing define the click-through rate.
 */
const ctrText = (clicks, impressions) => (impressions > 0 ? `${((clicks / impressions) * 100).toFixed(1)}%` : '—');

/** @param {number|null} value */
const positionText = (value) => (value === null ? '—' : value.toFixed(1));

/** @param {string} iso */
function dayText(iso) {
  const date = new Date(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** @param {number[]} values  Not empty. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The pages of an import whose click-through rate is low for their position, compared with the import's own pages in
 * the same position band. Pure.
 * @param {SearchImport} data
 * @param {(page: SearchImport['pages'][number]) => string} addressOf  The audit's address for a row of the export's pages.
 * @param {Map<string, string[]>} snippetFindings  Titles of the run's title and description findings per page address.
 */
export function lowClickThrough(data, addressOf, snippetFindings) {
  /** @typedef {{row: SearchImport['pages'][number], position: number, ctr: number}} Compared */
  /** @type {Map<string, Compared[]>} */
  const groups = new Map(BANDS.map((band) => [band.label, []]));
  for (const page of data.pages) {
    if (page.position === null || page.impressions < CTR_MIN_IMPRESSIONS) continue;
    const rounded = Math.round(page.position);
    const band = BANDS.find((item) => rounded >= item.low && rounded <= item.high);
    if (band === undefined) continue;
    groups.get(band.label)?.push({ row: page, position: page.position, ctr: page.clicks / page.impressions });
  }
  const bands = [];
  const pages = [];
  for (const band of BANDS) {
    const rows = /** @type {Compared[]} */ (groups.get(band.label));
    if (rows.length < CTR_MIN_BAND_PAGES) {
      bands.push({ label: band.label, pages: rows.length, median: null });
      continue;
    }
    const mid = median(rows.map((row) => row.ctr));
    bands.push({ label: band.label, pages: rows.length, median: mid });
    for (const row of rows) if (row.ctr < mid * CTR_SHARE) pages.push({ ...row, band: band.label, median: mid });
  }
  pages.sort((a, b) => b.row.impressions - a.row.impressions || (a.row.url < b.row.url ? -1 : 1));
  return {
    bands: bands.map((band) => ({ label: band.label, pages: band.pages, median: band.median === null ? '—' : `${(band.median * 100).toFixed(1)}%` })),
    compared: bands.some((band) => band.median !== null),
    listed: pages.length,
    pages: pages.slice(0, CTR_LISTED).map((page) => ({
      url: page.row.url,
      impressions: formatCount(page.row.impressions),
      position: positionText(page.position),
      ctr: ctrText(page.row.clicks, page.row.impressions),
      median: `${(page.median * 100).toFixed(1)}%`,
      snippet: snippetFindings.get(addressOf(page.row)) ?? [],
    })),
    note: CTR_NOTE,
  };
}

/**
 * What one import says, for the report.
 * @param {SearchEntry} entry
 * @param {Map<string, number>} findingsByUrl  Findings of the run per page address.
 * @param {Map<string, string[]>} snippetFindings  Titles of the run's title and description findings per page address.
 */
function viewSource({ data, match }, findingsByUrl, snippetFindings) {
  const name = SOURCE_NAMES[data.source];
  const addresses = new Map([...match.byUrl.entries()].map(([address, row]) => [row, address]));
  const period = data.period === null ? null : `${data.period.start} to ${data.period.end}`;
  let periodText = 'The file does not say which dates it covers.';
  if (data.period !== null) periodText = data.period.from === 'file' ? `${period}, from the export's table of dates.` : `${period}, as stated when the file was imported.`;
  const totalsNote = data.totals.from === 'dates'
    ? 'Totals are the sums of the export\'s table of dates; the average position is weighted by impressions.'
    : `Totals are the sums of the ${plural(data.pages.length, 'page')} in the export, which can be less than the site's own totals; the average position is weighted by impressions.`;
  const matchText = match.against === 'crawl'
    ? `${match.matched} of ${plural(match.imported, 'page')} in the export were crawled in this audit; ${plural(/** @type {number} */ (match.crawledWithout), 'indexable crawled page')} ${match.crawledWithout === 1 ? 'is' : 'are'} not in the export.`
    : `The crawl behind this audit is no longer stored, so the export was matched with the pages that have findings: ${match.matched} of ${plural(match.imported, 'page')} in the export have findings in this audit.`;
  /** @type {string[]} */
  const notes = [];
  if (match.onSiteHost === 0) notes.push('None of the pages in the export is on the audited host, so the export may be of another site or another version of its address (with or without www, http or https).');
  if (data.source === 'google_search_console' && data.pages.length + data.counts.skipped_pages >= 1000) {
    notes.push('Search Console exports at most 1,000 rows of a table, so pages beyond them are not in the file and count as having no impressions.');
  }
  const over = clicksOverImpressions(data);
  if (over > 0) notes.push(`The export gives ${plural(over, 'page')} more clicks than impressions, so ${over === 1 ? 'its' : 'their'} click-through rate is over 100%; the figures are shown as the export states them.`);
  if (data.counts.skipped_pages > 0) notes.push(`${plural(data.counts.skipped_pages, 'row')} of the table of pages had an address Seekwide cannot use and ${data.counts.skipped_pages === 1 ? 'was' : 'were'} left out.`);
  return {
    name,
    report: REPORT_NAMES[data.source],
    file: clip(data.file.path, 300),
    imported: dayText(data.imported_at),
    period,
    periodText,
    filters: data.filters.map((filter) => ({ name: filter.name, value: filter.value })),
    figures: [
      { label: 'Clicks', value: formatCount(data.totals.clicks) },
      { label: 'Impressions', value: formatCount(data.totals.impressions) },
      { label: 'CTR', value: ctrText(data.totals.clicks, data.totals.impressions) },
      { label: 'Average position', value: positionText(data.totals.position) },
    ],
    totalsNote,
    matchText,
    notes,
    clickThrough: lowClickThrough(data, (page) => addresses.get(page) ?? page.url, snippetFindings),
    topPages: data.pages.slice(0, TOP_PAGES).map((page) => {
      const address = addresses.get(page) ?? page.url;
      // A crawled page without findings has 0; a page the audit does not have is "not crawled" (or unknown without the crawl).
      let found = match.against === 'crawl' ? 'Not crawled' : '—';
      if (findingsByUrl.has(address)) found = String(findingsByUrl.get(address));
      else if (match.against === 'crawl' && match.audited.has(address)) found = '0';
      return {
        url: page.url,
        clicks: formatCount(page.clicks),
        impressions: formatCount(page.impressions),
        ctr: ctrText(page.clicks, page.impressions),
        position: positionText(page.position),
        findings: found,
      };
    }),
  };
}

/**
 * The search performance section; null without imported data.
 * @param {SearchEntry[]} entries
 * @param {FindingView[]} findings
 */
export function viewSearch(entries, findings) {
  if (entries.length === 0) return null;
  /** @type {Map<string, number>} */
  const findingsByUrl = new Map();
  /** @type {Map<string, string[]>} */
  const snippetFindings = new Map();
  for (const finding of findings) {
    if (finding.url === null) continue;
    findingsByUrl.set(finding.url, (findingsByUrl.get(finding.url) ?? 0) + 1);
    if (!SNIPPET_CHECKS.test(finding.checkId)) continue;
    const list = snippetFindings.get(finding.url) ?? [];
    if (!list.includes(finding.title)) list.push(finding.title);
    snippetFindings.set(finding.url, list);
  }
  return {
    sources: entries.map((entry) => viewSource(entry, findingsByUrl, snippetFindings)),
    supplied: 'These numbers come from export files the user downloaded and imported. Seekwide did not measure them and does not check them against the search engines.',
    orderNote: SEARCH_ORDER_NOTE,
  };
}

/**
 * The Search visibility layer of the report when imported data fills it.
 * @param {SearchEntry[]} entries
 */
export function searchLayer(entries) {
  const sources = entries.map(({ data }) => `${SOURCE_NAMES[data.source]}${data.period ? ` (${data.period.start} to ${data.period.end})` : ''}`);
  return {
    name: 'Search visibility',
    measured: true,
    status: 'Imported data',
    text: `Clicks, impressions, click-through rate and average position from ${sources.join(' and ')}. The values are in the Search performance section.`,
    detail: 'Supplied by the user as an export file; not measured by Seekwide.',
  };
}

/**
 * Order groups of findings by the impressions of their pages within each
 * severity, and the findings of a group the same way. Without imported data
 * the order is kept and every `traffic` is null.
 *
 * Guarantees: deterministic; a group keeps its severity rank, and groups with
 * the same impressions keep the order they came in (impact, effort, check id);
 * findings with the same impressions keep theirs. Each group gets `traffic`
 * (its distinct pages added up, the whole site counted once for a finding with
 * no page) and each finding `traffic`, summed over the imports.
 * @template {{severity: string, findings: FindingView[]}} G
 * @param {G[]} groups  In report order.
 * @param {SearchEntry[]} entries
 * @returns {(G & {traffic: Traffic|null, findings: (FindingView & {traffic: Traffic|null})[]})[]}
 */
export function prioritize(groups, entries) {
  if (entries.length === 0) return groups.map((group) => ({ ...group, traffic: null, findings: group.findings.map((finding) => ({ ...finding, traffic: null })) }));
  /** @param {string|null} url @returns {Traffic} */
  const traffic = (url) => entries.reduce((sum, { data, match }) => {
    const one = trafficOf(match, data, url);
    return { impressions: sum.impressions + one.impressions, clicks: sum.clicks + one.clicks };
  }, { impressions: 0, clicks: 0 });
  const ranked = groups.map((group, index) => {
    const findings = group.findings.map((finding, order) => ({ finding: { ...finding, traffic: traffic(finding.url) }, order }));
    findings.sort((a, b) => b.finding.traffic.impressions - a.finding.traffic.impressions || a.order - b.order);
    const pages = [...new Set(group.findings.map((finding) => finding.url))].map(traffic);
    const total = pages.reduce((sum, one) => ({ impressions: sum.impressions + one.impressions, clicks: sum.clicks + one.clicks }), { impressions: 0, clicks: 0 });
    return { group: { ...group, traffic: /** @type {Traffic|null} */ (total), findings: findings.map((entry) => entry.finding) }, index };
  });
  ranked.sort((a, b) =>
    SEVERITIES.indexOf(a.group.severity) - SEVERITIES.indexOf(b.group.severity) ||
    /** @type {Traffic} */ (b.group.traffic).impressions - /** @type {Traffic} */ (a.group.traffic).impressions ||
    a.index - b.index);
  return ranked.map((entry) => entry.group);
}

/**
 * "12,345 impressions and 678 clicks" for a group or a finding with search data.
 * @param {Traffic} traffic
 * @returns {string}
 */
export function trafficText(traffic) {
  return `${formatCount(traffic.impressions)} ${traffic.impressions === 1 ? 'impression' : 'impressions'} and ${formatCount(traffic.clicks)} ${traffic.clicks === 1 ? 'click' : 'clicks'}`;
}
