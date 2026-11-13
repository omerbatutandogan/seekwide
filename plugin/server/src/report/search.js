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

/**
 * What one import says, for the report.
 * @param {SearchEntry} entry
 * @param {Map<string, number>} findingsByUrl  Findings of the run per page address.
 */
function viewSource({ data, match }, findingsByUrl) {
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
  for (const finding of findings) if (finding.url !== null) findingsByUrl.set(finding.url, (findingsByUrl.get(finding.url) ?? 0) + 1);
  return {
    sources: entries.map((entry) => viewSource(entry, findingsByUrl)),
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
