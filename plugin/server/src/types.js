// Shared data shapes. This file has no runtime code; it exists so every module
// documents and type-checks against the same contracts. The shapes are defined
// in types/, one file per area, and named here so that every module imports
// them from one place.
//
// Naming: persisted data (crawl results, findings, runs) uses snake_case keys,
// because those objects are written to JSON files and read by people. Function
// arguments and return values that never leave the process use camelCase.

export {};

// Network: types/net.js
/** @typedef {import('./types/net.js').RedirectHop} RedirectHop */
/** @typedef {import('./types/net.js').FetchError} FetchError */
/** @typedef {import('./types/net.js').FetchResult} FetchResult */

// Extraction: types/page.js
/** @typedef {import('./types/page.js').LinkRecord} LinkRecord */
/** @typedef {import('./types/page.js').ImageRecord} ImageRecord */
/** @typedef {import('./types/page.js').VideoRecord} VideoRecord */
/** @typedef {import('./types/page.js').VideoEmbedRecord} VideoEmbedRecord */
/** @typedef {import('./types/page.js').VideoObjectSummary} VideoObjectSummary */
/** @typedef {import('./types/page.js').CanonicalRef} CanonicalRef */
/** @typedef {import('./types/page.js').HreflangRef} HreflangRef */
/** @typedef {import('./types/page.js').Heading} Heading */
/** @typedef {import('./types/page.js').JsonLdBlock} JsonLdBlock */
/** @typedef {import('./types/page.js').Indexability} Indexability */
/** @typedef {import('./types/page.js').PageRecord} PageRecord */

// Security signals: types/security.js
/** @typedef {import('./types/security.js').HiddenLinkRecord} HiddenLinkRecord */
/** @typedef {import('./types/security.js').EmbedRecord} EmbedRecord */
/** @typedef {import('./types/security.js').TermHits} TermHits */
/** @typedef {import('./types/security.js').SecurityHeaders} SecurityHeaders */
/** @typedef {import('./types/security.js').PageSecurity} PageSecurity */

// Image files: types/media.js
/** @typedef {import('./types/media.js').ImageFileResult} ImageFileResult */
/** @typedef {import('./types/media.js').ImageFilesSummary} ImageFilesSummary */

// Crawl: types/crawl.js
/** @typedef {import('./types/crawl.js').RobotsSummary} RobotsSummary */
/** @typedef {import('./types/crawl.js').SitemapFile} SitemapFile */
/** @typedef {import('./types/crawl.js').SitemapSummary} SitemapSummary */
/** @typedef {import('./types/crawl.js').CrawlBlock} CrawlBlock */
/** @typedef {import('./types/crawl.js').HttpProbe} HttpProbe */
/** @typedef {import('./types/crawl.js').CrawlResult} CrawlResult */
/** @typedef {import('./types/crawl.js').CrawlJob} CrawlJob */
/** @typedef {import('./types/crawl.js').OutboundResult} OutboundResult */

// Core Web Vitals: types/vitals.js
/** @typedef {import('./types/vitals.js').LabMetrics} LabMetrics */
/** @typedef {import('./types/vitals.js').FieldMetric} FieldMetric */
/** @typedef {import('./types/vitals.js').FieldRecord} FieldRecord */
/** @typedef {import('./types/vitals.js').VitalsPage} VitalsPage */
/** @typedef {import('./types/vitals.js').VitalsData} VitalsData */

// Checks: types/checks.js
/** @typedef {import('./types/checks.js').InlinkRef} InlinkRef */
/** @typedef {import('./types/checks.js').CheckContext} CheckContext */
/** @typedef {import('./types/checks.js').CheckResult} CheckResult */
/** @typedef {import('./types/checks.js').CheckDef} CheckDef */
/** @typedef {import('./types/checks.js').Finding} Finding */
/** @typedef {import('./types/checks.js').FindingSource} FindingSource */
/** @typedef {import('./types/checks.js').CheckStat} CheckStat */
/** @typedef {import('./types/checks.js').ModuleScore} ModuleScore */
/** @typedef {import('./types/checks.js').AuditResult} AuditResult */

// Storage: types/run.js
/** @typedef {import('./types/run.js').RepoSummary} RepoSummary */
/** @typedef {import('./types/run.js').FixResult} FixResult */
/** @typedef {import('./types/run.js').FixVerification} FixVerification */
/** @typedef {import('./types/run.js').Run} Run */
/** @typedef {import('./types/run.js').RunIndexEntry} RunIndexEntry */
/** @typedef {import('./types/run.js').Profile} Profile */
