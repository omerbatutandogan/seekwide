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
  return `The crawl stopped early: ${reason}${at}${status}.${redirect ? ` ${redirect}` : ''}`;
}

/**
 * Why robots.txt could not be read when it redirected to an address the crawl
 * refused, or '' when that is not the case.
 * @param {{redirected_to?: string}} blocked
 * @returns {string}
 */
export function blockedRedirect(blocked) {
  if (typeof blocked.redirected_to !== 'string') return '';
  return `robots.txt redirects to ${blocked.redirected_to}, and the crawl did not follow it there: a crawl of a site on this machine requests nothing from any other address, and no crawl requests an address that is not public. ` +
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
 * The summary used when no written summary is given: only statements that
 * follow from the numbers, including any limit that makes the results partial.
 * @param {{
 *   host: string, pages: number, htmlPages: number, indexablePages: number, maxPages: number,
 *   checksRun: number, checksTotal: number, findings: number, checksWithFindings: number,
 *   severityCounts: Record<string, number>, scores: {label: string, score: number|null}[],
 *   truncated: boolean, blocked: {reason: string, url: string, status: number}|null, unreadablePages: number,
 *   vitals?: string|null,
 * }} facts  `vitals` is one sentence on the Core Web Vitals of the run, when they were asked for.
 * @returns {string[]} Paragraphs.
 */
export function factualSummary(facts) {
  /** @type {string[]} */
  const paragraphs = [];
  paragraphs.push(
    facts.pages === 0
      ? `Seekwide could not crawl any page of ${facts.host}.`
      : `Seekwide crawled ${plural(facts.pages, 'page')} of ${facts.host} (${facts.htmlPages} HTML, ${facts.indexablePages} indexable) and ran ${facts.checksRun} of ${plural(facts.checksTotal, 'check')}.`,
  );
  if (facts.findings === 0) {
    paragraphs.push('It found no problems in the checks that ran.');
  } else {
    const parts = SEVERITIES.filter((severity) => facts.severityCounts[severity] > 0).map(
      (severity) => `${facts.severityCounts[severity]} ${SEVERITY_LABELS[/** @type {keyof typeof SEVERITY_LABELS} */ (severity)].toLowerCase()}`,
    );
    paragraphs.push(`It recorded ${plural(facts.findings, 'finding')} across ${plural(facts.checksWithFindings, 'check')}: ${parts.join(', ')}.`);
  }
  if (facts.scores.length > 0) {
    const scored = facts.scores.map(({ label, score }) => (score === null ? `${label} could not be scored` : `${label} ${score}`));
    paragraphs.push(`Scores (pass rates of the checks that ran, 0 to 100): ${scored.join('; ')}.`);
  }
  if (facts.vitals) paragraphs.push(facts.vitals);
  if (facts.blocked) paragraphs.push(`${describeBlock(facts.blocked)} These results are partial.`);
  if (facts.unreadablePages > 0) paragraphs.push(describeUnreadable(facts.unreadablePages));
  if (facts.truncated) {
    paragraphs.push(`The crawl stopped at its limit of ${plural(facts.maxPages, 'page')}, so these results describe the pages crawled, not the whole site.`);
  }
  return paragraphs;
}
