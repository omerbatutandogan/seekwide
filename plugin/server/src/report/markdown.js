/** @import { Run } from '../types.js' */

import { CONFIDENCE_NOTE, FIXES_NOTE, FIX_OUTCOME_LABELS, RATING_LABELS, SCORE_NOTE, SEVERITY_LABELS, SUGGESTIONS_NOTE, SUMMARY_NOTE } from './copy.js';
import { mdCode, mdText, mdUrl } from './escape.js';
import { plural } from './facts.js';
import { affectedText, confidenceText } from './findings.js';
import { buildReport } from './model.js';

/** @typedef {ReturnType<typeof buildReport>} Report */

/**
 * @param {string[]} header
 * @param {string[][]} rows Cells that are already Markdown-safe.
 * @returns {string[]}
 */
function table(header, rows) {
  return [`| ${header.join(' | ')} |`, `|${header.map(() => '---').join('|')}|`, ...rows.map((row) => `| ${row.join(' | ')} |`)];
}

/** @param {string} severity */
const severity = (severity) => SEVERITY_LABELS[/** @type {keyof typeof SEVERITY_LABELS} */ (severity)];


/**
 * @param {number|null} value
 * @returns {string}
 */
const scoreText = (value) => (value === null ? 'n/a' : String(value));

/**
 * @param {Report['groups'][number]['shown'][number]} finding
 * @returns {string}
 */
