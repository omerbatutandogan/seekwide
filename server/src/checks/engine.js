/** @import { CheckContext, CheckDef, CheckResult, CheckStat, CrawlResult, Finding, AuditResult, InlinkRef, OutboundResult, PageRecord, VitalsData } from '../types.js' */

import { LIMITS, SEVERITIES } from '../config.js';
import { shortId } from '../util/hash.js';
import { scoreModules } from './scoring.js';

const SKIP_REASONS = {
  full_crawl: 'Needs a complete crawl. This crawl stopped at the page limit or was blocked.',
  sitemap: 'Needs an XML sitemap. None was found.',
  robots: 'Needs a readable robots.txt.',
  outbound: 'Needs external link checks. They were not run.',
  lab_data: 'Needs lab data from PageSpeed Insights. It was not collected.',
  field_data: 'Needs field data from the Chrome UX Report. It was not collected.',
  live_site: 'Needs the deployed site: this crawl was of a server on this machine, whose response headers say nothing about the live site.',
};

/**
 * Build the read-only view that checks run against.
 * @param {CrawlResult} crawl
 * @param {{outbound?: Map<string, OutboundResult>|null, vitals?: VitalsData|null}} [extras]
 *   What was collected besides the crawl: external link results and Core Web Vitals.
 * @returns {CheckContext}
 */
export function buildContext(crawl, extras = {}) {
  const pages = crawl.pages;
  /** @type {Map<string, PageRecord>} */
  const pageByUrl = new Map();
  for (const page of pages) {
    if (!pageByUrl.has(page.url)) pageByUrl.set(page.url, page);
  }

  const htmlPages = pages.filter((page) => page.status === 200 && page.is_html);
  const indexablePages = pages.filter((page) => page.indexability.indexable);

  /** @type {Map<string, InlinkRef[]>} */
  const inlinks = new Map();
  for (const page of htmlPages) {
    for (const link of page.links) {
      if (!link.internal || link.url === null) continue;
      const list = inlinks.get(link.url);
      if (list) list.push({ from: page.url, link });
      else inlinks.set(link.url, [{ from: page.url, link }]);
    }
  }

  const outbound = extras.outbound ?? null;
  const capabilities = new Set();
  if (!crawl.truncated && crawl.blocked === null) capabilities.add('full_crawl');
  if (crawl.sitemap.urls.length > 0) capabilities.add('sitemap');
  if (crawl.robots.status === 'ok') capabilities.add('robots');
  if (outbound !== null) capabilities.add('outbound');
  if (crawl.options.local !== true) capabilities.add('live_site');

  // Core Web Vitals come from outside services that can refuse or have nothing
  // to say; the collector's own reason is what a skipped check reports.
  const vitals = extras.vitals ?? null;
  /** @type {Record<string, string>} */
  const skipReasons = {};
  if (vitals !== null) {
    if (vitals.lab.available) capabilities.add('lab_data');
    else if (vitals.lab.reason) skipReasons.lab_data = vitals.lab.reason;
    if (vitals.field.available) capabilities.add('field_data');
    else if (vitals.field.reason) skipReasons.field_data = vitals.field.reason;
  }

  /** @param {string} url */
  const resolve = (url) => {
    let record = pageByUrl.get(url);
    // A redirect record already points at the end of its chain, so one hop is
    // normally enough; the loop guards against a chain that was cut short.
    for (let hop = 0; hop < LIMITS.maxRedirects + 1; hop += 1) {
      if (!record || record.final_url === record.url) break;
      const next = pageByUrl.get(record.final_url);
      if (!next) return undefined;
      record = next;
    }
    return record;
  };

  return {
    crawl,
    pages,
    htmlPages,
    indexablePages,
    pageByUrl,
    inlinks,
    sitemapUrls: new Set(crawl.sitemap.urls),
    site: {
      origin: crawl.site_origin,
      host: crawl.site_host,
      https: crawl.site_origin.startsWith('https://'),
      start_url: crawl.start_url,
    },
    capabilities,
    skipReasons,
    outbound,
    vitals,
    resolve,
  };
}

/**
 * @param {unknown} result
 * @param {CheckDef} check
 * @returns {asserts result is CheckResult}
 */
