import { SEVERITIES } from '../config.js';
import { clip } from '../util/strings.js';
import { compareText, obj, str, text } from './values.js';

const EXAMPLE_URLS = 3;
const EVIDENCE_MAX = 300;
const CHANGE_GROUPS = 10;

/** @param {unknown} value @returns {string} */
function severityOf(value) {
  return SEVERITIES.includes(/** @type {string} */ (value)) ? /** @type {string} */ (value) : 'info';
}

/** @param {unknown} value @returns {1|2|3} */
function levelOf(value) {
  return value === 1 || value === 3 ? value : 2;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function evidenceText(value) {
  if (typeof value === 'string') return clip(value, EVIDENCE_MAX);
  try {
    return clip(JSON.stringify(value) ?? String(value), EVIDENCE_MAX);
  } catch {
    return clip(String(value), EVIDENCE_MAX);
  }
}

/**
 * @typedef {Object} EvidencePart
 * @property {string} label
 * @property {'code'|'text'} kind   Observed and expected values are shown as code, details as text.
 * @property {string} value         Short text, clipped.
 */

/**
 * @typedef {Object} FindingView
 * @property {string} id
 * @property {string} checkId
 * @property {string} module
 * @property {string} title
 * @property {string} severity      One of `SEVERITIES`.
 * @property {1|2|3} impact
 * @property {1|2|3} effort
 * @property {'confirmed'|'likely'} confidence
 * @property {string|null} url
 * @property {string|null} selector
 * @property {number|null} line
 * @property {{file: string, line: number|null, route: string|null}|null} source  Repo mode: where the fix belongs.
 * @property {EvidencePart[]} evidence
 * @property {string[]} related
 * @property {string|null} target  The link target the finding is about (`evidence.observed.target_url`), when it names one.
 * @property {string} recommendation
 * @property {string} docRef
 * @property {{impressions: number, clicks: number}|null} [traffic]  Imported search data of the finding's page, set by
 *   `prioritize` (report/search.js); null without imported data.
 */

/**
 * The source file of a finding, when the stored value names one.
 * @param {unknown} raw
 * @returns {FindingView['source']}
 */
function viewSource(raw) {
  const source = obj(raw);
  const file = text(source.file);
  if (file === '') return null;
  const line = Number.isInteger(source.line) && /** @type {number} */ (source.line) > 0 ? /** @type {number} */ (source.line) : null;
  return { file: clip(file, EVIDENCE_MAX), line, route: text(source.route) ? clip(text(source.route), EVIDENCE_MAX) : null };
}

/**
 * A finding from a stored run, reduced to the fields the reports show. Whatever
 * the file contains, the result has a known severity, confidence and impact
 * level, strings where strings are expected, and evidence flattened to short text.
 * @param {unknown} raw
 * @returns {FindingView}
 */
export function viewFinding(raw) {
  const f = obj(raw);
  const evidence = obj(f.evidence);
  /** @type {EvidencePart[]} */
  const parts = [];
  for (const [key, label, kind] of /** @type {const} */ ([['observed', 'Observed', 'code'], ['expected', 'Expected', 'code'], ['detail', 'Detail', 'text'], ['limit', 'Limit', 'text']])) {
    const value = evidence[key];
    if (value !== undefined && value !== null && value !== '') parts.push({ label, kind, value: evidenceText(value) });
  }
  const url = str(f.url);
  const observed = obj(evidence.observed);
  return {
    id: str(f.id),
    checkId: str(f.check_id),
    module: str(f.module),
    title: text(f.title),
    severity: severityOf(f.severity),
    impact: levelOf(f.impact),
    effort: levelOf(f.effort),
    confidence: f.confidence === 'confirmed' ? 'confirmed' : 'likely',
    url: url === '' ? null : url,
    selector: text(f.selector) || null,
    line: Number.isInteger(f.line) ? /** @type {number} */ (f.line) : null,
    source: viewSource(f.source),
    evidence: parts,
    related: (Array.isArray(f.related_urls) ? /** @type {unknown[]} */ (f.related_urls) : []).filter((u) => typeof u === 'string'),
    target: typeof observed.target_url === 'string' && observed.target_url !== '' ? clip(observed.target_url, EVIDENCE_MAX) : null,
    recommendation: text(f.recommendation),
    docRef: str(f.doc_ref),
  };
}

/**
 * Order: severity, then impact (high first), then effort (low first), then check id.
 * @param {{severity: string, impact: number, effort: number, checkId: string}} a
 * @param {{severity: string, impact: number, effort: number, checkId: string}} b
 */
function compareGroups(a, b) {
  return (
    SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
    b.impact - a.impact ||
    a.effort - b.effort ||
    compareText(a.checkId, b.checkId)
  );
}

/**
 * What the owner fixes for a finding of the links module: the link target, or
 * the link itself (its selector) when the evidence names no target. A link in
 * a menu or footer is one fix however many pages repeat it.
 * @param {FindingView} finding
 * @returns {string}
 */
function fixKey(finding) {
  return finding.target ?? finding.selector ?? finding.url ?? finding.id;
}

/**
 * How many distinct links a group of the links module is about, and on how
 * many pages, or null for other modules, whose findings are each a fix of
 * their own page.
 * @param {FindingView[]} list
 * @returns {{links: number, pages: number}|null}
 */
function distinctLinks(list) {
  if (list[0]?.module !== 'links') return null;
  return { links: new Set(list.map(fixKey)).size, pages: new Set(list.map((finding) => finding.url)).size };
}

/**
 * "66 findings (3 links on 22 pages)": the count of findings, with what the
 * owner has to fix when that is fewer.
 * @param {{count: number, distinct: {links: number, pages: number}|null}} group
 * @returns {string}
 */
export function affectedText(group) {
  const findings = `${group.count} finding${group.count === 1 ? '' : 's'}`;
  const { distinct } = group;
  if (distinct === null || distinct.links >= group.count) return findings;
  return `${findings} (${distinct.links} link${distinct.links === 1 ? '' : 's'} on ${distinct.pages} page${distinct.pages === 1 ? '' : 's'})`;
}

/**
 * The confidence of a group in words: "Likely" when every finding is likely,
 * "Confirmed" when every one is confirmed, and for a group with both (a check
 * whose temporary redirects are likely) how many are likely.
 * @param {{confidence: string, count: number, likely: number}} group
 * @returns {string}
 */
export function confidenceText(group) {
  if (group.likely === 0 || group.likely === group.count) return group.confidence === 'confirmed' ? 'Confirmed' : 'Likely';
  return `Likely for ${group.likely} of ${group.count} findings, confirmed for the rest`;
}

/**
 * One group per check, in report order (severity, impact, effort, check id),
 * each with its findings sorted by URL and selector, for the links module the
 * number of distinct links and pages (`distinct`), and the number of likely
 * findings (`likely`). A group's confidence is likely when any finding is.
 * @param {FindingView[]} findings
 */
export function groupByCheck(findings) {
  /** @type {Map<string, FindingView[]>} */
  const byCheck = new Map();
  for (const finding of findings) {
    const list = byCheck.get(finding.checkId);
    if (list) list.push(finding);
    else byCheck.set(finding.checkId, [finding]);
  }
  return [...byCheck.values()].map((list) => {
    list.sort((a, b) => compareText(a.url ?? '', b.url ?? '') || compareText(a.selector ?? '', b.selector ?? '') || compareText(a.id, b.id));
    const [first] = list;
    const likely = list.filter((finding) => finding.confidence === 'likely').length;
    return {
      ...first, title: first.title || first.checkId, findings: list, count: list.length, distinct: distinctLinks(list),
      likely, confidence: /** @type {'confirmed'|'likely'} */ (likely > 0 ? 'likely' : 'confirmed'),
    };
  }).sort(compareGroups);
}

/**
 * Add what the reports display per group: up to three distinct example URLs,
 * the first `maxUrls` findings, and how many findings are left out. In a group
 * of the links module, one finding per distinct link comes first, so the
 * shown findings name every link before they repeat one.
 * @template {ReturnType<typeof groupByCheck>[number]} G
 * @param {G[]} groups
 * @param {number} maxUrls
 */
export function withLimits(groups, maxUrls) {
  return groups.map((group) => {
    const urls = [...new Set(group.findings.map((f) => f.url).filter((u) => u !== null))];
    /** @type {Set<string>} */
    const seen = new Set();
    const firsts = group.distinct === null ? [] : group.findings.filter((finding) => !seen.has(fixKey(finding)) && seen.add(fixKey(finding)));
    const ordered = firsts.length === 0 ? group.findings : [...firsts, ...group.findings.filter((finding) => !firsts.includes(finding))];
    const shown = ordered.slice(0, maxUrls);
    return { ...group, examples: urls.slice(0, EXAMPLE_URLS), shown, more: group.count - shown.length };
  });
}

/**
 * Findings that resolved or appeared between two runs, counted per check, with
 * at most ten checks listed and the rest counted in `more`.
 * @param {FindingView[]} findings
 */
export function changeList(findings) {
  const groups = groupByCheck(findings).map(({ checkId, title, severity, count }) => ({ checkId, title, severity, count }));
  return { items: groups.slice(0, CHANGE_GROUPS), more: Math.max(0, groups.length - CHANGE_GROUPS), total: findings.length };
}

