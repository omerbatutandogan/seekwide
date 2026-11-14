/** @import { Run } from '../types.js' */

import { clip } from '../util/strings.js';
import { CONFIDENCE_NOTE, FIXES_NOTE, FIX_OUTCOME_LABELS, RATING_LABELS, SCORE_NOTE, SEVERITY_LABELS, SUGGESTIONS_NOTE, SUMMARY_NOTE } from './copy.js';
import { html, raw, safeHttpUrl } from './escape.js';
import { plural } from './facts.js';
import { affectedText, confidenceText } from './findings.js';
import { CSS } from './html-css.js';
import { buildReport } from './model.js';
import { trafficText } from './search.js';

/** @typedef {ReturnType<typeof buildReport>} Report */

const CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'";

/**
 * A URL as a link when it is http or https, and as plain text otherwise.
 * @param {string} url
 */
function urlHtml(url) {
  const href = safeHttpUrl(url);
  const label = clip(url, 300);
  return href === null ? html`<span class="u">${label}</span>` : html`<a class="u" href="${href}" rel="noopener noreferrer nofollow">${label}</a>`;
}

/** @param {string} severity */
const sevLabel = (severity) => SEVERITY_LABELS[/** @type {keyof typeof SEVERITY_LABELS} */ (severity)];


/** @param {number|null} value */
const scoreText = (value) => (value === null ? 'n/a' : String(value));

/** @param {Report} r */
function titleBlock(r) {
  return html`<header class="top">
${r.logo || r.brand ? html`<div class="brand">${r.logo ? html`<img src="${r.logo}" alt="${r.brand}">` : ''}${r.brand ? html`<span>Prepared by ${r.brand}</span>` : ''}</div>` : ''}
<h1>${r.title}</h1>
<p class="sub">${urlHtml(r.startUrl)} &middot; ${r.date.long}</p>
</header>`;
}

/** @param {Report} r */
function summary(r) {
  return html`<section id="summary"><h2>Summary</h2>
${r.summary.written ? html`<p class="note">${SUMMARY_NOTE}</p>` : ''}
${r.summary.paragraphs.map((p) => html`<p>${p}</p>`)}
<p class="cap">Measured in this run</p>
<div class="figs">${r.figures.map((f) => html`<div class="fig"><b>${f.value}</b><span>${f.label}</span></div>`)}</div>
</section>`;
}

/** @param {Report} r */
function scope(r) {
  return html`<section id="scope"><h2>Scope and limits</h2>
<dl>${r.scope.map((row) => html`<dt>${row.label}</dt><dd>${row.code ? html`<code>${row.value}</code>` : row.value}</dd>`)}</dl>
</section>`;
}

/** @param {Report} r */
function fixes(r) {
  const f = r.fixes;
  if (f === null) return '';
  const rows = f.rows.map((row) => html`<tr><td><strong>${FIX_OUTCOME_LABELS[row.outcome]}</strong></td><td>${row.title} (<code>${row.checkId}</code>)</td><td>${row.url === null ? 'Whole site' : urlHtml(row.url)}</td><td>${row.file === null ? '—' : html`<code>${row.file}</code>`}</td><td>${row.detail}${row.replacedBy.length > 0 ? html` Now reported: ${row.replacedBy.join('; ')}.` : ''}</td></tr>`);
  return html`<section id="fixes"><h2>Fixes verified in this run</h2>
<p>${f.summary} Compared with run <code>${f.baseRunId}</code>.</p>
<p class="note">${FIXES_NOTE}</p>
<table><thead><tr><th>Result</th><th>Finding</th><th>Page</th><th>Source file</th><th>What the re-audit found</th></tr></thead><tbody>${rows}</tbody></table>
${f.more > 0 ? html`<p>+${f.more} more not shown.</p>` : ''}
${f.notes.length > 0 ? html`<div class="warn"><strong>Caveats</strong><ul>${f.notes.map((note) => html`<li>${note}</li>`)}</ul></div>` : ''}
</section>`;
}

/** @param {Report} r */
function layers(r) {
  return html`<section id="layers"><h2>Status by layer</h2>
<div class="layers">${r.layers.map((layer) => html`<div class="layer${layer.measured ? ' on' : ''}">
<h3>${layer.name}</h3><span class="pill">${layer.status}</span>
<p>${layer.text}</p>${layer.detail === null ? '' : html`<p class="src">${layer.detail}</p>`}
</div>`)}</div>
</section>`;
}

