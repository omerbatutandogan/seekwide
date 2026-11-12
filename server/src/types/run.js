// A stored audit run and what it holds besides findings (ARCHITECTURE.md 4.8, 4.12, 4.13). No runtime code.

/** @import { CrawlBlock } from './crawl.js' */
/** @import { CheckStat, Finding, ModuleScore } from './checks.js' */
/** @import { VitalsData } from './vitals.js' */

export {};

/**
 * What repo mode did in one audit. Stored in the run as `repo`.
 * @typedef {Object} RepoSummary
 * @property {'next-app'|'html'|'unsupported'|'none'} framework
 * @property {string} label            Name to show, for example "Next.js (App Router)".
 * @property {string} source_dir       The web project's folder relative to the project folder; "." when they are the same.
 * @property {string} [deployed_origin]  The address the project is deployed at, when the crawl was told (`site_url`):
 *   canonicals and sitemap entries on it were read as addresses on the local server.
 * @property {number} [deployed_localized]  How many were; 0 means that address matched nothing the pages name.
 * @property {number} findings_with_source
 * @property {number} pages_matched    Crawled HTML pages that a file of the project answers.
 * @property {number} pages_total      Crawled HTML pages.
 */

/**
 * What became of one fixed finding in the run made after the fix.
 * @typedef {Object} FixResult
 * @property {string} finding_id       Id of the finding in the base run.
 * @property {string} check_id
 * @property {string} title
 * @property {string} severity
 * @property {string|null} url
 * @property {string|null} file        The source file the finding named, relative to the project folder.
 * @property {'closed'|'open'|'replaced'|'unverified'} outcome
 *   `closed`: gone, and the check looked again. `open`: still reported. `replaced`: gone, but the run has a new
 *   finding of the same kind on the same page. `unverified`: gone, but the check did not look (see `detail`).
 * @property {string} detail           One sentence that says why, in the plugin's words.
 * @property {{id: string, check_id: string, title: string, severity: string}[]} replaced_by  For `replaced`; otherwise empty.
 */

/**
 * The re-audit after `/seekwide:fix`. Stored in the run as `fixes`.
 * @typedef {Object} FixVerification
 * @property {string} base_run_id      The run whose findings were fixed.
 * @property {{closed: number, open: number, replaced: number, unverified: number}} counts
 * @property {FixResult[]} results     In the order the findings were named.
 * @property {string[]} notes          What makes the comparison of the two runs unreliable (from `compareRuns`).
 */

/**
 * One audit run, stored at `<project>/.seekwide/runs/<run_id>/findings.json`.
 * @typedef {Object} Run
 * @property {number} schema_version
 * @property {string} rules_version
 * @property {string} plugin_version
 * @property {string} run_id
 * @property {string} created_at        ISO 8601.
 * @property {string} start_url
 * @property {string} site_origin
 * @property {{id: string, pages_crawled: number, html_pages: number, indexable_pages: number, unreadable_pages: number, truncated: boolean, time_limit_reached?: boolean, blocked: CrawlBlock|null, robots_status: string, sitemap_urls: number, max_pages: number, user_agent: string, start_gate?: string, start_shell_words?: number}} crawl
 *   `unreadable_pages` counts records for which `isUnverifiable` is true. `time_limit_reached` is present, and true,
 *   when the crawl stopped at its time limit. `start_gate` is the login or password page the start URL redirects to,
 *   and `start_shell_words` the word count of a start page with no link and fewer than 50 words; each is present
 *   only when it applies (`startPage` in tools/audit-summary.js).
 * @property {string[]} modules_requested
 * @property {Record<string, ModuleScore>} modules
 * @property {CheckStat[]} checks
 * @property {Finding[]} findings
 * @property {VitalsData|null} [core_web_vitals]  What was measured, passing values included. Null when the
 *   measurement was not asked for; absent in runs stored before it existed.
 * @property {RepoSummary|null} [repo]  Repo mode: the project whose source files the findings name. Null when
 *   the audit was not given a source folder; absent in runs stored before it existed.
 * @property {FixVerification|null} [fixes]  A re-audit after fixes: what became of each fixed finding of an earlier
 *   run. Null when the audit was not asked to verify fixes; absent in runs stored before it existed.
 */

/**
 * @typedef {Object} RunIndexEntry
 * @property {string} run_id
 * @property {string} created_at
 * @property {string} start_url
 * @property {Record<string, number|null>} scores
 * @property {number} findings
 */

/**
 * `<project>/.seekwide/profile.json`
 * @typedef {Object} Profile
 * @property {number} schema_version
 * @property {string} site_url
 * @property {{name: string, alternate_names?: string[]}} brand
 * @property {'b2b_saas'|'ecommerce'|'local_service'|'publisher'|'mobile_app'|'international'|'other'} [business_model]
 * @property {{country: string, languages: string[]}[]} [markets]
 * @property {string[]} [competitors]
 * @property {string[]} [target_queries]
 * @property {{brand_name?: string, logo_path?: string}} [report]
 * @property {string} updated_at         ISO 8601.
 */
