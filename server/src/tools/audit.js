// audit_run: run the checks on a finished crawl and save the run.

/** @import { CheckStat, CrawlResult, Finding, ModuleScore, OutboundResult, Run, VitalsData } from '../types.js' */
/** @import { ToolDef } from '../mcp/stdio.js' */
/** @import { ToolDeps } from './index.js' */

import { LIMITS, MODULES, RULES_VERSION, SCHEMA_VERSION, SEVERITIES, VERSION } from '../config.js';
import { buildContext, runChecks } from '../checks/engine.js';
import { onDeployedHost } from '../crawl/deployed.js';
import { isUnverifiable } from '../checks/page-helpers.js';
import { deployedNotes } from './audit-deployed.js';
import { VITALS_ARGUMENTS, collectVitals, vitalsNotes, vitalsOutput } from './audit-vitals.js';
import { JOB_ID_SCHEMA, PROJECT_DIR_SCHEMA, UNTRUSTED_NOTE, countBy, resolveProjectDir, withStoreErrors } from './common.js';
import { finishedCrawl } from './crawl.js';
import { VERIFY_FIXES_SCHEMA, fixBase, fixOutput, fixVerification } from './fix.js';
import { SOURCE_DIR_SCHEMA, auditSources } from './project.js';

const TOP_GROUPS = 10;
const EXAMPLE_URLS = 3;

export const BLOCKED_SCORE_NOTE = 'The crawl was blocked before any page could be read, so there is nothing to score.';

/** Plain words for the reasons `isUnverifiable` accepts. */
const UNREADABLE_REASONS = {
  bot_challenge: "the site's firewall challenged the crawler",
  rate_limited: 'the site kept rate-limiting the crawler',
  robots_disallowed: 'a redirect led to a URL that robots.txt does not allow the crawler to request, or whose robots.txt could not be read',
};

/**
 * URLs for the external link check, de-duplicated and sorted: the external link
 * targets on the crawled HTML pages (status 200), plus the `final_url` of every
 * record whose redirect chain leaves the site. Every URL on the host of the
 * deployed site of a local crawl (`options.deployed_origin`) is left out,
 * whatever its scheme or port, with or without "www.".
 * @param {CrawlResult} crawl
 * @returns {string[]}
 */
