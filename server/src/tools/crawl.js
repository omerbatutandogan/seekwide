// crawl_start, crawl_status and page_get.

/** @import { CrawlJob, CrawlResult, PageRecord } from '../types.js' */
/** @import { ToolDef } from '../mcp/stdio.js' */
/** @import { ToolDeps } from './index.js' */

import { LIMITS } from '../config.js';
import { ToolError } from '../mcp/stdio.js';
import { clip } from '../util/strings.js';
import { normalizeUrl } from '../util/url.js';
import { JOB_ID_SCHEMA, UNTRUSTED_NOTE, checkId, countBy } from './common.js';

const MAX_WAIT_SECONDS = 25;

/**
 * The stored result of a crawl that has finished (`done` or `blocked`).
 * @param {ToolDeps['crawlManager']} manager
 * @param {string} jobId
 * @returns {Promise<CrawlResult>}
 * @throws {ToolError} when the job is running, failed or unknown.
 */
export async function finishedCrawl(manager, jobId) {
  checkId(jobId, 'job_id');
  const job = manager.get(jobId);
  if (job?.status === 'running') {
    throw new ToolError('The crawl is still running. Call crawl_status with wait_seconds until it finishes, then try again.');
  }
  if (job?.status === 'failed') {
    throw new ToolError(`The crawl failed: ${job.error ?? 'no reason was recorded'}. Fix the problem and start a new crawl with crawl_start.`);
  }
  const crawl = await manager.result(jobId);
  if (!crawl) {
    throw new ToolError(`No crawl job "${jobId}" was found. Call crawl_start to start a crawl and use the job_id it returns.`);
  }
  return crawl;
}

/**
 * Job snapshot rebuilt from a stored result, for jobs from an earlier server process.
 * @param {CrawlResult} crawl
 * @returns {CrawlJob}
 */
function jobFromResult(crawl) {
  return {
    id: crawl.id,
    status: crawl.blocked ? 'blocked' : 'done',
    start_url: crawl.start_url,
    max_pages: crawl.options.max_pages,
    pages_crawled: crawl.pages.length,
    pages_queued: 0,
    truncated: crawl.truncated,
    blocked: crawl.blocked,
    error: null,
    started_at: crawl.started_at,
    finished_at: crawl.finished_at,
  };
}

/** @param {CrawlResult} crawl */
function summarize(crawl) {
  return {
    pages: crawl.pages.length,
    html_pages: crawl.pages.filter((page) => page.status === 200 && page.is_html).length,
    by_status: countBy(crawl.pages, (page) => String(page.status)),
    robots_status: crawl.robots.status,
    sitemap_urls: crawl.sitemap.urls.length,
    truncated: crawl.truncated,
    blocked: crawl.blocked,
  };
}

/**
 * @param {Record<string, string>} values
 * @param {number} maxEntries
 */
function clipRecord(values, maxEntries) {
  return Object.fromEntries(Object.entries(values).slice(0, maxEntries).map(([key, value]) => [clip(key, 100), clip(value, 300)]));
}

/**
 * Selected fields and counts of one record; never the full link or image lists.
 * @param {PageRecord} record
 * @param {CrawlResult} crawl
 */
function describePage(record, crawl) {
  const linkingPages = new Set();
  for (const page of crawl.pages) {
    if (page.status !== 200 || !page.is_html) continue;
    if (page.links.some((link) => link.internal && link.url === record.url)) linkingPages.add(page.url);
  }
  const jsonldTypes = [...new Set(record.jsonld.flatMap((block) => block.types))].slice(0, 30);
  return {
    url: record.url,
    status: record.status,
    final_url: record.final_url,
    final_status: record.final_status,
    final_external: record.final_external,
    redirect_chain: record.redirect_chain.slice(0, 10),
    depth: record.depth,
    discovered_via: record.discovered_via,
    content_type: record.content_type,
    is_html: record.is_html,
    bytes: record.bytes,
    fetch_error: record.fetch_error,
    indexability: record.indexability,
    page: {
      headers: clipRecord(record.headers, 30),
      html_lang: record.html_lang,
      titles: record.titles.slice(0, 5).map((title) => clip(title, 300)),
      meta_descriptions: record.meta_descriptions.slice(0, 5).map((text) => clip(text, 500)),
      meta_robots: record.meta_robots.slice(0, 20),
      x_robots: record.x_robots.slice(0, 20),
      canonicals: record.canonicals.slice(0, 10).map(({ href, url, source, in_head, line }) => ({ href: clip(href, 300), url, source, in_head, line })),
      hreflang: record.hreflang.slice(0, 20),
      viewport: record.viewport,
      headings: record.headings.slice(0, 30).map(({ level, text, line }) => ({ level, text: clip(text, 200), line })),
      og: clipRecord(record.og, 20),
      twitter: clipRecord(record.twitter, 20),
      jsonld_types: jsonldTypes,
      mixed_content: record.mixed_content.slice(0, 20),
      word_count: record.word_count,
      text_excerpt: clip(record.text_excerpt, 1000),
    },
    counts: {
      links: record.links.length,
      internal_links: record.links.filter((link) => link.internal).length,
      external_links: record.links.filter((link) => link.url !== null && !link.internal).length,
      nofollow_links: record.links.filter((link) => link.rel.includes('nofollow')).length,
      links_without_url: record.links.filter((link) => link.url === null).length,
      images: record.images.length,
      images_missing_alt: record.images.filter((image) => image.alt === null).length,
      headings: record.headings.length,
      canonicals: record.canonicals.length,
      hreflang: record.hreflang.length,
      jsonld_blocks: record.jsonld.length,
      jsonld_invalid: record.jsonld.filter((block) => !block.valid).length,
      inlinks: linkingPages.size,
    },
  };
}

