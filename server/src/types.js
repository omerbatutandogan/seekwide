// Shared data shapes. This file has no runtime code; it exists so every module
// documents and type-checks against the same contracts.
//
// Naming: persisted data (crawl results, findings, runs) uses snake_case keys,
// because those objects are written to JSON files and read by people. Function
// arguments and return values that never leave the process use camelCase.

export {};

// ───────────────────────────── Network ─────────────────────────────

/**
 * @typedef {Object} RedirectHop
 * @property {string} url          URL that answered with a redirect.
 * @property {number} status       3xx status of that answer.
 * @property {string|null} location Absolute URL the hop pointed to; null when the header was missing or invalid.
 */

/**
 * @typedef {Object} FetchError
 * @property {'invalid_url'|'unsupported_protocol'|'blocked_address'|'dns_error'|'dns_temporary'|'timeout'|'too_many_redirects'|'redirect_loop'|'connection_error'|'tls_error'|'body_error'} code
 *   `dns_error` means the name does not exist; `dns_temporary` means the lookup failed for another reason and may work later.
 * @property {string} message
 */

/**
 * Result of `safeFetch`. Network failures are reported here; `safeFetch` never throws for them.
 * @typedef {Object} FetchResult
 * @property {string} url              URL that was requested.
 * @property {string} finalUrl         URL of the last response (equals `url` when there was no redirect).
 * @property {number} status           Status of the last complete response. 0 whenever `error` is set, except for
 *   `too_many_redirects` and `redirect_loop`, which keep the status of the last redirect. A response whose body
 *   failed part-way is a failed request: status 0, never the status from its headers.
 * @property {Record<string, string>} headers  Headers of the last response, lower-cased names; repeated headers joined with ", ".
 * @property {Record<string, string[]>} headerLines  The same headers with each repeated value kept separate.
 * @property {RedirectHop[]} redirectChain  Redirect hops that were followed, in order.
 * @property {Buffer|null} body        Decompressed body; null for HEAD requests and failures.
 * @property {boolean} truncated       True when the body was cut at `maxBytes`.
 * @property {number} bytes            Size of the decompressed body that was read.
 * @property {number} elapsedMs
 * @property {FetchError|null} error
 */

// ───────────────────────────── Extraction ─────────────────────────────

/**
 * @typedef {Object} LinkRecord
 * @property {string} href            Raw `href` attribute; '' when the attribute is missing.
 * @property {string|null} url        Normalized absolute URL; null when `href` is missing, invalid or not http(s).
 * @property {string} text            Anchor text: text content plus the `alt` of contained images and the `aria-label` of
 *   contained elements (which replaces their content), whitespace-collapsed, max 300 chars.
 * @property {string|null} aria_label `aria-label` attribute, trimmed; null when absent or empty.
 * @property {string|null} title_attr `title` attribute, trimmed and clipped; null when absent or empty. Google uses it as anchor text when the element has no text.
 * @property {string[]} rel           Lower-cased `rel` tokens.
 * @property {boolean} internal       True when `url` belongs to the audited site.
 * @property {boolean} has_onclick    True when the element has an `onclick` attribute.
 * @property {number|null} line       1-based source line of the element.
 */

/**
 * @typedef {Object} ImageRecord
 * @property {string} src             Raw `src` attribute; '' when missing.
 * @property {string|null} url        Normalized absolute URL or null.
 * @property {string|null} alt        `alt` attribute; null when the attribute is absent ('' means an explicit empty alt).
 * @property {string|null} width
 * @property {string|null} height
 * @property {string|null} loading
 * @property {boolean} has_srcset
 * @property {number|null} line
 */

/**
 * @typedef {Object} CanonicalRef
 * @property {string} href            Raw value.
 * @property {string|null} url        Normalized absolute URL or null when invalid.
 * @property {'html'|'header'} source `<link rel="canonical">` or an HTTP `Link` header.
 * @property {boolean} in_head        True for header canonicals and for link elements inside `<head>`. Google ignores canonicals outside `<head>`.
 * @property {boolean} [streamed]     True for a link element outside `<head>` that a Next.js App Router page sent in `<body>`
 *   as streamed metadata: the page has `self.__next_f` data scripts and its `<title>` is in the body too. It stays
 *   `in_head: false`; the flag moves the finding from `seo.canonical.outside_head` to `seo.canonical.streamed_in_body`.
 * @property {number|null} line
 */

