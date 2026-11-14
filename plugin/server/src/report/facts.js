// Plain-text statements built from the numbers in a run. No markup here:
// the renderers decide how to display these strings.

import { SEVERITIES } from '../config.js';
import { BLOCK_REASONS, MODULE_LABELS, SEVERITY_LABELS } from './copy.js';

/**
 * Count with a regular English plural.
 * @param {number} count
 * @param {string} noun
 * @returns {string} For example "1 page" or "3 pages".
 */
export function plural(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Display name of a module; an unknown module keeps its key.
 * @param {string} name Module key such as "seo".
 * @returns {string}
 */
export function moduleLabel(name) {
  return Object.hasOwn(MODULE_LABELS, name) ? MODULE_LABELS[/** @type {keyof typeof MODULE_LABELS} */ (name)] : name;
}

/**
 * One sentence that says why the crawl stopped.
 * @param {{reason: string, url: string, status: number, redirected_to?: string}} blocked
 * @returns {string}
 */
export function describeBlock(blocked) {
  const reason = Object.hasOwn(BLOCK_REASONS, blocked.reason) ? BLOCK_REASONS[/** @type {keyof typeof BLOCK_REASONS} */ (blocked.reason)] : blocked.reason;
  const at = blocked.url ? ` at ${blocked.url}` : '';
  const status = blocked.status ? ` (HTTP ${blocked.status})` : '';
  const redirect = blockedRedirect(blocked);
  // The address and status first, so the reason ends the sentence ("…did not try to get past it.").
  return `The crawl stopped early${at}${status}: ${reason}.${redirect ? ` ${redirect}` : ''}`;
}

/**
 * Why robots.txt could not be read when it redirected to an address the crawl
 * refused, or '' when that is not the case.
 * @param {{redirected_to?: string}} blocked
 * @returns {string}
 */
export function blockedRedirect(blocked) {
  if (typeof blocked.redirected_to !== 'string') return '';
  return `robots.txt redirects to ${blocked.redirected_to}, and the crawl did not follow it there: a crawl of a site on this machine requests nothing from any other address, no crawl requests an address that is not public, and nothing is ever requested from Google Play or a social platform. ` +
    'Serve robots.txt from the audited address itself, or audit the address it redirects to.';
}

/**
 * Plain-words statement about pages the crawler was refused on. They are left
 * out of the checks, so the audit does not cover them.
 * @param {number} count Pages that could not be read; above zero.
 * @returns {string}
 */
export function describeUnreadable(count) {
  const them = count === 1 ? 'it was' : 'they were';
  return `${plural(count, 'page')} could not be read. The crawler was refused there (a firewall or bot challenge, a rate limit, or a robots.txt rule reached through a redirect), so ${them} left out of the checks and this audit is incomplete.`;
}

/**
 * One sentence on a start URL that redirects to a login or password page.
 * @param {string} url  Where it redirects.
 * @returns {string}
 */
export function describeStartGate(url) {
  return `The start URL redirects to ${url}, a login or password page, so the site looks closed to visitors who are not logged in. The audit describes that page, not the site behind it.`;
}

/**
 * One sentence on a start page that holds almost nothing in the HTML the server sends.
 * @param {number} words
 * @returns {string}
 */
export function describeShell(words) {
  return `The start page as served has ${plural(words, 'word')} and no links: either it is nearly empty, or JavaScript builds it in the browser. Seekwide reads the HTML the server sends and runs no scripts, so findings about its title, text and links describe that empty page.`;
}

/**
 * The summary used when no written summary is given: only statements that
 * follow from the numbers, including any limit that makes the results partial.
 * @param {{
 *   host: string, pages: number, htmlPages: number, indexablePages: number, maxPages: number,
 *   checksRun: number, checksTotal: number, findings: number, checksWithFindings: number,
 *   severityCounts: Record<string, number>, scores: {label: string, score: number|null, counted?: string|null}[],
 *   truncated: boolean, timeLimited?: boolean, blocked: {reason: string, url: string, status: number}|null, unreadablePages: number,
 *   vitals?: string|null, startGate?: string|null, startShellWords?: number|null, nothingRead?: boolean,
 * }} facts  `vitals` is one sentence on the Core Web Vitals of the run, when they were asked for. `timeLimited`:
 *   the crawl was truncated by its time limit, not by its page limit. `startGate`: the login or password page the
 *   start URL redirects to. `startShellWords`: the words of a start page that holds almost nothing. `nothingRead`: the crawl
 *   was blocked before any HTML page was read.
 * @returns {string[]} Paragraphs.
 */
export function factualSummary(facts) {
  /** @type {string[]} */
  const paragraphs = [];
  if (facts.blocked && facts.nothingRead === true) {
    // Nothing could be read: say so first, and claim nothing about checks that had nothing to look at.
    paragraphs.push(`${describeBlock(facts.blocked)} No page of ${facts.host} could be read, so the checks of pages had nothing to look at and no module was scored.`);
    if (facts.findings > 0) paragraphs.push(`The checks of the site as a whole recorded ${plural(facts.findings, 'finding')}.`);
    if (facts.vitals) paragraphs.push(facts.vitals);
    return paragraphs;
  }
  paragraphs.push(
    facts.pages === 0
      ? `Seekwide could not crawl any page of ${facts.host}.`
      : `Seekwide crawled ${plural(facts.pages, 'page')} of ${facts.host} (${facts.htmlPages} HTML, ${facts.indexablePages} indexable) and ran ${facts.checksRun} of ${plural(facts.checksTotal, 'check')}.`,
  );
  if (facts.startGate) paragraphs.push(describeStartGate(facts.startGate));
  if (typeof facts.startShellWords === 'number') paragraphs.push(describeShell(facts.startShellWords));
  if (facts.findings === 0) {
    paragraphs.push('It found no problems in the checks that ran.');
  } else {
    const parts = SEVERITIES.filter((severity) => facts.severityCounts[severity] > 0).map(
      (severity) => `${facts.severityCounts[severity]} ${SEVERITY_LABELS[/** @type {keyof typeof SEVERITY_LABELS} */ (severity)].toLowerCase()}`,
    );
    paragraphs.push(`It recorded ${plural(facts.findings, 'finding')} across ${plural(facts.checksWithFindings, 'check')}: ${parts.join(', ')}.`);
  }
  const scores = facts.scores.filter(({ counted }) => !counted);
  if (scores.length > 0) {
    const scored = scores.map(({ label, score }) => (score === null ? `${label} could not be scored` : `${label} ${score}`));
    paragraphs.push(`Scores (pass rates of the checks that ran, 0 to 100): ${scored.join('; ')}.`);
  }
  // A score given as a count says what it counts ("Security headers: 0 of 3 recommended headers set").
  for (const { label, counted } of facts.scores) if (counted) paragraphs.push(`${label}: ${counted}.`);
  if (facts.vitals) paragraphs.push(facts.vitals);
  if (facts.blocked) paragraphs.push(`${describeBlock(facts.blocked)} These results are partial.`);
  if (facts.unreadablePages > 0) paragraphs.push(describeUnreadable(facts.unreadablePages));
  if (facts.truncated) {
    paragraphs.push(facts.timeLimited
      ? 'The crawl stopped at its time limit, so these results describe the pages crawled, not the whole site.'
      : `The crawl stopped at its limit of ${plural(facts.maxPages, 'page')}, so these results describe the pages crawled, not the whole site.`);
  }
  return paragraphs;
}
