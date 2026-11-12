// audit_run: run the checks on a finished crawl and save the run.

/** @import { CrawlResult, ModuleScore, OutboundResult, Run, VitalsData } from '../types.js' */
/** @import { ToolDef } from '../mcp/stdio.js' */
/** @import { ToolDeps } from './index.js' */

import { LIMITS, MODULES, RULES_VERSION, SCHEMA_VERSION, SEVERITIES, VERSION } from '../config.js';
import { buildContext, runChecks } from '../checks/engine.js';
import { isUnverifiable } from '../checks/page-helpers.js';
import { externalLinkUrls } from './audit-links.js';
import { runNotes, skippedChecks, startPage, topGroups } from './audit-summary.js';
import { MEDIA_ARGUMENTS, collectImageFiles, imageFilesNotes } from './audit-media.js';
import { VITALS_ARGUMENTS, collectVitals, vitalsOutput } from './audit-vitals.js';
import { JOB_ID_SCHEMA, PROJECT_DIR_SCHEMA, UNTRUSTED_NOTE, countBy, resolveProjectDir, withStoreErrors } from './common.js';
import { finishedCrawl } from './crawl.js';
import { VERIFY_FIXES_SCHEMA, fixBase, fixOutput, fixVerification } from './fix.js';
import { SOURCE_DIR_SCHEMA, auditSources } from './project.js';

const TOP_GROUPS = 10;

export { externalLinkUrls };

export const BLOCKED_SCORE_NOTE = 'The crawl was blocked before any page could be read, so there is nothing to score.';

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

/**
 * @param {ToolDeps} deps
 * @returns {ToolDef[]}
 */
export function auditTools(deps) {
  /** Core Web Vitals measurements under way, so that two audits of one crawl ask Google once. */
  const pendingVitals = new Map();
  return [
    {
      name: 'audit_run',
      title: 'Run the audit',
      description:
        'Run the SEO, link, security and media checks on a finished crawl, save the run under <project>/.seekwide/runs/ and return ' +
        'scores, totals, the top problems and notes on coverage. Accepts crawls that are done or blocked. ' +
        'The security module only reads the crawled pages and sends no request of its own. ' +
        `The media module checks up to ${LIMITS.maxImageChecks} image files the pages show (robots.txt first, then a HEAD request each), which can take a minute. ` +
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
          ...MEDIA_ARGUMENTS,
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
      async handler(args, context) {
        // Fires when the client cancels the call: no request starts after that, and nothing is saved.
        const signal = context?.signal;
        const projectDir = resolveProjectDir(args.project_dir, deps.defaultProjectDir);
        // Fail on a bad project folder before spending time on link checks.
        await withStoreErrors(() => deps.ensureProject(projectDir));
        const modules = args.modules && args.modules.length > 0 ? [...new Set(/** @type {string[]} */ (args.modules))] : [...MODULES];
        const crawl = await finishedCrawl(deps.crawlManager, args.job_id);
        // Repo mode. A bad source folder fails here, before any request is sent.
        const sources = await auditSources(deps, projectDir, crawl, args.source_dir);
        // A re-audit after fixes. A base run that cannot be compared fails here too.
        const fixRequest = await fixBase(deps, projectDir, crawl, args.verify_fixes);

        // External links are checked only for the links module (README, "Network and data").
        const linksRequested = modules.includes('links');
        const checkOutbound = linksRequested && (args.check_outbound_links ?? true);
        const external = checkOutbound ? externalLinkUrls(crawl) : [];
        // Core Web Vitals belong to the seo module. They are collected while the links are checked.
        const seoRequested = modules.includes('seo');
        const checkVitals = seoRequested && (args.check_core_web_vitals ?? true);
        // Image files belong to the media module. They are checked after the external links, never at the same time:
        // an image and a link can be on one host, and that host must see one request at a time.
        const mediaRequested = modules.includes('media');
        /** @type {Promise<Map<string, OutboundResult>|null>} */
        const links = Promise.resolve(!checkOutbound ? null : external.length === 0
          ? new Map()
          : deps.checkExternalLinks(external, { maxLinks: LIMITS.maxOutboundChecks, concurrency: LIMITS.outboundConcurrency, ...(signal ? { signal } : {}) }));
        /** @type {[Map<string, OutboundResult>|null, VitalsData|null, Awaited<ReturnType<typeof collectImageFiles>>]} */
        const [outbound, vitals, images] = await Promise.all([
          links,
          checkVitals ? collectVitals(deps, crawl, args.core_web_vitals_pages ?? LIMITS.vitalsPagesDefault, pendingVitals, signal) : null,
          links.catch(() => null).then(() => collectImageFiles(deps, crawl, { requested: mediaRequested, check: args.check_image_files ?? true, signal })),
        ]);
        signal?.throwIfAborted();

        const ctx = buildContext(crawl, { outbound, vitals, imageFiles: images.files, imageFilesReason: images.reason });
        const date = deps.now();
        const detectedAt = date.toISOString();
        const result = runChecks(deps.checks, ctx, { modules, detectedAt });
        const mapped = sources === null ? null : await deps.attachSources(result.findings, crawl, sources);
        const findings = mapped === null ? result.findings : mapped.findings;
        const blockedUnread = crawl.blocked !== null && ctx.htmlPages.length === 0;
        /** @type {Record<string, ModuleScore>} */
        const scores = blockedUnread
          ? Object.fromEntries(Object.entries(result.modules).map(([name, score]) => [name, { ...score, score: null, ...('count' in score ? { count: null } : {}), note: BLOCKED_SCORE_NOTE }]))
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
            ...(crawl.time_limit_reached === true ? { time_limit_reached: true } : {}),
            blocked: crawl.blocked,
            robots_status: crawl.robots.status,
            sitemap_urls: crawl.sitemap.urls.length,
            max_pages: crawl.options.max_pages,
            user_agent: crawl.user_agent,
            ...startPage(crawl),
          },
          modules_requested: modules,
          modules: scores,
          checks: result.checks,
          findings,
          core_web_vitals: vitals,
          repo: mapped === null ? null : mapped.summary,
          fixes: null,
          image_files: images.summary,
        };
        run.fixes = fixVerification(deps, fixRequest, run, crawl);
        signal?.throwIfAborted();
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
          notes: [
            ...runNotes(
              crawl,
              { requested: linksRequested, checked: checkOutbound, found: external.length },
              { requested: seoRequested, checked: checkVitals, vitals },
              mapped === null ? [] : mapped.notes,
            ),
            ...imageFilesNotes(images),
          ],
          _note: UNTRUSTED_NOTE,
        };
      },
    },
  ];
}
