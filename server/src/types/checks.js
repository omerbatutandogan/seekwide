// Checks, their context and their findings (ARCHITECTURE.md 4.7). No runtime code.

/** @import { CrawlResult, OutboundResult } from './crawl.js' */
/** @import { LinkRecord, PageRecord } from './page.js' */
/** @import { VitalsData } from './vitals.js' */
/** @import { ImageFileResult } from './media.js' */

export {};

/**
 * @typedef {Object} InlinkRef
 * @property {string} from             URL of the page containing the link.
 * @property {LinkRecord} link
 */

/**
 * Read-only view of a crawl that checks work against. Built by `buildContext`.
 * @typedef {Object} CheckContext
 * @property {CrawlResult} crawl
 * @property {PageRecord[]} pages            Every record.
 * @property {PageRecord[]} htmlPages        Records with status 200 and `is_html`.
 * @property {PageRecord[]} indexablePages   Records with `indexability.indexable`.
 * @property {Map<string, PageRecord>} pageByUrl  Keyed by `record.url`.
 * @property {Map<string, InlinkRef[]>} inlinks   Target URL → internal links pointing at it from `htmlPages`.
 * @property {Set<string>} sitemapUrls       URLs listed in the XML sitemaps.
 * @property {{origin: string, host: string, https: boolean, start_url: string}} site
 * @property {Set<string>} capabilities      Which of `CAPABILITIES` this audit provides.
 * @property {Record<string, string>} skipReasons  Why a capability is missing, in the collector's words, when it gave a reason.
 * @property {Map<string, OutboundResult>|null} outbound  External link results, when they were collected.
 * @property {VitalsData|null} vitals         Core Web Vitals, when they were measured.
 * @property {Map<string, ImageFileResult>|null} imageFiles  Image files checked for the media module, by URL, when they were checked.
 * @property {(url: string) => PageRecord|undefined} resolve  Record at the end of a URL's redirect chain, if crawled.
 */

/**
 * One unit of work a check looked at. A check returns a result for every unit it
 * applies to (pass or fail) and nothing for units it does not apply to.
 * @typedef {Object} CheckResult
 * @property {'pass'|'fail'} status
 * @property {string|null} url         Page the result is about; null for a site-level result.
 * @property {string} [selector]       CSS-like locator or another stable key. Part of the finding id.
 * @property {number|null} [line]
 * @property {{observed?: unknown, expected?: unknown, detail?: string}} [evidence]
 * @property {string[]} [related_urls] Other URLs involved, for example the other pages with the same title (max 20).
 * @property {{type: string, snippet?: string}} [fix]
 * @property {'likely'} [confidence]  Lowers this finding's confidence from the check's `confirmed` to `likely`, for a unit
 *   with a known legitimate exception. A result never raises it.
 */

/**
 * @typedef {Object} CheckDef
 * @property {string} id               `<module>.<area>.<problem>`, lower-case, for example "seo.title.missing".
 * @property {'seo'|'links'|'security'|'media'} module
 * @property {'code'} engine           Every scripted check is 'code'. Model judgments are never checks.
 * @property {string} title            Short name of the problem, sentence case, no trailing period.
 * @property {string} description      What the check looks at and why it matters, one or two sentences.
 * @property {'critical'|'high'|'medium'|'low'|'info'} severity
 * @property {number} weight           0–5. 0 means the check never affects the score and is required for 'info'.
 * @property {1|2|3} impact
 * @property {1|2|3} effort
 * @property {'confirmed'|'likely'} confidence  'confirmed' = measured fact; 'likely' = strong signal that can have a legitimate exception.
 * @property {'page'|'site'} scope
 * @property {string[]} requires       Subset of `CAPABILITIES`.
 * @property {string} doc_ref          Official documentation the rule is based on.
 * @property {string} last_verified    Date the rule was last checked against `doc_ref`, YYYY-MM-DD.
 * @property {string} recommendation   What to do about a failure, imperative mood.
 * @property {'security_headers'} [score_group]  The score the check counts toward instead of its module's
 *   (`SCORE_GROUPS`): the security header checks have a score of their own.
 * @property {(ctx: CheckContext) => CheckResult[]} run  Pure and deterministic. No I/O.
 */

/**
 * A failed check result, ready to be stored and reported.
 * @typedef {Object} Finding
 * @property {string} id               Stable across runs: hash of check id, URL and selector.
 * @property {string} check_id
 * @property {string} module
 * @property {'code'} engine
 * @property {string} title
 * @property {'critical'|'high'|'medium'|'low'|'info'} severity
 * @property {number} weight
 * @property {1|2|3} impact
 * @property {1|2|3} effort
 * @property {'confirmed'|'likely'} confidence
 * @property {'fail'} status
 * @property {string|null} url
 * @property {string|null} selector
 * @property {number|null} line
 * @property {{observed?: unknown, expected?: unknown, detail?: string}} evidence
 * @property {string[]} related_urls
 * @property {string} recommendation
 * @property {{type: string, snippet?: string}|null} fix
 * @property {string} doc_ref
 * @property {string} detected_at      ISO 8601.
 * @property {FindingSource} [source]  Repo mode only: the source file the finding comes from. Absent when it
 *   could not be determined, and in every audit that was not given a source folder. Never part of the id.
 */

/**
 * Where in the project a finding's fix belongs.
 * @typedef {Object} FindingSource
 * @property {string} file             Path relative to the project folder, forward slashes.
 * @property {number|null} line        1-based line of the element in `file`; null when it is not known
 *   (always for a Next.js project, whose code the plugin does not read).
 * @property {string|null} route       The route that answers the finding's URL: "/blog/[slug]" for Next.js,
 *   the URL path for plain HTML.
 */

/**
 * @typedef {Object} CheckStat
 * @property {string} id
 * @property {string} module
 * @property {'run'|'skipped'|'error'} status
 * @property {string|null} skip_reason  Why the check did not run.
 * @property {number} applicable        Units the check looked at.
 * @property {number} passed
 * @property {number} failed
 */

/**
 * @typedef {Object} ModuleScore
 * @property {number|null} score        0–100, or null when nothing could be scored, and always for a score given as a count.
 * @property {{passed: number, of: number}|null} [count]  Only for a score given as a count (`COUNTED_SCORES`): of the
 *   scored checks that looked at a unit (`of`), how many passed every unit (`passed`); null when none did.
 * @property {number} coverage          Share of the module's checks that ran, 0–1 with two decimals.
 * @property {number} checks_total
 * @property {number} checks_run
 * @property {number} checks_skipped
 * @property {string|null} note         Why there is no score, when `score` is null.
 */

/**
 * @typedef {Object} AuditResult
 * @property {Finding[]} findings
 * @property {CheckStat[]} checks
 * @property {Record<string, ModuleScore>} modules
 */