/** @param {Report} r */
function scores(r) {
  const body =
    r.scores.length === 0
      ? html`<p>No module was scored.</p>`
      : html`<table><thead><tr><th>Module</th><th>Result</th><th class="n">Coverage</th><th class="n">Checks run</th></tr></thead><tbody>
${r.scores.map((s) => html`<tr><td>${s.label}</td>${s.counted !== null ? html`<td>${s.counted}</td>` : s.score === null ? (s.note ? html`<td class="nt">${s.note}</td>` : html`<td>n/a</td>`) : html`<td><b>${s.score}</b> / 100<span class="bar"><i style="width:${s.score}%"></i></span></td>`}<td class="n">${Math.round(s.coverage * 100)}%</td><td class="n">${s.checksRun} of ${s.checksTotal}${s.checksSkipped > 0 ? ` (${s.checksSkipped} skipped)` : ''}</td></tr>`)}
</tbody></table><p class="meta">${SCORE_NOTE}</p>`;
  return html`<section id="scores"><h2>Scores</h2>${body}</section>`;
}

/** @param {Report} r */
function vitals(r) {
  const v = r.vitals;
  if (v === null) return '';
  const rows = v.rows.map((row) => html`<tr><td>${row.url === null ? row.label : urlHtml(row.url)}<br><span class="meta">${row.why}</span></td>${row.cells.map((cell) =>
    cell === null ? html`<td class="n">&mdash;</td>` : html`<td class="n">${cell.value}<br><span class="rt rt-${cell.rating === 'needs improvement' ? 'mid' : cell.rating}">${RATING_LABELS[cell.rating]}</span></td>`)}</tr>`);
  return html`<section id="core-web-vitals"><h2>Core Web Vitals</h2>
<dl>${v.sources.map((source) => html`<dt>${source.label}</dt><dd>${source.value}</dd>`)}</dl>
${rows.length > 0 ? html`<table class="cwv"><thead><tr><th>Page</th>${v.columns.map((label) => html`<th class="n">${label}</th>`)}</tr></thead><tbody>${rows}</tbody></table><p class="meta">${v.legend}</p>` : ''}
${v.notes.length > 0 ? html`<ul class="meta">${v.notes.map((note) => html`<li>${note}</li>`)}</ul>` : ''}
</section>`;
}

