// The thirteen MCP tools. Every dependency is injected so handlers can be tested
// with fakes; server/src/index.js wires the real modules.

/** @import { AppFiles, CheckDef, CrawlJob, CrawlResult, ImageFileResult, OutboundResult, Profile, Run, RunIndexEntry, Finding, RepoSummary, VitalsData } from '../types.js' */
/** @import { checkImageFiles } from '../net/image-check.js' */
/** @import { fetchAppFiles } from '../net/app-files.js' */
/** @import { ToolDef } from '../mcp/stdio.js' */
/** @import { ProjectPaths } from '../store/project.js' */
/** @import { ProjectSources } from '../repo/sources.js' */
/** @import { ScoreChange } from '../store/compare.js' */
/** @import { ImportSource, SearchImport } from '../imports/parse.js' */

import { auditTools } from './audit.js';
import { projectTools } from './project.js';
import { crawlTools } from './crawl.js';
import { fixTools } from './fix.js';
import { profileTools } from './profile.js';
import { reportTools } from './report.js';
import { runTools } from './runs.js';
import { searchDataTools } from './search-data.js';

/**
 * @typedef {Object} Comparison
 * @property {string} base_run_id
 * @property {string} run_id
 * @property {Finding[]} resolved
 * @property {Finding[]} added
 * @property {number} persisting
 * @property {Record<string, ScoreChange>} scores
 * @property {string[]} notes
 */

/**
 * @typedef {Object} ToolDeps
 * @property {{
 *   start(options: {url: string, maxPages?: number, ratePerSec?: number, includeSubdomains?: boolean, allowLoopback?: boolean, deployedUrl?: string}): CrawlJob|Promise<CrawlJob>,
 *   get(id: string): CrawlJob|null,
 *   wait(id: string, timeoutMs: number): Promise<CrawlJob|null>,
 *   result(id: string): Promise<CrawlResult|null>,
 *   storedVitals(id: string, pages: number): Promise<{vitals: VitalsData, measured_at: string}|null>,
 *   storeVitals(id: string, pages: number, vitals: VitalsData, measuredAt: string): Promise<void>,
 *   wasPruned?(id: string): Promise<boolean>,
 * }} crawlManager
 * @property {CheckDef[]} checks
 * @property {(projectDir: string) => ProjectPaths} projectPaths
 * @property {(projectDir: string) => Promise<ProjectPaths>} ensureProject
 * @property {(date: Date, existingIds: string[]) => string} newRunId
 * @property {(projectDir: string, run: Run) => Promise<{runId: string, runDir: string, findingsFile: string, entry: RunIndexEntry}>} saveRun
 * @property {(projectDir: string, ref: string) => Promise<Run>} loadRun
 * @property {(projectDir: string) => Promise<RunIndexEntry[]>} listRuns
 * @property {(projectDir: string) => Promise<Profile|null>} readProfile
 * @property {(projectDir: string, input: unknown, now: Date) => Promise<Profile>} writeProfile
 * @property {(base: Run, current: Run) => Comparison} compareRuns
 * @property {(run: Run, options: object) => string} renderMarkdown
 * @property {(run: Run, options: object) => string} renderHtml
 * @property {(urls: string[], options?: {maxLinks?: number, concurrency?: number, signal?: AbortSignal}) => Promise<Map<string, OutboundResult>>} checkExternalLinks
 * @property {(crawl: CrawlResult, options: {maxPages: number, signal?: AbortSignal}) => Promise<VitalsData>} measureVitals
 *   Core Web Vitals of a crawl. The Google API key is bound into this function where the server is
 *   wired, so no tool ever holds it.
 * @property {(urls: string[], options?: Parameters<typeof checkImageFiles>[1]) => Promise<Map<string, ImageFileResult>>} checkImageFiles
 * @property {(siteOrigin: string, options?: Parameters<typeof fetchAppFiles>[1]) => Promise<AppFiles>} fetchAppFiles
 * @property {(projectDir: string, sourceDir?: string) => Promise<ProjectSources>} loadProjectSources
 *   Repo mode: what kind of web project a folder holds and which file answers a URL. Reads file names and
 *   package.json as data; throws `RepoError` for a folder that is missing or outside the project.
 * @property {(findings: Finding[], crawl: CrawlResult, sources: ProjectSources) => Promise<{findings: Finding[], summary: RepoSummary, notes: string[]}>} attachSources
 *   Repo mode: add `source` to the findings whose source file can be determined.
 * @property {(projectDir: string, record: SearchImport) => Promise<{file: string, relative: string}>} saveSearchImport
 *   Store an imported export under .seekwide/imports/, replacing the one from the same source.
 * @property {(projectDir: string, source: ImportSource) => Promise<SearchImport|null>} loadSearchImport
 *   The stored import from one source, checked like a run; null when there is none.
 * @property {() => Date} now
 * @property {() => string} defaultProjectDir
 * @property {{SEEKWIDE_REPORT_BRAND?: string, SEEKWIDE_REPORT_LOGO?: string}} env
 *   The report settings from the environment, and nothing else of it (`toolSettings` in config.js).
 */

/**
 * Build the tool definitions in a fixed order (crawl, project, audit, fix, runs, search data, report, profile).
 * @param {ToolDeps} deps
 * @returns {ToolDef[]}
 */
export function createTools(deps) {
  return [...crawlTools(deps), ...projectTools(deps), ...auditTools(deps), ...fixTools(deps), ...runTools(deps), ...searchDataTools(deps), ...reportTools(deps), ...profileTools(deps)];
}