/**
 * @typedef {Object} HreflangRef
 * @property {string} hreflang
 * @property {string} href
 * @property {string|null} url
 * @property {'html'|'header'} source
 */

/**
 * @typedef {Object} Heading
 * @property {1|2|3|4|5|6} level
 * @property {string} text            Whitespace-collapsed text, max 300 chars.
 * @property {number|null} line
 */

/**
 * @typedef {Object} JsonLdBlock
 * @property {boolean} valid          False when the script content is not valid JSON.
 * @property {string[]} types         `@type` values found at the top level and in `@graph`.
 * @property {string|null} error      Parser message when `valid` is false.
 * @property {number|null} line
 */

/**
 * @typedef {Object} Indexability
 * @property {boolean} indexable
 * @property {string[]} reasons  Why the URL is not indexable as it stands. Values:
 *   'fetch_error', 'redirect', 'status_<code>', 'not_html', 'noindex_meta', 'noindex_header', 'canonical_elsewhere'.
 */

/**
 * Everything the audit knows about one URL. One record per requested URL.
 *
 * A URL that redirects gets its own record with the 3xx `status`, an empty
 * content section and `final_url` pointing at the end of the chain; the content
 * at the end of the chain is stored in that final URL's own record.
 *
 * @typedef {Object} PageRecord
 * @property {string} url               Normalized URL of this record.
 * @property {number} status            HTTP status this URL answered with; 0 when the request failed.
 * @property {string} final_url         URL at the end of the redirect chain (equals `url` when there is none).
 * @property {number} final_status      Status at the end of the redirect chain (equals `status` when there is none); 0 when the end was not fetched or the request failed.
 * @property {boolean} final_external   True when the redirect chain leaves the audited site. The crawl does not fetch other sites, so
 *   `final_url` is the first URL outside the site and `final_status` is 0. The destination is checked with the external links instead.
 * @property {RedirectHop[]} redirect_chain  Hops from this URL to `final_url`; empty when there is no redirect.
 * @property {number|null} depth        Clicks from the start URL; null when the URL was found only in a sitemap.
 * @property {('start'|'link'|'sitemap'|'redirect')[]} discovered_via
 * @property {string|null} content_type Lower-cased media type without parameters.
 * @property {Record<string, string>} headers  Selected response headers, lower-cased names. Empty for redirect records and failed requests.
 * @property {boolean} is_html
 * @property {number} bytes
 * @property {number} fetch_ms          Timing only; never used in findings.
 * @property {string|null} fetch_error  Why this URL has no usable response, or null. A `FetchError.code`, or one of:
 *   'bot_challenge' (the site's firewall challenged the crawler on this URL), 'rate_limited' (the site answered 429),
 *   'robots_disallowed' (a redirect led to a URL that robots.txt does not allow, or whose robots.txt could not be read;
 *   it was not fetched).
 *   Those three say something about the audit, not about the site; see `isUnverifiable` in checks/page-helpers.js.
 * @property {string|null} html_lang    `lang` attribute of `<html>`, trimmed; null when absent or empty.
 * @property {string[]} titles          Text of each HTML `<title>` element in the document, whitespace-collapsed (empty titles are kept as ''). SVG titles are not included.
 * @property {string[]} meta_descriptions  `content` of each `<meta name="description">`, whitespace-collapsed.
 * @property {string[]} meta_robots     Lower-cased directive tokens from `<meta name="robots">` and `<meta name="googlebot">`.
 * @property {string[]} x_robots        Lower-cased directive tokens from `X-Robots-Tag` values that apply to all crawlers or to googlebot.
 * @property {CanonicalRef[]} canonicals
 * @property {HreflangRef[]} hreflang
 * @property {Heading[]} headings
 * @property {string|null} viewport     `content` of `<meta name="viewport">`; null when absent.
 * @property {Record<string, string>} og       Open Graph properties without the "og:" prefix; first value wins.
 * @property {Record<string, string>} twitter  Twitter card properties without the "twitter:" prefix; first value wins.
 * @property {LinkRecord[]} links       Every `<a>` element in document order.
 * @property {ImageRecord[]} images
 * @property {JsonLdBlock[]} jsonld
 * @property {string[]} mixed_content   http:// subresource URLs referenced by an https page (max 20).
 * @property {number} word_count        Words in the visible body text.
 * @property {string} text_hash         sha1 of the normalized visible body text; '' when there is none.
 * @property {string} text_excerpt      First 2000 characters of the visible body text.
 * @property {Indexability} indexability
 */

