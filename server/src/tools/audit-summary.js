// What audit_run's result says besides the scores: the top problems, the
// skipped checks and plain notes on whatever limits the run.

/** @import { CheckStat, CrawlResult, Finding, VitalsData } from '../types.js' */

import { LIMITS, SEVERITIES } from '../config.js';
import { isUnverifiable } from '../checks/page-helpers.js';
import { blockedRedirect } from '../report/facts.js';
import { deployedNotes } from './audit-deployed.js';
import { vitalsNotes } from './audit-vitals.js';
import { countBy } from './common.js';

const EXAMPLE_URLS = 3;

/** Plain words for the reasons `isUnverifiable` accepts. */
const UNREADABLE_REASONS = {
  bot_challenge: "the site's firewall challenged the crawler",
  rate_limited: 'the site kept rate-limiting the crawler',
  robots_disallowed: 'a redirect led to a URL that robots.txt does not allow the crawler to request, or whose robots.txt could not be read',
};

/**
 * One sentence on the records the crawler was refused on, or null when there are none.
 * @param {CrawlResult} crawl
 * @returns {string|null}
 */
export function unreadableNote(crawl) {
  const unreadable = crawl.pages.filter(isUnverifiable);
  if (unreadable.length === 0) return null;
  const counts = countBy(unreadable, (page) => /** @type {string} */ (page.fetch_error));
  const reasons = Object.entries(counts)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([reason, count]) => `${count} because ${UNREADABLE_REASONS[/** @type {keyof typeof UNREADABLE_REASONS} */ (reason)] ?? reason}`);
  const pages = unreadable.length === 1 ? '1 page' : `${unreadable.length} pages`;
  return `${pages} could not be read: ${reasons.join(', ')}. The checks leave them out, because a refusal says nothing about what visitors or search engines get.`;
}

/**
 * Findings grouped by check, ordered like the report's top fixes: severity,
 * then impact (high first), then effort (low first).
 * @param {Finding[]} findings
 * @param {number} limit
 */
export function topGroups(findings, limit) {
  /** @type {Map<string, Finding[]>} */
  const groups = new Map();
  for (const finding of findings) {
    const list = groups.get(finding.check_id);
    if (list) list.push(finding);
    else groups.set(finding.check_id, [finding]);
  }
  return [...groups.values()]
    .map((list) => list[0])
    .sort(
      (a, b) =>
        SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
        b.impact - a.impact ||
        a.effort - b.effort ||
        (a.check_id < b.check_id ? -1 : a.check_id > b.check_id ? 1 : 0),
    )
    .slice(0, limit)
    .map((first) => {
      const list = /** @type {Finding[]} */ (groups.get(first.check_id));
      const urls = [...new Set(list.map((finding) => finding.url).filter((url) => url !== null))];
      const files = [...new Set(list.flatMap((finding) => (finding.source ? [finding.source.file] : [])))];
      return {
        check_id: first.check_id,
        title: first.title,
        severity: first.severity,
        confidence: first.confidence,
        count: list.length,
        example_urls: urls.slice(0, EXAMPLE_URLS),
        recommendation: first.recommendation,
        // Repo mode: the source files behind the group, when any finding names one.
        ...(files.length > 0 ? { example_files: files.slice(0, EXAMPLE_URLS) } : {}),
      };
    });
}

/**
 * Plain statements about anything that limits what this run can say.
 * @param {CrawlResult} crawl
 * @param {{requested: boolean, checked: boolean, found: number}} outbound
 *   `requested`: the links module ran; `checked`: external links were checked.
 * @param {{requested: boolean, checked: boolean, vitals: VitalsData|null}} vitals
 *   `requested`: the seo module ran; `checked`: Core Web Vitals were asked for.
 * @param {string[]} repoNotes  What repo mode has to say about the source files; empty outside repo mode.
 */
export function runNotes(crawl, outbound, vitals, repoNotes) {
  const notes = [];
  if (crawl.blocked) {
    const redirect = blockedRedirect(crawl.blocked);
    notes.push(`The crawl was stopped (${crawl.blocked.reason}) at ${crawl.blocked.url}.${redirect ? ` ${redirect}` : ''} Findings cover only what was fetched before that; the crawler never tries to get past a block.`);
  }
  if (crawl.time_limit_reached === true) {
    notes.push(`The crawl stopped at its time limit of ${LIMITS.crawlMaxMs / 60_000} minutes with URLs left to visit, so checks that need a complete crawl were skipped. Crawl again with a smaller max_pages, or crawl the sections that matter one at a time.`);
  } else if (crawl.truncated) {
    notes.push(`The crawl stopped at its page budget (${crawl.options.max_pages} pages), so checks that need a complete crawl were skipped. Crawl again with a larger max_pages for full coverage.`);
  }
  if (crawl.robots.status === 'unreachable') notes.push('robots.txt could not be read, so the crawl could not go further than allowed by default.');
  const disallowedSitemaps = crawl.sitemap.files.filter((file) => file.type === 'disallowed').length;
  if (crawl.sitemap.loaded && disallowedSitemaps > 0) {
    notes.push(`${disallowedSitemaps} sitemap ${disallowedSitemaps === 1 ? 'file was' : 'files were'} not read because robots.txt does not allow the crawler to request ${disallowedSitemaps === 1 ? 'it' : 'them'}, or could not be read.`);
  }
  if (!crawl.sitemap.loaded && disallowedSitemaps > 0) {
    notes.push('No sitemap could be read: robots.txt lists none, and it does not allow the crawler to read /sitemap.xml (or robots.txt itself could not be read).');
  }
  if (!crawl.sitemap.loaded && crawl.sitemap.files.some((file) => file.type === 'external')) {
    notes.push('No sitemap could be read: robots.txt lists none, and /sitemap.xml redirects to another host, which the crawler does not read.');
  }
  const unreadable = unreadableNote(crawl);
  if (unreadable) notes.push(unreadable);
  notes.push(...vitalsNotes(vitals));
  notes.push(...deployedNotes(crawl));
  notes.push(...repoNotes);
  if (!outbound.requested) return notes;
  if (!outbound.checked) {
    notes.push('External links were not checked (check_outbound_links was false), so checks that need them were skipped.');
  } else if (outbound.found > LIMITS.maxOutboundChecks) {
    notes.push(`The site links to ${outbound.found} external URLs; the first ${LIMITS.maxOutboundChecks} in sorted order were checked.`);
  }
  return notes;
}

/**
 * The checks that did not run, with the reason.
 * @param {CheckStat[]} checks
 */
export function skippedChecks(checks) {
  return checks
    .filter((check) => check.status !== 'run')
    .map((check) => ({ id: check.id, status: check.status, reason: check.skip_reason }));
}
