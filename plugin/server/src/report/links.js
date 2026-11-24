// The report's section on links from other sites, from imported tables of
// Search Console's Links report: which pages other sites link to and how each
// fared in the audit's crawl, and which sites the latest links come from.
// Supplied by the user, not measured; it changes no check, finding or score.

/** @import { LinkImport } from '../imports/links-record.js' */
/** @import { CrawlResult, PageRecord, Run } from '../types.js' */

import { auditAddress } from '../imports/match.js';
import { isUnverifiable } from '../checks/page-helpers.js';
import { registrableDomain } from '../util/public-suffix.js';

/** Rows listed per table. */
const LISTED = 20;
const HOSTS_LISTED = 10;

export const LINKS_SUPPLIED =
  'Imported from the Links report the user exported from Google Search Console. Google calls it a sample, not every link to the site, and a link in it may since have been removed. ' +
  'The links are not checked: Seekwide did not visit the linking pages.';

/**
 * How a page other sites link to answered in the audit's crawl.
 * @typedef {'ok'|'error'|'failed'|'redirects'|'redirects_off_site'|'redirects_to_error'|'not_indexable'|'not_checked'|'not_crawled'|'unknown'} TargetState
 */

/** The states that lose the visitor or the link: shown first. */
const PROBLEMS = new Set(['error', 'failed', 'redirects_to_error', 'redirects_off_site', 'redirects', 'not_indexable']);

/**
 * @param {PageRecord|undefined} page
 * @param {boolean} crawled  Whether the crawl behind the run is stored.
 * @returns {{state: TargetState, text: string}}
 */
export function targetState(page, crawled) {
  if (!crawled) return { state: 'unknown', text: 'Unknown: the crawl behind this audit is no longer stored' };
  if (page === undefined) return { state: 'not_crawled', text: 'Not crawled' };
  if (isUnverifiable(page)) return { state: 'not_checked', text: 'Not checked: the site refused the crawler or robots.txt kept it out' };
  if (page.status === 0) return { state: 'failed', text: 'The request failed' };
  if (page.redirect_chain.length > 0) {
    if (page.final_external) return { state: 'redirects_off_site', text: 'Redirects to another site' };
    if (page.final_status === 0 || page.final_status >= 400) return { state: 'redirects_to_error', text: `Redirects to a page that answers ${page.final_status === 0 ? 'nothing' : page.final_status}` };
    return { state: 'redirects', text: `Redirects (${page.status}) to ${page.final_url.slice(0, 300)}` };
  }
  if (page.status >= 400) return { state: 'error', text: `Answers ${page.status}` };
  if (!page.indexability.indexable) return { state: 'not_indexable', text: `Not indexable: ${page.indexability.reasons.join(', ').replaceAll('_', ' ')}` };
  return { state: 'ok', text: 'OK' };
}

/**
 * The state of each page an import of top linked pages names, by its address in the import. Pure.
 * @param {LinkImport} data
 * @param {Run} run
 * @param {CrawlResult|null} crawl
 * @returns {Map<string, {state: TargetState, text: string}>}
 */
export function linkStates(data, run, crawl) {
  const deployed = typeof run.repo?.deployed_origin === 'string' ? run.repo.deployed_origin : crawl?.options.deployed_origin ?? null;
  let local = null;
  try {
    local = new URL(run.start_url).origin;
  } catch {
    local = null;
  }
  const pages = new Map((crawl?.pages ?? []).map((page) => [page.url, page]));
  return new Map(data.targets.map((row) => [row.url, targetState(pages.get(auditAddress(row.url, { local, deployed })), crawl !== null)]));
}

/**
 * The site a linking page is on: its registrable domain (tr.linkedin.com and www.linkedin.com are linkedin.com), or its
 * host when it has none.
 * @param {string} url
 */
function siteOf(url) {
  try {
    const host = new URL(url).hostname;
    return registrableDomain(host) ?? host;
  } catch {
    return '';
  }
}

const count = (/** @type {number} */ value) => value.toLocaleString('en-US');

/**
 * @typedef {Object} LinksView
 * @property {string} supplied
 * @property {{file: string, imported: string, figures: {label: string, value: string}[], rows: {url: string, links: string, sites: string, state: string, problem: boolean}[],
 *   problems: number, shown: number, notes: string[]}|null} targets
 * @property {{file: string, imported: string, figures: {label: string, value: string}[], hosts: {host: string, pages: string, newest: string}[], notes: string[]}|null} latest
 */