// ───────────────────────────── Crawl ─────────────────────────────

/**
 * @typedef {Object} RobotsSummary
 * @property {'ok'|'missing'|'unreachable'} status  'missing' = 4xx, or more than five redirects (everything allowed);
 *   'unreachable' = 429, 5xx, any other status or a network error (nothing allowed).
 * @property {number} http_status
 * @property {string} url
 * @property {string[]} sitemaps          `Sitemap:` URLs, normalized.
 * @property {number|null} crawl_delay_sec  Crawl-delay for this crawler, if any.
 * @property {boolean} disallows_all      The whole site is disallowed for `User-agent: *`.
 * @property {boolean} disallows_all_googlebot  The whole site is disallowed for Googlebot.
 */

/**
 * @typedef {Object} SitemapFile
 * @property {string} url
 * @property {number} status
 * @property {'urlset'|'index'|'invalid'|'unreachable'|'external'|'disallowed'} type  'external' = on another host, so it was not read.
 *   'disallowed' = robots.txt does not allow the crawler to request it (or a redirect it led to), or could not be read,
 *   so it was not read.
 * @property {number} count            URLs (urlset) or child sitemaps (index) listed.
 * @property {string|null} error
 */

/**
 * @typedef {Object} SitemapSummary
 * @property {boolean} loaded          False when the crawl stopped before sitemaps were looked for, or when robots.txt lists none
 *   and /sitemap.xml could not be read: robots.txt does not allow it, or it redirects to another host
 *   (`files` then holds one 'disallowed' or 'external' entry for it).
 * @property {SitemapFile[]} files
 * @property {string[]} urls           Normalized page URLs listed in the sitemaps, in file order, de-duplicated.
 * @property {boolean} truncated       True when the file or URL limit cut the list short.
 */

/**
 * @typedef {Object} CrawlBlock
 * @property {'robots_unreachable'|'robots_disallow'|'bot_challenge'|'rate_limited'} reason
 * @property {string} url
 * @property {number} status
 */

/**
 * @typedef {Object} HttpProbe
 * @property {string} url              The http:// version of the start URL.
 * @property {number} status
 * @property {string} final_url
 * @property {boolean} enforced        True when the probe ended on an https:// URL.
 */

/**
 * The persisted result of one crawl (`<dataDir>/crawls/<id>.json`).
 * @typedef {Object} CrawlResult
 * @property {number} schema_version
 * @property {string} id
 * @property {string} start_url        Normalized URL the user asked for.
 * @property {string} site_origin      Origin of the start URL after redirects.
 * @property {string} site_host        Host of the start URL after redirects, with the port when it is not the default (`URL.host`).
 * @property {string} started_at       ISO 8601.
 * @property {string} finished_at      ISO 8601.
 * @property {{max_pages: number, rate_per_sec: number, include_subdomains: boolean, local?: boolean}} options
 *   `local` is true when the audited site is on this machine (the crawl was allowed to reach loopback).
 *   Such a site is never named to an outside service.
 * @property {RobotsSummary} robots
 * @property {SitemapSummary} sitemap
 * @property {HttpProbe|null} http_probe   Null when the site is not https or the probe was not possible.
 * @property {PageRecord[]} pages      In fetch order, which is deterministic.
 * @property {string[]} robots_blocked URLs skipped because robots.txt disallows them (max 200).
 * @property {boolean} truncated       True when the page limit stopped the crawl before the frontier was empty.
 * @property {CrawlBlock|null} blocked Set when the crawl had to stop.
 * @property {string} user_agent
 */

/**
 * In-memory view of a crawl job.
 * @typedef {Object} CrawlJob
 * @property {string} id
 * @property {'running'|'done'|'blocked'|'failed'} status
 * @property {string} start_url
 * @property {number} max_pages
 * @property {number} pages_crawled
 * @property {number} pages_queued
 * @property {boolean} truncated
 * @property {CrawlBlock|null} blocked
 * @property {string|null} error       Message when `status` is 'failed'.
 * @property {string} started_at
 * @property {string|null} finished_at
 */