function assertResult(result, check) {
  const r = /** @type {Partial<CheckResult>|null} */ (result);
  if (r === null || typeof r !== 'object') {
    throw new TypeError(`${check.id} returned a non-object result`);
  }
  if (r.status !== 'pass' && r.status !== 'fail') {
    throw new TypeError(`${check.id} returned a result with status ${JSON.stringify(r.status)}`);
  }
  if (r.url !== null && typeof r.url !== 'string') {
    throw new TypeError(`${check.id} returned a result without a url (use null for site-level results)`);
  }
}

/**
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 */
function compareStrings(a, b) {
  const left = a ?? '';
  const right = b ?? '';
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/**
 * Run checks against a crawl and turn failures into findings.
 *
 * The output depends only on the inputs: checks run in id order, findings are
 * sorted, and the timestamp comes from the caller.
 *
 * @param {CheckDef[]} checks
 * @param {CheckContext} ctx
 * @param {{modules?: string[], detectedAt: string}} options
 * @returns {AuditResult}
 */
export function runChecks(checks, ctx, options) {
  const selected = checks
    .filter((check) => !options.modules || options.modules.includes(check.module))
    .sort((a, b) => compareStrings(a.id, b.id));

  /** @type {CheckStat[]} */
  const stats = [];
  /** @type {Finding[]} */
  const findings = [];

  for (const check of selected) {
    const missing = check.requires.filter((capability) => !ctx.capabilities.has(capability));
    if (missing.length > 0) {
      const reason = missing
        .map((capability) => ctx.skipReasons[capability] ?? SKIP_REASONS[/** @type {keyof typeof SKIP_REASONS} */ (capability)] ?? `Needs ${capability}.`)
        .join(' ');
      stats.push({ id: check.id, module: check.module, status: 'skipped', skip_reason: reason, applicable: 0, passed: 0, failed: 0 });
      continue;
    }

    /** @type {CheckResult[]} */
    let results;
    try {
      results = check.run(ctx);
      if (!Array.isArray(results)) throw new TypeError(`${check.id} did not return an array`);
      for (const result of results) assertResult(result, check);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stats.push({ id: check.id, module: check.module, status: 'error', skip_reason: `Check failed to run: ${message}`, applicable: 0, passed: 0, failed: 0 });
      continue;
    }

    const failures = results
      .filter((result) => result.status === 'fail')
      .sort((a, b) => compareStrings(a.url, b.url) || compareStrings(a.selector, b.selector));

    stats.push({
      id: check.id,
      module: check.module,
      status: 'run',
      skip_reason: null,
      applicable: results.length,
      passed: results.length - failures.length,
      failed: failures.length,
    });

    /** @type {Map<string, number>} */
    const seen = new Map();
    for (const failure of failures) {
      const baseId = shortId(check.id, failure.url ?? '', failure.selector ?? '');
      const repeat = seen.get(baseId) ?? 0;
      seen.set(baseId, repeat + 1);
      findings.push({
        // Two failures with the same URL and selector get distinct, still stable ids.
        id: repeat === 0 ? baseId : shortId(check.id, failure.url ?? '', failure.selector ?? '', String(repeat)),
        check_id: check.id,
        module: check.module,
        engine: 'code',
        title: check.title,
        severity: check.severity,
        weight: check.weight,
        impact: check.impact,
        effort: check.effort,
        confidence: check.confidence,
        status: 'fail',
        url: failure.url,
        selector: failure.selector ?? null,
        line: failure.line ?? null,
        evidence: failure.evidence ?? {},
        related_urls: (failure.related_urls ?? []).slice(0, LIMITS.maxRelatedUrls),
        recommendation: check.recommendation,
        fix: failure.fix ?? null,
        doc_ref: check.doc_ref,
        detected_at: options.detectedAt,
      });
    }
  }

  findings.sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      compareStrings(a.check_id, b.check_id) ||
      compareStrings(a.url, b.url) ||
      compareStrings(a.selector, b.selector) ||
      compareStrings(a.id, b.id),
  );

  return { findings, checks: stats, modules: scoreModules(stats, selected) };
}