/** @param {Report} r */
function aiSection(r) {
  const a = r.ai;
  if (a === null) return '';
  const rows = a.matrix.map((row) => html`<tr><td><code>${row.token}</code>${row.counted ? ' (counted)' : ''}</td><td>${row.vendor}</td><td>${row.role}</td><td><strong>${row.access}</strong></td><td>${row.robots}</td><td>${row.source === null ? '—' : html`${urlHtml(row.source)}<br><span class="meta">${row.verified}</span>`}</td></tr>`);
  return html`<section id="ai-readiness"><h2>AI search readiness</h2>
<p class="note">${a.statements[1]}</p>
${a.counts.length > 0 ? html`<div class="figs">${a.counts.map((count) => html`<div class="fig"><b>${count.value}</b><span>${count.label}</span></div>`)}</div>` : ''}
<dl><dt>Stated AI policy</dt><dd>${a.policy}</dd><dt>Training preference</dt><dd>${a.training}</dd><dt>llms.txt</dt><dd>${a.llms}</dd></dl>
${rows.length > 0 ? html`<table><thead><tr><th>Crawler</th><th>Vendor</th><th>Purpose</th><th>robots.txt</th><th>Vendor says</th><th>Source (verified)</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
${a.statements.filter((_, i) => i !== 1).map((statement) => html`<p class="meta">${statement}</p>`)}
<p class="meta">Crawler data verified ${a.dataDate}.</p>
<div class="warn"><strong>Check by hand</strong> (an audit from outside cannot see these)<ul>${a.manual.map((item) => html`<li>${item}</li>`)}</ul></div>
</section>`;
}

/** @param {Report} r */
function search(r) {
  const s = r.search;
  if (s === null) return '';
  const sources = s.sources.map((source) => html`<h3>${source.name}</h3>
<dl><dt>Report</dt><dd>${source.report}, from the file <code>${source.file}</code>, imported on ${source.imported}.</dd>
<dt>Period</dt><dd>${source.periodText}</dd>
${source.filters.length > 0 ? html`<dt>Filters stated in the export</dt><dd>${source.filters.map((f, i) => html`${i > 0 ? '; ' : ''}${f.name}: ${f.value}`)}</dd>` : ''}
<dt>Matched with this audit</dt><dd>${source.matchText}</dd></dl>
<div class="figs">${source.figures.map((f) => html`<div class="fig"><b>${f.value}</b><span>${f.label}</span></div>`)}</div>
<p class="meta">${source.totalsNote}</p>
<table><thead><tr><th>Page</th><th class="n">Clicks</th><th class="n">Impressions</th><th class="n">CTR</th><th class="n">Position</th><th class="n">Findings in this audit</th></tr></thead><tbody>${source.topPages.map((page) => html`<tr><td>${urlHtml(page.url)}</td><td class="n">${page.clicks}</td><td class="n">${page.impressions}</td><td class="n">${page.ctr}</td><td class="n">${page.position}</td><td class="n">${page.findings}</td></tr>`)}</tbody></table>
${source.notes.length > 0 ? html`<ul class="meta">${source.notes.map((note) => html`<li>${note}</li>`)}</ul>` : ''}`);
  return html`<section id="search-performance"><h2>Search performance (imported)</h2><p class="note">${s.supplied}</p>${sources}<p class="meta">${s.orderNote}</p></section>`;
}

/** @param {Report['groups'][number]} g */
function badges(g) {
  return html`<span class="badge sev-${g.severity}">${sevLabel(g.severity)}</span> <span class="badge ${g.confidence}">${confidenceText(g)}</span>`;
}

/** @param {Report} r */
function topFixes(r) {
  const cards = r.topFixes.map((g, i) => html`<article class="card sev-${g.severity}">
<h3><span class="rank">${i + 1}.</span>${g.title} ${badges(g)}</h3>
<p class="meta"><code>${g.checkId}</code> &middot; ${affectedText(g)}${g.traffic !== null ? html` &middot; Search data: ${trafficText(g.traffic)} on the affected pages` : ''}</p>
${g.recommendation ? html`<p><strong>What to do:</strong> ${g.recommendation}</p>` : ''}
${g.examples.length > 0 ? html`<p class="meta">Examples: ${g.examples.map((url) => html`<br>${urlHtml(url)}`)}</p>` : ''}
${g.docRef ? html`<p class="meta">Documentation: ${urlHtml(g.docRef)}</p>` : ''}
</article>`);
  return html`<section id="top-fixes"><h2>Top fixes</h2>${r.topFixes.length === 0 ? html`<p>No findings. Every check that ran passed.</p>` : html`<p class="note">${CONFIDENCE_NOTE}</p>${cards}`}</section>`;
}

/** @param {Report['groups'][number]['shown'][number]} f */
function findingItem(f) {
  const rows = f.evidence.map((part) => html`<div><span class="k">${part.label}</span>${part.kind === 'code' ? html`<code>${part.value}</code>` : part.value}</div>`);
  const where = [];
  if (f.selector) where.push(html`<span class="k">Selector</span><code>${f.selector}</code>`);
  if (f.line !== null) where.push(html`<span class="k">Line</span>${f.line}`);
  if (where.length > 0) rows.push(html`<div>${where}</div>`);
  if (f.source !== null) {
    const { file, line, route } = f.source;
    rows.push(html`<div><span class="k">Source</span><code>${line === null ? file : `${file}:${line}`}</code>${route === null ? '' : html` <span class="k">Route</span><code>${route}</code>`}</div>`);
  }
  if (f.traffic && f.url !== null && f.traffic.impressions + f.traffic.clicks > 0) rows.push(html`<div><span class="k">Search data</span>${trafficText(f.traffic)}</div>`);
  if (f.related.length > 0) {
    const rest = f.related.length - 3;
    rows.push(html`<div><span class="k">Also</span>${f.related.slice(0, 3).map((url) => html`${urlHtml(url)} `)}${rest > 0 ? `+${rest} more` : ''}</div>`);
  }
  return html`<li><div>${f.url === null ? 'Whole site' : urlHtml(f.url)}</div>${rows.length > 0 ? html`<div class="ev">${rows}</div>` : ''}</li>`;
}

/** @param {Report} r */
function allFindings(r) {
  const cards = r.groups.map((g) => html`<article class="card sev-${g.severity}">
<h3>${g.title} ${badges(g)}</h3>
<p class="meta"><code>${g.checkId}</code> &middot; ${affectedText(g)}</p>
<ul class="items">${g.shown.map(findingItem)}</ul>
${g.more > 0 ? html`<p class="meta">+${g.more} more ${g.more === 1 ? 'finding' : 'findings'} not shown.</p>` : ''}
</article>`);
  return html`<section id="findings"><h2>All findings by check</h2>${r.groups.length === 0 ? html`<p>No findings.</p>` : cards}</section>`;
}

/** @param {Report} r */
function suggestions(r) {
  if (r.recommendations.length === 0) return '';
  return html`<section id="suggestions"><h2>Suggestions (not scored)</h2><p class="note">${SUGGESTIONS_NOTE}</p>
<ol class="recs">${r.recommendations.map((item) => html`<li><h3>${item.title}</h3><p>${item.detail}</p></li>`)}</ol>
</section>`;
}

/** @param {Report} r */
function notRun(r) {
  const body =
    r.notRun.length === 0
      ? html`<p>All checks ran.</p>`
      : html`<table><thead><tr><th>Check</th><th>Status</th><th>Reason</th></tr></thead><tbody>${r.notRun.map((c) => html`<tr><td><code>${c.id}</code></td><td>${c.status === 'error' ? 'Error' : 'Skipped'}</td><td>${c.reason}</td></tr>`)}</tbody></table>`;
  return html`<section id="not-run"><h2>Checks that did not run</h2>${body}</section>`;
}

/**
 * @param {NonNullable<Report['comparison']>['resolved']} list
 * @param {string} heading
 */
function changeList(list, heading) {
  if (list.total === 0) return '';
  return html`<h3>${heading} (${plural(list.total, 'finding')})</h3><ul>${list.items.map((item) => html`<li>${item.title} (<code>${item.checkId}</code>): ${item.count}</li>`)}${list.more > 0 ? html`<li>+${plural(list.more, 'more check')}</li>` : ''}</ul>`;
}

/** @param {Report} r */
function changes(r) {
  const c = r.comparison;
  if (c === null) return '';
  const rows = c.scores.map((s) => html`<tr><td>${s.label}</td><td class="n">${s.fromText ?? scoreText(s.from)}</td><td class="n">${s.toText ?? scoreText(s.to)}</td><td class="n">${s.delta === null ? 'n/a' : `${s.delta > 0 ? '+' : ''}${s.delta}`}</td></tr>`);
  return html`<section id="changes"><h2>Changes since the previous run</h2>
<p>Compared with run <code>${c.baseRunId}</code>.</p>
<div class="figs"><div class="fig"><b>${c.resolved.total}</b><span>Resolved</span></div><div class="fig"><b>${c.added.total}</b><span>New</span></div><div class="fig"><b>${c.persisting}</b><span>Still present</span></div></div>
${rows.length > 0 ? html`<table><thead><tr><th>Module</th><th class="n">Before</th><th class="n">Now</th><th class="n">Change</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
${changeList(c.resolved, 'Resolved')}${changeList(c.added, 'New')}
${c.notes.length > 0 ? html`<div class="warn"><strong>Caveats</strong><ul>${c.notes.map((note) => html`<li>${note}</li>`)}</ul></div>` : ''}
</section>`;
}

/** @param {Report} r */
function method(r) {
  return html`<section id="method"><h2>Method</h2>${r.method.map(({ label, text }) => html`<p><strong>${label}.</strong> ${text}</p>`)}</section>`;
}

/**
 * Render the audit as one self-contained HTML file: inline CSS, no scripts and
 * no external requests (the logo is a data URI), with a print style sheet.
 * Pure: the same arguments always give the same bytes, and dates come from
 * `run.created_at`. Every dynamic string is escaped by the `html` template tag,
 * and only http and https URLs become links.
 * @param {Run} run
 * @param {{
 *   executiveSummary?: string, recommendations?: {title: string, detail: string}[], brandName?: string,
 *   logoDataUri?: string, comparison?: import('../store/compare.js').RunComparison, maxUrlsPerCheck?: number,
 * }} [options]
 * @returns {string}
 */
export function renderHtml(run, options) {
  const r = buildReport(run, options);
  const page = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="${raw(CSP)}">
<title>${r.title}: ${r.host}</title>
<style>${raw(CSS)}</style>
</head>
<body>
<main>
${titleBlock(r)}${summary(r)}${scope(r)}${fixes(r)}${layers(r)}${scores(r)}${vitals(r)}${search(r)}${aiSection(r)}${topFixes(r)}${allFindings(r)}${suggestions(r)}${notRun(r)}${changes(r)}${method(r)}
<footer>Seekwide ${r.pluginVersion} &middot; rules ${r.rulesVersion} &middot; run <code>${r.runId}</code> &middot; ${r.date.iso}</footer>
</main>
</body>
</html>
`;
  return page.toString();
}