function evidenceCell(finding) {
  const parts = finding.evidence.map((part) => `${part.label}: ${part.kind === 'code' ? mdCode(part.value, true) : mdText(part.value)}`);
  if (finding.selector) parts.push(`Selector: ${mdCode(finding.selector, true)}`);
  if (finding.line !== null) parts.push(`Line ${finding.line}`);
  if (finding.source !== null) {
    const { file, line, route } = finding.source;
    parts.push(`Source: ${mdCode(line === null ? file : `${file}:${line}`, true)}${route === null ? '' : ` (route ${mdCode(route, true)})`}`);
  }
  if (finding.related.length > 0) {
    const shown = finding.related.slice(0, 3).map((url) => mdUrl(url, true));
    const rest = finding.related.length - shown.length;
    parts.push(`Also: ${shown.join(' ')}${rest > 0 ? ` +${rest} more` : ''}`);
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** @param {Report} r */
function header(r) {
  const lines = [`# ${mdText(r.title)}`, '', `- **Site:** ${mdUrl(r.startUrl)}`, `- **Date:** ${mdText(r.date.long)}`];
  if (r.brand) lines.push(`- **Prepared by:** ${mdText(r.brand)}`);
  lines.push(`- **Run:** ${mdCode(r.runId)}`, '');
  return lines;
}

/** @param {Report} r */
function summary(r) {
  const lines = ['## Summary', ''];
  if (r.summary.written) lines.push(`*${mdText(SUMMARY_NOTE)}*`, '');
  for (const paragraph of r.summary.paragraphs) lines.push(mdText(paragraph), '');
  lines.push(`**Measured:** ${r.figures.map((f) => `${mdText(f.label)}: ${mdText(f.value)}`).join(' · ')}`, '');
  return lines;
}

/** @param {Report} r */
function scope(r) {
  return ['## Scope and limits', '', ...r.scope.map((row) => `- **${mdText(row.label)}:** ${mdText(row.value)}`), ''];
}

/** @param {Report} r */
function fixes(r) {
  const f = r.fixes;
  if (f === null) return [];
  const lines = ['## Fixes verified in this run', '', `${mdText(f.summary)} Compared with run ${mdCode(f.baseRunId)}.`, '', `*${mdText(FIXES_NOTE)}*`, ''];
  const rows = f.rows.map((row) => [
    `**${FIX_OUTCOME_LABELS[row.outcome]}**`,
    `${mdText(row.title)} (${mdCode(row.checkId, true)})`,
    row.url === null ? 'Whole site' : mdUrl(row.url, true),
    row.file === null ? '—' : mdCode(row.file, true),
    mdText(row.replacedBy.length > 0 ? `${row.detail} Now reported: ${row.replacedBy.join('; ')}.` : row.detail),
  ]);
  lines.push(...table(['Result', 'Finding', 'Page', 'Source file', 'What the re-audit found'], rows), '');
  if (f.more > 0) lines.push(`+${f.more} more not shown.`, '');
  if (f.notes.length > 0) lines.push('**Caveats**', '', ...f.notes.map((note) => `- ${mdText(note)}`), '');
  return lines;
}

/** @param {Report} r */
function layers(r) {
  const rows = r.layers.map((layer) => [
    mdText(layer.name),
    layer.measured ? mdText(layer.status) : `**${mdText(layer.status)}**`,
    mdText(layer.detail === null ? layer.text : `${layer.text} ${layer.detail}`),
  ]);
  return ['## Status by layer', '', ...table(['Layer', 'Status', 'What it covers'], rows), ''];
}

/** @param {Report} r */
function scores(r) {
  const lines = ['## Scores', ''];
  if (r.scores.length === 0) return [...lines, 'No module was scored.', ''];
  const rows = r.scores.map((s) => [
    mdText(s.label),
    s.counted !== null ? mdText(s.counted) : s.score === null ? (s.note ? mdText(s.note) : 'n/a') : `${s.score} / 100`,
    `${Math.round(s.coverage * 100)}%`,
    `${s.checksRun} of ${s.checksTotal}${s.checksSkipped > 0 ? ` (${s.checksSkipped} skipped)` : ''}`,
  ]);
  return [...lines, ...table(['Module', 'Result', 'Coverage', 'Checks run'], rows), '', `*${mdText(SCORE_NOTE)}*`, ''];
}

/** @param {Report} r */
function vitals(r) {
  const v = r.vitals;
  if (v === null) return [];
  const lines = ['## Core Web Vitals', '', ...v.sources.map((source) => `- **${mdText(source.label)}:** ${mdText(source.value)}`), ''];
  if (v.rows.length > 0) {
    const rows = v.rows.map((row) => [
      row.url === null ? mdText(row.label ?? '') : mdUrl(row.url, true),
      mdText(row.why),
      // A value is formatted from a number by this plugin, so it holds nothing Markdown could read as markup.
      ...row.cells.map((cell) => (cell === null ? '—' : `${cell.value} (${RATING_LABELS[cell.rating].toLowerCase()})`)),
    ]);
    lines.push(...table(['Page', 'Why it was measured', ...v.columns], rows), '', `*${mdText(v.legend)}*`, '');
  }
  if (v.notes.length > 0) lines.push(...v.notes.map((note) => `- ${mdText(note)}`), '');
  return lines;
}

/** @param {Report} r */
function topFixes(r) {
  const lines = ['## Top fixes', ''];
  if (r.topFixes.length === 0) return [...lines, 'No findings. Every check that ran passed.', ''];
  lines.push(`*${mdText(CONFIDENCE_NOTE)}*`, '');
  r.topFixes.forEach((group, index) => {
    lines.push(`### ${index + 1}. ${mdText(group.title)} (${severity(group.severity)})`, '');
    lines.push(`- **Check:** ${mdCode(group.checkId)}`);
    lines.push(`- **Affected:** ${affectedText(group)} · **Confidence:** ${confidenceText(group)}`);
    if (group.recommendation) lines.push(`- **What to do:** ${mdText(group.recommendation)}`);
    if (group.examples.length > 0) lines.push(`- **Examples:** ${group.examples.map((url) => mdUrl(url)).join(' ')}`);
    if (group.docRef) lines.push(`- **Documentation:** ${mdUrl(group.docRef)}`);
    lines.push('');
  });
  return lines;
}

/** @param {Report} r */
function allFindings(r) {
  const lines = ['## All findings by check', ''];
  if (r.groups.length === 0) return [...lines, 'No findings.', ''];
  for (const group of r.groups) {
    lines.push(`### ${mdText(group.title)} (${mdCode(group.checkId)})`, '');
    lines.push(`${severity(group.severity)} · ${confidenceText(group)} · ${affectedText(group)}`, '');
    const rows = group.shown.map((f) => [f.url === null ? 'Whole site' : mdUrl(f.url, true), evidenceCell(f)]);
    lines.push(...table(['URL', 'Evidence'], rows), '');
    if (group.more > 0) lines.push(`+${group.more} more ${group.more === 1 ? 'finding' : 'findings'} not shown.`, '');
  }
  return lines;
}

/** @param {Report} r */
function suggestions(r) {
  if (r.recommendations.length === 0) return [];
  const lines = ['## Suggestions (not scored)', '', `*${mdText(SUGGESTIONS_NOTE)}*`, ''];
  r.recommendations.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${mdText(item.title)}`, '', mdText(item.detail), '');
  });
  return lines;
}

/** @param {Report} r */
function notRun(r) {
  const lines = ['## Checks that did not run', ''];
  if (r.notRun.length === 0) return [...lines, 'All checks ran.', ''];
  const rows = r.notRun.map((c) => [mdCode(c.id, true), c.status === 'error' ? 'Error' : 'Skipped', mdText(c.reason)]);
  return [...lines, ...table(['Check', 'Status', 'Reason'], rows), ''];
}

/**
 * @param {NonNullable<Report['comparison']>} changes
 * @param {'resolved'|'added'} key
 * @param {string} heading
 */
function changeSection(changes, key, heading) {
  const list = changes[key];
  if (list.total === 0) return [];
  const lines = [`**${heading}** (${plural(list.total, 'finding')})`, ''];
  for (const item of list.items) lines.push(`- ${mdText(item.title)} (${mdCode(item.checkId)}): ${item.count}`);
  if (list.more > 0) lines.push(`- +${plural(list.more, 'more check')}`);
  return [...lines, ''];
}

/** @param {Report} r */
function changes(r) {
  const c = r.comparison;
  if (c === null) return [];
  const lines = ['## Changes since the previous run', '', `Compared with run ${mdCode(c.baseRunId)}.`, ''];
  lines.push(`- **Resolved:** ${plural(c.resolved.total, 'finding')}`, `- **New:** ${plural(c.added.total, 'finding')}`, `- **Still present:** ${c.persisting}`, '');
  if (c.scores.length > 0) {
    const rows = c.scores.map((s) => [mdText(s.label), mdText(s.fromText ?? scoreText(s.from)), mdText(s.toText ?? scoreText(s.to)), s.delta === null ? 'n/a' : `${s.delta > 0 ? '+' : ''}${s.delta}`]);
    lines.push(...table(['Module', 'Before', 'Now', 'Change'], rows), '');
  }
  lines.push(...changeSection(c, 'resolved', 'Resolved'), ...changeSection(c, 'added', 'New'));
  if (c.notes.length > 0) lines.push('**Caveats**', '', ...c.notes.map((note) => `- ${mdText(note)}`), '');
  return lines;
}

/** @param {Report} r */
function method(r) {
  return ['## Method', '', ...r.method.flatMap(({ label, text }) => [`**${mdText(label)}.** ${mdText(text)}`, ''])];
}

/**
 * Render the audit as Markdown. Pure: the same arguments always give the same
 * text, and dates come from `run.created_at`. Everything that came from the
 * audited site is escaped or placed in code spans, so evidence containing
 * pipes, backticks, newlines or HTML cannot break tables or inject markup.
 * @param {Run} run
 * @param {{
 *   executiveSummary?: string, recommendations?: {title: string, detail: string}[], brandName?: string,
 *   logoDataUri?: string, comparison?: import('../store/compare.js').RunComparison, maxUrlsPerCheck?: number,
 * }} [options] `logoDataUri` is accepted and ignored: Markdown has no embedded logo.
 * @returns {string}
 */
export function renderMarkdown(run, options) {
  const r = buildReport(run, options);
  const lines = [
    ...header(r), ...summary(r), ...scope(r), ...fixes(r), ...layers(r), ...scores(r), ...vitals(r), ...topFixes(r),
    ...allFindings(r), ...suggestions(r), ...notRun(r), ...changes(r), ...method(r),
  ];
  return `${lines.join('\n').trimEnd()}\n`;
}
