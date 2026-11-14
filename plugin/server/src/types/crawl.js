// A crawl and its parts (ARCHITECTURE.md 4.2 to 4.5). No runtime code.

/** @import { PageRecord } from './page.js' */

export {};

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
 * @property {string} [redirected_to]  robots_unreachable only: where robots.txt redirected, when the crawl
 *   refused to request that address (another origin in a crawl of a site on this machine, or an address
 *   that is not public).
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
 * @property {{max_pages: number, rate_per_sec: number, include_subdomains: boolean, local?: boolean, deployed_origin?: string, deployed_localized?: number}} options
 *   `local` is true when the audited site is on this machine (the crawl was allowed to reach loopback).
 *   Such a site is never named to an outside service. `deployed_origin` is set for a local crawl that was told
 *   where the project is deployed: canonicals and sitemap entries on that origin were read as local addresses.
 *   `deployed_localized` counts them (pages with such a canonical, Sitemap lines and sitemap entries); 0 means
 *   the address given matched nothing.
 * @property {RobotsSummary} robots
 * @property {SitemapSummary} sitemap
 * @property {HttpProbe|null} http_probe   Null when the site is not https or the probe was not possible.
 * @property {PageRecord[]} pages      In fetch order, which is deterministic.
 * @property {string[]} robots_blocked URLs skipped because robots.txt disallows them (max 200).
 * @property {string[]} [disallowed_links]  Targets of internal links marked nofollow on the recorded pages that the robots.txt of
 *   their origin, as read during the crawl, does not allow the crawler to request; sorted, at most 2000. Absent in crawls made
 *   before rule set 0.1.5.
 * @property {boolean} truncated       True when the page limit, the size limit or the time limit stopped the crawl before the frontier was empty.
 * @property {boolean} [time_limit_reached]  True when the crawl stopped at `LIMITS.crawlMaxMs` with URLs left to fetch; absent otherwise.
 * @property {CrawlBlock|null} blocked Set when the crawl had to stop.
 * @property {string} user_agent
 * @property {Record<string, boolean>} [preview_agents]  For each link-preview crawler that says it obeys robots.txt
 *   (`PREVIEW_CRAWLERS`), whether the site's robots.txt lets it fetch the start page. Absent when robots.txt could not be
 *   read, when no start page was recorded, and in crawls made before rule set 0.1.9.
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