export function externalLinkUrls(crawl) {
  const urls = new Set();
  // A local crawl that knows where the project is deployed never has that address contacted: its pages
  // name it, and a request there would say nothing about the project being audited.
  const deployed = crawl.options.deployed_origin;
  /** @param {string} url */
  const onDeployedSite = (url) => Boolean(deployed) && onDeployedHost(url, /** @type {string} */ (deployed));
  for (const page of crawl.pages) {
    if (page.final_external) urls.add(page.final_url);
    if (page.status !== 200 || !page.is_html) continue;
    for (const link of page.links) {
      if (link.url !== null && !link.internal) urls.add(link.url);
    }
  }
  return [...urls].filter((url) => !onDeployedSite(url)).sort();
}

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
function runNotes(crawl, outbound, vitals, repoNotes) {
  const notes = [];
  if (crawl.blocked) {
    notes.push(`The crawl was stopped (${crawl.blocked.reason}) at ${crawl.blocked.url}. Findings cover only what was fetched before that; the crawler never tries to get past a block.`);
  }
  if (crawl.truncated) {
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

const SAVE_ATTEMPTS = 3;

/**
 * Give the run an id no stored run has and save it. Another audit saving at the
 * same moment can take the id first; the store then refuses with RUN_EXISTS and
 * the next free id is tried.
 * @param {ToolDeps} deps
 * @param {string} projectDir
 * @param {Run} run  Its `run_id` is set here.
 * @param {Date} date
 * @returns {Promise<{runId: string, findingsFile: string}>}
 */
async function saveWithNewId(deps, projectDir, run, date) {
  for (let attempt = 1; ; attempt += 1) {
    const existing = await withStoreErrors(() => deps.listRuns(projectDir));
    run.run_id = deps.newRunId(date, existing.map((entry) => entry.run_id));
    try {
      return await deps.saveRun(projectDir, run);
    } catch (error) {
      const taken = /** @type {{code?: unknown}} */ (error)?.code === 'RUN_EXISTS';
      if (!taken || attempt >= SAVE_ATTEMPTS) {
        return withStoreErrors(() => {
          throw error;
        });
      }
    }
  }
}

/** @param {CheckStat[]} checks */
function skippedChecks(checks) {
  return checks
    .filter((check) => check.status !== 'run')
    .map((check) => ({ id: check.id, status: check.status, reason: check.skip_reason }));
}

/**
 * @param {ToolDeps} deps
 * @returns {ToolDef[]}
 */
export function auditTools(deps) {
  return [
    {
      name: 'audit_run',
      title: 'Run the audit',
      description:
        'Run the SEO, link and security checks on a finished crawl, save the run under <project>/.seekwide/runs/ and return ' +
        'scores, totals, the top problems and notes on coverage. Accepts crawls that are done or blocked. ' +
        'The security module only reads the crawled pages and sends no request of its own. ' +
        'External links are checked only when the links module runs. With the seo module, Core Web Vitals are measured ' +
        'for a few pages through Google (PageSpeed Insights and the Chrome UX Report), which can take a minute; ' +
        'when Google refuses or does not answer, those checks are skipped and the audit still completes. ' +
        'With source_dir (repo mode, for a crawl of the project\'s own local server), each finding also names the source file it comes from. ' +
        'With verify_fixes (a re-audit after fixes), the run also says what became of each fixed finding of an earlier run.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: JOB_ID_SCHEMA,
          modules: {
            type: 'array',
            items: { type: 'string', enum: [...MODULES] },
            maxItems: MODULES.length,
            description: `Modules to run. Defaults to all: ${MODULES.join(', ')}.`,
          },
          check_outbound_links: { type: 'boolean', default: true, description: `With the links module, check up to ${LIMITS.maxOutboundChecks} external links for broken targets.` },
          ...VITALS_ARGUMENTS,
          project_dir: PROJECT_DIR_SCHEMA,
          source_dir: {
            ...SOURCE_DIR_SCHEMA,
            description:
              'Repo mode: absolute path of the web project whose local server was crawled, as project_detect returned it. ' +
              'Findings then carry source {file, line, route} where the file can be determined. Accepted only for a crawl of a site on this machine.',
          },
          verify_fixes: VERIFY_FIXES_SCHEMA,
        },
        required: ['job_id'],
        additionalProperties: false,
      },
      async handler(args) {
        const projectDir = resolveProjectDir(args.project_dir, deps.defaultProjectDir);
        // Fail on a bad project folder before spending time on link checks.
        await withStoreErrors(() => deps.ensureProject(projectDir));
        const modules = args.modules && args.modules.length > 0 ? [...new Set(/** @type {string[]} */ (args.modules))] : [...MODULES];
        const crawl = await finishedCrawl(deps.crawlManager, args.job_id);
        // Repo mode. A bad source folder fails here, before any request is sent.
        const sources = await auditSources(deps, projectDir, crawl, args.source_dir);
        // A re-audit after fixes. A base run that cannot be compared fails here too.
        const fixRequest = await fixBase(deps, projectDir, crawl, args.verify_fixes);

        // External links are checked only for the links module (README, REVIEW-FIXES R7).
        const linksRequested = modules.includes('links');
        const checkOutbound = linksRequested && (args.check_outbound_links ?? true);
        const external = checkOutbound ? externalLinkUrls(crawl) : [];
        // Core Web Vitals belong to the seo module. They are collected while the links are checked.
        const seoRequested = modules.includes('seo');
        const checkVitals = seoRequested && (args.check_core_web_vitals ?? true);
        /** @type {[Map<string, OutboundResult>|null, VitalsData|null]} */
        const [outbound, vitals] = await Promise.all([
          !checkOutbound ? null : external.length === 0
            ? new Map()
            : deps.checkExternalLinks(external, { maxLinks: LIMITS.maxOutboundChecks, concurrency: LIMITS.outboundConcurrency }),
          checkVitals ? collectVitals(deps, crawl, args.core_web_vitals_pages ?? LIMITS.vitalsPagesDefault) : null,
        ]);

        const ctx = buildContext(crawl, { outbound, vitals });
        const date = deps.now();
        const detectedAt = date.toISOString();
        const result = runChecks(deps.checks, ctx, { modules, detectedAt });
        const mapped = sources === null ? null : await deps.attachSources(result.findings, crawl, sources);
        const findings = mapped === null ? result.findings : mapped.findings;
        const blockedUnread = crawl.blocked !== null && ctx.htmlPages.length === 0;
        /** @type {Record<string, ModuleScore>} */
        const scores = blockedUnread
          ? Object.fromEntries(Object.entries(result.modules).map(([name, score]) => [name, { ...score, score: null, note: BLOCKED_SCORE_NOTE }]))
          : result.modules;

        /** @type {Run} */
        const run = {
          schema_version: SCHEMA_VERSION,
          rules_version: RULES_VERSION,
          plugin_version: VERSION,
          run_id: '',
          created_at: detectedAt,
          start_url: crawl.start_url,
          site_origin: crawl.site_origin,
          crawl: {
            id: crawl.id,
            pages_crawled: crawl.pages.length,
            html_pages: ctx.htmlPages.length,
            indexable_pages: ctx.indexablePages.length,
            unreadable_pages: crawl.pages.filter(isUnverifiable).length,
            truncated: crawl.truncated,
            blocked: crawl.blocked,
            robots_status: crawl.robots.status,
            sitemap_urls: crawl.sitemap.urls.length,
            max_pages: crawl.options.max_pages,
            user_agent: crawl.user_agent,
          },
          modules_requested: modules,
          modules: scores,
          checks: result.checks,
          findings,
          core_web_vitals: vitals,
          repo: mapped === null ? null : mapped.summary,
          fixes: null,
        };
        run.fixes = fixVerification(deps, fixRequest, run, crawl);
        const saved = await saveWithNewId(deps, projectDir, run, date);

        return {
          run_id: saved.runId,
          project_dir: projectDir,
          files: { findings: saved.findingsFile },
          crawl: run.crawl,
          modules: run.modules,
          totals: {
            findings: result.findings.length,
            by_severity: Object.fromEntries(SEVERITIES.map((severity) => [severity, result.findings.filter((f) => f.severity === severity).length])),
            by_module: countBy(result.findings, (finding) => finding.module),
            checks_run: result.checks.filter((check) => check.status === 'run').length,
            checks_skipped: result.checks.filter((check) => check.status === 'skipped').length,
            checks_failed_to_run: result.checks.filter((check) => check.status === 'error').length,
          },
          top: topGroups(findings, TOP_GROUPS),
          core_web_vitals: vitalsOutput(vitals),
          repo: run.repo,
          fix_verification: fixOutput(run.fixes ?? null),
          skipped_checks: skippedChecks(result.checks),
          notes: runNotes(
            crawl,
            { requested: linksRequested, checked: checkOutbound, found: external.length },
            { requested: seoRequested, checked: checkVitals, vitals },
            mapped === null ? [] : mapped.notes,
          ),
          _note: UNTRUSTED_NOTE,
        };
      },
    },
  ];
}
