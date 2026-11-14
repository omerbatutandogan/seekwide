// Builders for the data shapes in plugin/server/src/types.js, for unit tests.
// Each builder returns a valid object with sensible defaults; pass only the
// fields a test cares about.

/** @import { CrawlResult, FieldRecord, LabMetrics, LinkRecord, ImageRecord, PageRecord, PageSecurity, SecurityHeaders, VitalsData } from '../../plugin/server/src/types.js' */

const SITE = 'https://example.test';

/**
 * @param {Partial<LinkRecord> & {url: string}} overrides
 * @returns {LinkRecord}
 */
export function makeLink(overrides) {
  return {
    href: overrides.url,
    text: 'Link text',
    aria_label: null,
    title_attr: null,
    rel: [],
    internal: overrides.url.startsWith(SITE),
    has_onclick: false,
    line: null,
    ...overrides,
  };
}

/**
 * @param {Partial<ImageRecord>} [overrides]
 * @returns {ImageRecord}
 */
export function makeImage(overrides = {}) {
  return {
    src: '/img/photo.jpg',
    url: `${SITE}/img/photo.jpg`,
    alt: 'A photo',
    width: '800',
    height: '600',
    loading: null,
    has_srcset: false,
    line: null,
    ...overrides,
  };
}

/**
 * Security headers that pass every header check.
 * @param {Partial<SecurityHeaders>} [overrides]
 * @returns {SecurityHeaders}
 */
export function makeSecurityHeaders(overrides = {}) {
  return {
    hsts_max_age: 31_536_000,
    nosniff: true,
    csp: 'header',
    frame_ancestors: ["'self'"],
    x_frame_options: [],
    referrer_policy: 'strict-origin-when-cross-origin',
    ...overrides,
  };
}

/**
 * The security signals of a clean English page: nothing hidden, nothing
 * loaded from another host, no spam terms, Latin text, every header set.
 * @param {Partial<PageSecurity>} [overrides]
 * @returns {PageSecurity}
 */
export function makeSecurity(overrides = {}) {
  return {
    hidden_links: [], visible_hosts: [], embeds: [], spam_terms: {}, topic_terms: {}, scripts: { latin: 1200 }, headers: makeSecurityHeaders(), ...overrides,
  };
}

/**
 * An indexable 200 HTML page with complete, valid metadata.
 * @param {Partial<PageRecord>} [overrides]
 * @returns {PageRecord}
 */
export function makePage(overrides = {}) {
  const url = overrides.url ?? `${SITE}/`;
  return {
    url,
    status: 200,
    final_url: url,
    final_status: overrides.status ?? 200,
    final_external: false,
    redirect_chain: [],
    depth: 0,
    discovered_via: ['link'],
    content_type: 'text/html',
    headers: { 'content-type': 'text/html; charset=utf-8' },
    is_html: true,
    bytes: 2048,
    fetch_ms: 10,
    fetch_error: null,
    html_lang: 'en',
    titles: [`Page title for ${url}`],
    meta_descriptions: [`A description that is unique to ${url}.`],
    meta_robots: [],
    x_robots: [],
    canonicals: [{ href: url, url, source: 'html', in_head: true, line: 5 }],
    hreflang: [],
    headings: [{ level: 1, text: `Heading for ${url}`, line: 10 }],
    viewport: 'width=device-width, initial-scale=1',
    og: {},
    twitter: {},
    links: [],
    images: [],
    jsonld: [],
    mixed_content: [],
    word_count: 300,
    text_hash: `hash-of-${url}`,
    text_excerpt: `Body text of ${url}`,
    indexability: { indexable: true, reasons: [] },
    security: makeSecurity(),
    videos: [],
    video_embeds: [],
    video_markup: false,
    social: { outside_head: [], streamed: false, head_end: { bytes: 1024, by: 'head' }, app_banners: [], rel_me: [] },
    ...overrides,
  };
}

/**
 * A record for a URL that redirects to `to`.
 * @param {string} url
 * @param {string} to
 * @param {Partial<PageRecord>} [overrides]
 * @returns {PageRecord}
 */
export function makeRedirect(url, to, overrides = {}) {
  return makePage({
    url,
    status: 301,
    final_url: to,
    final_status: 200,
    redirect_chain: [{ url, status: 301, location: to }],
    content_type: null,
    is_html: false,
    titles: [],
    meta_descriptions: [],
    canonicals: [],
    headings: [],
    viewport: null,
    html_lang: null,
    word_count: 0,
    text_hash: '',
    text_excerpt: '',
    indexability: { indexable: false, reasons: ['redirect'] },
    ...overrides,
  });
}

/**
 * A complete, unblocked crawl of `pages` on https://example.test.
 * @param {Partial<CrawlResult> & {pages?: PageRecord[]}} [overrides]
 * @returns {CrawlResult}
 */
export function makeCrawl(overrides = {}) {
  return {
    schema_version: 1,
    id: 'crawl-test',
    start_url: `${SITE}/`,
    site_origin: SITE,
    site_host: 'example.test',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:00:30.000Z',
    options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: false },
    robots: {
      status: 'ok',
      http_status: 200,
      url: `${SITE}/robots.txt`,
      sitemaps: [],
      crawl_delay_sec: null,
      disallows_all: false,
      disallows_all_googlebot: false,
    },
    sitemap: { loaded: true, files: [], urls: [], truncated: false },
    http_probe: { url: 'http://example.test/', status: 301, final_url: `${SITE}/`, enforced: true },
    pages: [],
    robots_blocked: [],
    truncated: false,
    blocked: null,
    user_agent: 'seekwide/test',
    ...overrides,
  };
}

/**
 * Lab metrics of one page, all in the good range.
 * @param {Partial<LabMetrics>} [overrides]
 * @returns {LabMetrics}
 */
export function makeLab(overrides = {}) {
  return { lcp_ms: 1800, cls: 0.02, tbt_ms: 120, lighthouse_version: '12.8.2', final_url: null, ...overrides };
}

/**
 * A Chrome UX Report record, all in the good range.
 * @param {Partial<FieldRecord>} [overrides]
 * @returns {FieldRecord}
 */
export function makeField(overrides = {}) {
  return {
    lcp_ms: { p75: 2100, good: 0.82 },
    inp_ms: { p75: 150, good: 0.9 },
    cls: { p75: 0.05, good: 0.93 },
    period: { first: '2026-10-12', last: '2026-11-08' },
    ...overrides,
  };
}

/**
 * Core Web Vitals with lab and field data, all good, for the start page of `SITE`.
 * @param {Partial<VitalsData>} [overrides]
 * @returns {VitalsData}
 */
export function makeVitals(overrides = {}) {
  return {
    lab: { available: true, reason: null, device: 'mobile' },
    field: { available: true, reason: null, form_factor: 'phone' },
    origin: { origin: SITE, field: makeField(), field_note: null },
    pages: [{ url: `${SITE}/`, why: 'Start page', lab: makeLab(), lab_note: null, field: makeField(), field_note: null }],
    notes: [],
    ...overrides,
  };
}

export { SITE };