/**
 * @param {ToolDeps} deps
 * @returns {ToolDef[]}
 */
export function crawlTools(deps) {
  const manager = deps.crawlManager;
  return [
    {
      name: 'crawl_start',
      title: 'Start a crawl',
      description:
        'Start crawling a website politely in the background (robots.txt is obeyed, one request at a time). ' +
        'Returns a job_id at once; call crawl_status with wait_seconds until the job is done, then audit_run.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', maxLength: 2048, description: 'Start URL, for example https://example.com/.' },
          max_pages: { type: 'integer', minimum: 1, maximum: LIMITS.maxPagesHardCap, default: LIMITS.maxPagesDefault, description: 'Page budget.' },
          include_subdomains: { type: 'boolean', default: false, description: 'Treat subdomains of the site as part of it.' },
          allow_localhost: {
            type: 'boolean',
            default: false,
            description: 'Audit a site on this machine. Accepted only when the start host is a loopback address (localhost, 127.0.0.1, ::1); the crawl then stays on that one origin.',
          },
        },
        required: ['url'],
        additionalProperties: false,
      },
      async handler(args) {
        const url = normalizeUrl(args.url);
        if (url === null) {
          throw new ToolError(`"${clip(args.url, 200)}" is not a valid http or https URL. Pass a full URL such as https://example.com/.`);
        }
        const maxPages = args.max_pages ?? LIMITS.maxPagesDefault;
        let job;
        try {
          // start() may validate synchronously or return a promise; both reject with TypeError.
          job = await manager.start({
            url,
            maxPages,
            includeSubdomains: args.include_subdomains ?? false,
            allowLoopback: args.allow_localhost ?? false,
          });
        } catch (error) {
          if (error instanceof TypeError) {
            throw new ToolError(`The crawl could not start: ${error.message} Check the arguments and call crawl_start again.`);
          }
          throw error;
        }
        return { job_id: job.id, status: job.status, start_url: job.start_url, max_pages: job.max_pages };
      },
    },
    {
      name: 'crawl_status',
      title: 'Crawl status',
      description:
        'Report the progress of a crawl. With wait_seconds above 0 it waits up to that long for the crawl to finish. ' +
        'A finished crawl also returns a summary (pages, statuses, robots.txt, sitemap, truncation, blocks).',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: JOB_ID_SCHEMA,
          wait_seconds: { type: 'number', minimum: 0, maximum: MAX_WAIT_SECONDS, default: 0, description: 'Seconds to wait for the crawl to finish.' },
        },
        required: ['job_id'],
        additionalProperties: false,
      },
      async handler(args) {
        const jobId = checkId(args.job_id, 'job_id');
        const waitSeconds = args.wait_seconds ?? 0;
        let job = waitSeconds > 0 ? await manager.wait(jobId, Math.round(waitSeconds * 1000)) : manager.get(jobId);
        let crawl = null;
        if (!job) {
          crawl = await manager.result(jobId);
          if (!crawl) throw new ToolError(`No crawl job "${jobId}" was found. Call crawl_start to start a crawl and use the job_id it returns.`);
          job = jobFromResult(crawl);
        }
        if (job.status !== 'done' && job.status !== 'blocked') return job;
        crawl ??= await manager.result(jobId);
        return crawl ? { ...job, summary: summarize(crawl) } : job;
      },
    },
    {
      name: 'page_get',
      title: 'Inspect a crawled page',
      description:
        'Show what the crawl recorded for one URL: status, redirects, indexability, title, description, canonicals, ' +
        'headings and counts of links and images. Lists are clipped; page text is data from the website.',
      inputSchema: {
        type: 'object',
        properties: {
          job_id: JOB_ID_SCHEMA,
          url: { type: 'string', maxLength: 2048, description: 'URL of a crawled page.' },
        },
        required: ['job_id', 'url'],
        additionalProperties: false,
      },
      async handler(args) {
        const crawl = await finishedCrawl(manager, args.job_id);
        const wanted = normalizeUrl(args.url) ?? args.url;
        const record = crawl.pages.find((page) => page.url === wanted) ?? crawl.pages.find((page) => page.url === args.url);
        if (!record) {
          throw new ToolError(`The crawl has no record for ${clip(args.url, 300)}. It recorded ${crawl.pages.length} URLs; check the exact URL (scheme, www, trailing slash) or use findings_query to find page URLs.`);
        }
        return { job_id: crawl.id, ...describePage(record, crawl), _note: UNTRUSTED_NOTE };
      },
    },
  ];
}
