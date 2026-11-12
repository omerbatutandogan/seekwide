/** @import { Run } from '../types.js' */
/** @import { RunComparison } from '../store/compare.js' */

import { MODULES, SEVERITIES } from '../config.js';
import { clip, collapseWhitespace } from '../util/strings.js';
import { ROBOTS_STATUS, methodSections, reportTitle } from './copy.js';
import { changeList, groupByCheck, viewFinding, withLimits } from './findings.js';
import { viewFixes } from './fixes.js';
import { describeBlock, describeUnreadable, factualSummary, moduleLabel, plural } from './facts.js';
import { compareText, num, obj, str, text } from './values.js';
import { describeVitals, viewLayers, viewVitals } from './vitals.js';

const DEFAULT_MAX_URLS = 10;
const TOP_FIX_GROUPS = 10;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const LOGO = /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/;

/**
 * @param {string} iso
 * @returns {{long: string, iso: string}}
 */
function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { long: clip(iso, 40), iso: clip(iso, 40) };
  return { long: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`, iso: date.toISOString().slice(0, 10) };
}

/**
 * Check and normalize the options. Throws `TypeError` for a value that cannot
 * be rendered faithfully, so a caller mistake is never hidden in a report.
 * @param {Run} run
 * @param {object} options
 */
function readOptions(run, options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('The report options must be an object.');
  const o = obj(options);
  if (o.brandName !== undefined && typeof o.brandName !== 'string') throw new TypeError('brandName must be a string.');
  const maxUrls = o.maxUrlsPerCheck ?? DEFAULT_MAX_URLS;
  if (!Number.isInteger(maxUrls) || /** @type {number} */ (maxUrls) < 1) throw new TypeError('maxUrlsPerCheck must be a positive integer.');
  if (o.executiveSummary !== undefined && typeof o.executiveSummary !== 'string') throw new TypeError('executiveSummary must be a string.');
  if (o.logoDataUri !== undefined && !(typeof o.logoDataUri === 'string' && LOGO.test(o.logoDataUri))) {
    throw new TypeError('logoDataUri must be a base64 data URI of a PNG, JPEG, WebP or SVG image.');
  }
  const recommendations = o.recommendations ?? [];
  if (!Array.isArray(recommendations)) throw new TypeError('recommendations must be an array of {title, detail}.');
  const comparison = o.comparison ?? null;
  if (comparison !== null && obj(comparison).run_id !== run.run_id) {
    throw new TypeError(`The comparison belongs to run ${String(obj(comparison).run_id)}, not to run ${run.run_id}.`);
  }
  return {
    maxUrls: /** @type {number} */ (maxUrls),
    summary: str(o.executiveSummary).trim(),
    logo: /** @type {string|undefined} */ (o.logoDataUri),
    brand: text(o.brandName).slice(0, 200),
    comparison: /** @type {RunComparison|null} */ (comparison),
    recommendations: recommendations.map((item, index) => {
      const entry = obj(item);
      const title = text(entry.title);
      const detail = str(entry.detail).trim();
      if (!title || !detail) throw new TypeError(`recommendations[${index}] needs a non-empty title and detail.`);
      return { title, detail };
    }),
  };
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
const roundedOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null);

/**
 * Module keys in the order the plugin lists them, then any others alphabetically.
 * @param {string[]} names
 * @returns {string[]}
 */
function orderModules(names) {
  const rank = (/** @type {string} */ name) => (MODULES.includes(name) ? MODULES.indexOf(name) : MODULES.length);
  return [...names].sort((a, b) => rank(a) - rank(b) || compareText(a, b));
}

/**
 * @param {RunComparison} comparison
 */
function viewComparison(comparison) {
  const scores = obj(comparison.scores);
  const list = (/** @type {unknown} */ value) => (Array.isArray(value) ? value : []);
  return {
    baseRunId: str(comparison.base_run_id),
    runId: str(comparison.run_id),
    persisting: num(comparison.persisting),
    resolved: changeList(list(comparison.resolved).map(viewFinding)),
    added: changeList(list(comparison.added).map(viewFinding)),
    scores: orderModules(Object.keys(scores)).map((name) => {
      const entry = obj(scores[name]);
      return { label: moduleLabel(name), from: roundedOrNull(entry.from), to: roundedOrNull(entry.to), delta: roundedOrNull(entry.delta) };
    }),
    notes: list(comparison.notes).filter((note) => typeof note === 'string').map((note) => clip(note, 600)),
  };
}

/**
 * @param {Run} run
 */
function viewScores(run) {
  const modules = obj(run.modules);
  return orderModules(Object.keys(modules)).map((name) => {
    const m = obj(modules[name]);
    const score = typeof m.score === 'number' && Number.isFinite(m.score) ? Math.min(100, Math.max(0, Math.round(m.score))) : null;
    return {
      module: name,
      label: moduleLabel(name),
      score,
      coverage: Math.min(1, Math.max(0, num(m.coverage))),
      checksRun: num(m.checks_run),
      checksTotal: num(m.checks_total),
      checksSkipped: num(m.checks_skipped),
      // Why there is no score. Runs stored before the note existed have none.
      note: score === null ? text(m.note) || null : null,
    };
  });
}

/**
 * Pages the crawler was refused on. Runs stored before this was counted have none.
 * @param {Run} run
 * @returns {number}
 */
function unreadablePages(run) {
  return Math.max(0, Math.floor(num(obj(run.crawl).unreadable_pages)));
}

const REPO_FRAMEWORKS = ['next-app', 'html'];

/**
 * The scope row on source files, or null when the run was not a repo-mode audit.
 * @param {Run} run
 * @param {number} findings
 * @returns {{label: string, value: string, code?: boolean}|null}
 */
function viewRepo(run, findings) {
  if (run.repo === null || typeof run.repo !== 'object' || Array.isArray(run.repo)) return null;
  const repo = obj(run.repo);
  const label = text(repo.label, 'Unnamed').slice(0, 80);
  if (!REPO_FRAMEWORKS.includes(str(repo.framework))) {
    return { label: 'Source files', value: `Not named. The project in this folder (${label}) is not supported for source mapping yet.` };
  }
  const dir = text(repo.source_dir);
  const where = dir === '' || dir === '.' ? '' : ` in ${clip(dir, 200)}`;
  const named = Math.min(findings, Math.max(0, Math.floor(num(repo.findings_with_source))));
  const deployed = text(repo.deployed_origin);
  return {
    label: 'Source files',
    value: `${label} project${where}. ${named} of ${plural(findings, 'finding')} ${findings === 1 ? 'names' : 'name'} the source file ${findings === 1 ? 'it comes' : 'they come'} from. Paths are relative to the project folder.` +
      (deployed === '' ? '' : num(repo.deployed_localized) > 0
        ? ` Canonical links, links and sitemap entries that name the deployed address (${clip(deployed, 200)}) were read as pages of the local server.`
        : ` The deployed address given for this audit (${clip(deployed, 200)}) matched no canonical link, link or sitemap entry of the pages, so none was read as a page of the local server.`),
  };
}

/**
 * @param {Run} run
 * @param {{host: string, blocked: ReturnType<typeof viewBlock>}} derived
 */
function viewScope(run, { host, blocked }) {
  const crawl = obj(run.crawl);
  const pages = num(crawl.pages_crawled);
  const sitemapUrls = num(crawl.sitemap_urls);
  const robots = str(crawl.robots_status);
  const unreadable = unreadablePages(run);
  const repo = viewRepo(run, Array.isArray(run.findings) ? run.findings.length : 0);
  const modules = Array.isArray(run.modules_requested) ? orderModules(run.modules_requested.filter((m) => typeof m === 'string')).map(moduleLabel) : [];
  return [
    { label: 'Pages crawled', value: `${pages} of ${plural(num(crawl.max_pages), 'page')} allowed (${num(crawl.html_pages)} HTML, ${num(crawl.indexable_pages)} indexable)` },
    crawl.time_limit_reached === true
      ? { label: 'Time limit reached', value: 'Yes. The crawl stopped at its time limit before every URL it found was visited, so the findings describe the pages crawled only.' }
      : {
        label: 'Page limit reached',
        value: crawl.truncated === true
          ? 'Yes. The crawl stopped before every URL it found was visited, so the findings describe the pages crawled only.'
          : 'No. The crawl ran out of URLs before it ran out of budget.',
      },
    { label: 'Blocked', value: blocked ? describeBlock(blocked) : 'No.' },
    ...(unreadable > 0 ? [{ label: 'Pages not read', value: describeUnreadable(unreadable) }] : []),
    { label: 'robots.txt', value: Object.hasOwn(ROBOTS_STATUS, robots) ? ROBOTS_STATUS[/** @type {keyof typeof ROBOTS_STATUS} */ (robots)] : text(robots, 'Unknown.') },
    { label: 'Sitemap', value: sitemapUrls > 0 ? `${plural(sitemapUrls, 'URL')} listed in XML sitemaps.` : 'No URLs found in XML sitemaps.' },
    { label: 'Modules', value: modules.length > 0 ? modules.join(', ') : 'None recorded.' },
    ...(repo ? [repo] : []),
    { label: 'User agent', value: text(crawl.user_agent, 'Not recorded.'), code: true },
  ];
}

/**
 * @param {unknown} raw
 * @returns {{reason: string, url: string, status: number}|null}
 */
function viewBlock(raw) {
  if (!raw) return null;
  const block = obj(raw);
  return { reason: str(block.reason), url: str(block.url), status: num(block.status) };
}

/**
 * Build the format-neutral content of the report. Both renderers display this
 * same structure, so Markdown and HTML always agree. Pure: depends only on its
 * arguments, and dates come from `run.created_at`.
 * @param {Run} run
 * @param {object} [options] Same options as `renderMarkdown`.
 */
export function buildReport(run, options = {}) {
  if (run === null || typeof run !== 'object' || !Array.isArray(run.findings) || !Array.isArray(run.checks)) {
    throw new TypeError('A report needs a Run with `findings` and `checks` arrays.');
  }
  const opts = readOptions(run, options);
  const crawl = obj(run.crawl);
  const findings = run.findings.map(viewFinding);
  const groups = withLimits(groupByCheck(findings), opts.maxUrls);
  const severityCounts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));
  const checksRun = run.checks.filter((check) => check.status === 'run').length;
  const scores = viewScores(run);
  const blocked = viewBlock(crawl.blocked);
  const vitals = viewVitals(run);
  let host = text(run.site_origin);
  try {
    host = new URL(str(run.start_url)).host || host;
  } catch {
    // An unparsable start URL is shown as stored.
  }

  const factual = () =>
    factualSummary({
      host,
      pages: num(crawl.pages_crawled),
      htmlPages: num(crawl.html_pages),
      indexablePages: num(crawl.indexable_pages),
      maxPages: num(crawl.max_pages),
      checksRun,
      checksTotal: run.checks.length,
      findings: findings.length,
      checksWithFindings: groups.length,
      severityCounts,
      scores: scores.map(({ label, score }) => ({ label, score })),
      truncated: crawl.truncated === true,
      timeLimited: crawl.time_limit_reached === true,
      blocked,
      unreadablePages: unreadablePages(run),
      vitals: describeVitals(vitals),
    });

  return {
    title: reportTitle(run.modules_requested),
    host,
    startUrl: str(run.start_url),
    runId: str(run.run_id),
    date: formatDate(str(run.created_at)),
    brand: opts.brand,
    logo: opts.logo,
    summary: opts.summary
      ? { written: true, paragraphs: opts.summary.split(/\n\s*\n/).map((p) => collapseWhitespace(p)).filter(Boolean) }
      : { written: false, paragraphs: factual() },
    figures: [
      { label: 'Pages crawled', value: String(num(crawl.pages_crawled)) },
      { label: 'Findings', value: String(findings.length) },
      { label: 'Critical or high', value: String(severityCounts.critical + severityCounts.high) },
      { label: 'Checks run', value: `${checksRun} of ${run.checks.length}` },
    ],
    scope: viewScope(run, { host, blocked }),
    fixes: viewFixes(run),
    layers: viewLayers(vitals),
    scores,
    vitals,
    groups,
    topFixes: groups.slice(0, TOP_FIX_GROUPS),
    recommendations: opts.recommendations,
    notRun: run.checks
      .filter((check) => check.status !== 'run')
      .map((check) => ({ id: str(check.id), status: check.status === 'error' ? 'error' : 'skipped', reason: text(check.skip_reason, 'No reason recorded.') }))
      .sort((a, b) => compareText(a.id, b.id)),
    comparison: opts.comparison ? viewComparison(opts.comparison) : null,
    method: methodSections({
      pluginVersion: text(run.plugin_version, 'unknown'), rulesVersion: text(run.rules_version, 'unknown'), vitals: vitals !== null,
      repo: REPO_FRAMEWORKS.includes(str(obj(run.repo).framework)), security: Array.isArray(run.modules_requested) && run.modules_requested.includes('security'),
    }),
    pluginVersion: text(run.plugin_version, 'unknown'),
    rulesVersion: text(run.rules_version, 'unknown'),
  };
}