/**
 * @typedef {Object} OutboundResult
 * @property {string} url
 * @property {number} status           0 when no response was received.
 * @property {'ok'|'broken'|'unverifiable'} outcome  'broken' only for 404, 410 and DNS failure.
 * @property {string|null} reason      Short reason for 'broken' and 'unverifiable'.
 * @property {string|null} final_url
 */

// ───────────────────────────── Core Web Vitals ─────────────────────────────

/**
 * One simulated page load by PageSpeed Insights (Lighthouse on an emulated phone).
 * @typedef {Object} LabMetrics
 * @property {number|null} lcp_ms      Largest Contentful Paint, whole milliseconds.
 * @property {number|null} cls         Cumulative Layout Shift, three decimals.
 * @property {number|null} tbt_ms      Total Blocking Time, whole milliseconds.
 * @property {string|null} lighthouse_version
 * @property {string|null} final_url   URL the test ended on, when Google was redirected away from the tested URL; null otherwise.
 */

/**
 * One metric of a Chrome UX Report record.
 * @typedef {Object} FieldMetric
 * @property {number} p75              75th percentile: milliseconds, or the unitless layout shift score.
 * @property {number|null} good        Share of page loads in the good range, 0–1; null when the histogram does not use the documented boundary.
 */

/**
 * What real Chrome users on phones experienced over the collection period.
 * @typedef {Object} FieldRecord
 * @property {FieldMetric|null} lcp_ms
 * @property {FieldMetric|null} inp_ms
 * @property {FieldMetric|null} cls
 * @property {{first: string, last: string}|null} period  Collection period, YYYY-MM-DD, both days included.
 */

/**
 * @typedef {Object} VitalsPage
 * @property {string} url
 * @property {string} why              Why this page was chosen, for example "Start page".
 * @property {LabMetrics|null} lab
 * @property {string|null} lab_note    Why there is no lab data for this page; null when there is.
 * @property {FieldRecord|null} field
 * @property {string|null} field_note  Why there is no field data for this page; null when there is.
 */

/**
 * Core Web Vitals collected for one audit. Stored in the run as `core_web_vitals`.
 * @typedef {Object} VitalsData
 * @property {{available: boolean, reason: string|null, device: 'mobile'}} lab
 *   `available`: PageSpeed Insights returned values for one or more pages. `reason` says why not.
 * @property {{available: boolean, reason: string|null, form_factor: 'phone'}} field
 *   `available`: the Chrome UX Report API answered, with a record or with "no data". `reason` says why not.
 * @property {{origin: string, field: FieldRecord|null, field_note: string|null}} origin  The whole site.
 * @property {VitalsPage[]} pages      The tested pages, in the order they were chosen.
 * @property {string[]} notes          Plain statements about anything that limits what the numbers say.
 */

// ───────────────────────────── Checks ─────────────────────────────

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
 */

/**
 * @typedef {Object} CheckDef
 * @property {string} id               `<module>.<area>.<problem>`, lower-case, for example "seo.title.missing".
 * @property {'seo'|'links'} module
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
 * What repo mode did in one audit. Stored in the run as `repo`.
 * @typedef {Object} RepoSummary
 * @property {'next-app'|'html'|'unsupported'|'none'} framework
 * @property {string} label            Name to show, for example "Next.js (App Router)".
 * @property {string} source_dir       The web project's folder relative to the project folder; "." when they are the same.
 * @property {number} findings_with_source
 * @property {number} pages_matched    Crawled HTML pages that a file of the project answers.
 * @property {number} pages_total      Crawled HTML pages.
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
 * @property {number|null} score        0–100, or null when nothing could be scored.
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

// ───────────────────────────── Storage ─────────────────────────────

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
 * @property {{id: string, pages_crawled: number, html_pages: number, indexable_pages: number, unreadable_pages: number, truncated: boolean, blocked: CrawlBlock|null, robots_status: string, sitemap_urls: number, max_pages: number, user_agent: string}} crawl
 *   `unreadable_pages` counts records for which `isUnverifiable` is true.
 * @property {string[]} modules_requested
 * @property {Record<string, ModuleScore>} modules
 * @property {CheckStat[]} checks
 * @property {Finding[]} findings
 * @property {VitalsData|null} [core_web_vitals]  What was measured, passing values included. Null when the
 *   measurement was not asked for; absent in runs stored before it existed.
 * @property {RepoSummary|null} [repo]  Repo mode: the project whose source files the findings name. Null when
 *   the audit was not given a source folder; absent in runs stored before it existed.
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