/**
 * The section on links from other sites, or null without an imported Links table.
 * @param {{data: LinkImport, states: Map<string, {state: TargetState, text: string}>|null}[]} entries
 * @returns {LinksView|null}
 */
export function viewLinks(entries) {
  if (entries.length === 0) return null;
  const top = entries.find((entry) => entry.data.source === 'google_search_console_links') ?? null;
  const latest = entries.find((entry) => entry.data.source === 'google_search_console_latest_links') ?? null;
  return { supplied: LINKS_SUPPLIED, targets: top === null ? null : viewTargets(top), latest: latest === null ? null : viewLatest(latest.data) };
}

/** @param {LinkImport} data */
function notesOf(data) {
  /** @type {string[]} */
  const notes = [];
  if (data.targets.length + data.linking.length + data.counts.skipped_rows >= 1000 && data.source === 'google_search_console_links') {
    notes.push('Search Console exports at most 1,000 rows of this table, so pages beyond them are not in the file.');
  }
  if (data.counts.skipped_rows > 0) notes.push(`${count(data.counts.skipped_rows)} row${data.counts.skipped_rows === 1 ? '' : 's'} had an address Seekwide cannot use and ${data.counts.skipped_rows === 1 ? 'was' : 'were'} left out.`);
  if (data.counts.merged_rows > 0) notes.push(`${count(data.counts.merged_rows)} row${data.counts.merged_rows === 1 ? '' : 's'} named an address another row also named once written the same way, and ${data.counts.merged_rows === 1 ? 'was' : 'were'} combined.`);
  return notes;
}

/** @param {{data: LinkImport, states: Map<string, {state: TargetState, text: string}>|null}} entry */
function viewTargets({ data, states }) {
  const rows = data.targets.map((row) => {
    const state = states?.get(row.url) ?? { state: /** @type {TargetState} */ ('unknown'), text: 'Unknown: no audit to compare with' };
    return { row, state };
  });
  const problems = rows.filter((item) => PROBLEMS.has(item.state.state));
  const rest = rows.filter((item) => !PROBLEMS.has(item.state.state));
  const shown = [...problems, ...rest].slice(0, Math.max(LISTED, problems.length > LISTED ? LISTED : 0));
  const links = data.targets.reduce((sum, row) => sum + row.links, 0);
  return {
    file: data.file.path,
    imported: data.imported_at.slice(0, 10),
    figures: [
      { label: 'Pages other sites link to', value: count(data.targets.length) },
      { label: 'Incoming links', value: count(links) },
      { label: 'Linked pages with a problem in this audit', value: states === null ? '—' : count(problems.length) },
    ],
    rows: shown.map(({ row, state }) => ({ url: row.url, links: count(row.links), sites: count(row.sites), state: state.text, problem: PROBLEMS.has(state.state) })),
    problems: problems.length,
    shown: shown.length,
    notes: [
      ...(states === null ? ['There is no saved audit to compare with, so how each page answers is unknown. Audit the site and render the report again.'] : []),
      ...(problems.length > 0 ? ['A link to a page that fails, redirects or is not indexable sends its visitors, and what search engines read from it, somewhere else. Pages with a problem are listed first.'] : []),
      ...notesOf(data),
    ],
  };
}

/** @param {LinkImport} data */
function viewLatest(data) {
  /** @type {Map<string, {pages: number, newest: string}>} */
  const byHost = new Map();
  for (const row of data.linking) {
    const host = siteOf(row.url);
    const entry = byHost.get(host) ?? { pages: 0, newest: row.last_crawled };
    entry.pages += 1;
    if (row.last_crawled > entry.newest) entry.newest = row.last_crawled;
    byHost.set(host, entry);
  }
  const hosts = [...byHost.entries()].sort((a, b) => b[1].pages - a[1].pages || (a[0] < b[0] ? -1 : 1));
  return {
    file: data.file.path,
    imported: data.imported_at.slice(0, 10),
    figures: [
      { label: 'Linking pages', value: count(data.linking.length) },
      { label: 'Linking sites', value: count(byHost.size) },
      { label: 'Crawled by Google', value: `${data.linking.at(-1)?.last_crawled ?? '—'} to ${data.linking[0]?.last_crawled ?? '—'}` },
    ],
    hosts: hosts.slice(0, HOSTS_LISTED).map(([host, entry]) => ({ host, pages: count(entry.pages), newest: entry.newest })),
    notes: [
      'Latest links names the pages that link to the site, not the page each one links to. A site is its registrable domain, so tr.linkedin.com and www.linkedin.com are one site.',
      ...notesOf(data),
    ],
  };
}
