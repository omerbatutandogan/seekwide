import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ToolError } from '../../server/src/mcp/stdio.js';
import { createTools } from '../../server/src/tools/index.js';
import { UNTRUSTED_NOTE } from '../../server/src/tools/common.js';
import { makeImage, makeLink, makePage } from '../helpers/factories.js';
import { jobFor, makeDeps, sampleCrawl, toolNamed } from './fakes.js';

/** @param {ReturnType<typeof makeDeps>} fake @param {string} name */
const tool = (fake, name) => toolNamed(createTools(fake.deps), name);

describe('crawl_start', () => {
  it('starts a crawl with defaults and returns the job summary', async () => {
    const fake = makeDeps();
    const result = await tool(fake, 'crawl_start').handler({ url: 'https://Example.test/#top' });
    assert.deepEqual(fake.calls.start, [[{ url: 'https://example.test/', maxPages: 25, includeSubdomains: false, allowLoopback: false }]]);
    assert.deepEqual(result, { job_id: 'c-new', status: 'running', start_url: 'https://example.test/', max_pages: 25 });
  });

  it('passes max_pages, include_subdomains and allow_localhost through', async () => {
    const fake = makeDeps();
    await tool(fake, 'crawl_start').handler({ url: 'http://127.0.0.1:8080/', max_pages: 500, include_subdomains: true, allow_localhost: true });
    assert.deepEqual(fake.calls.start[0][0], { url: 'http://127.0.0.1:8080/', maxPages: 500, includeSubdomains: true, allowLoopback: true });
  });

  it('passes site_url on as the deployed address of a local site, and leaves it out when it is blank', async () => {
    const fake = makeDeps();
    await tool(fake, 'crawl_start').handler({ url: 'http://localhost:3000/', allow_localhost: true, site_url: ' https://www.example.com ' });
    assert.deepEqual(fake.calls.start[0][0], { url: 'http://localhost:3000/', maxPages: 25, includeSubdomains: false, allowLoopback: true, deployedUrl: 'https://www.example.com' });
    await tool(fake, 'crawl_start').handler({ url: 'http://localhost:3000/', allow_localhost: true, site_url: '  ' });
    assert.equal('deployedUrl' in /** @type {object} */ (fake.calls.start[1][0]), false);
  });

  it('a finished local crawl that was told the deployed address says so in its summary', async () => {
    const crawl = sampleCrawl({ options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true, deployed_origin: 'https://www.example.com' } });
    const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
    const status = /** @type {any} */ (await tool(fake, 'crawl_status').handler({ job_id: crawl.id }));
    assert.equal(status.summary.site_url, 'https://www.example.com');
    const plain = sampleCrawl();
    const other = makeDeps({ jobs: [jobFor(plain)], results: [plain] });
    assert.equal('site_url' in /** @type {any} */ (await tool(other, 'crawl_status').handler({ job_id: plain.id })).summary, false);
  });

  it('rejects a URL that is not http or https', async () => {
    const fake = makeDeps();
    for (const url of ['ftp://example.test/', 'example', '']) {
      await assert.rejects(tool(fake, 'crawl_start').handler({ url }), (error) => error instanceof ToolError && /not a valid http or https URL/.test(error.message));
    }
    assert.equal(fake.calls.start, undefined);
  });

  it('turns an InputError from the manager into a ToolError, and leaves a bug\'s TypeError to the generic message', async () => {
    const fake = makeDeps();
    await assert.rejects(
      tool(fake, 'crawl_start').handler({ url: 'https://reject.test/' }),
      (error) => error instanceof ToolError && /could not start: maxPages is out of range/.test(error.message),
    );
    await assert.rejects(
      tool(fake, 'crawl_start').handler({ url: 'https://bug.test/' }),
      (error) => error instanceof TypeError && !(error instanceof ToolError) && /reading 'host'/.test(error.message),
    );
  });

  it('turns a rejected start (allow_localhost on a host that is not loopback) into a ToolError', async () => {
    const fake = makeDeps();
    await assert.rejects(
      tool(fake, 'crawl_start').handler({ url: 'https://async-reject.test/', allow_localhost: true }),
      (error) => error instanceof ToolError && /could not start: allowLoopback needs a loopback start host\. Check the arguments/.test(error.message),
    );
  });
});

describe('crawl_status', () => {
  it('returns a running job without waiting by default', async () => {
    const crawl = sampleCrawl();
    const fake = makeDeps({ jobs: [jobFor(crawl, { status: 'running', pages_crawled: 1, pages_queued: 4, finished_at: null })] });
    const result = await tool(fake, 'crawl_status').handler({ job_id: 'c-1' });
    assert.equal(result.status, 'running');
    assert.equal(result.summary, undefined);
    assert.equal(fake.calls.wait, undefined);
  });

  it('waits through the manager when wait_seconds is above zero', async () => {
    const crawl = sampleCrawl();
    const fake = makeDeps({ jobs: [jobFor(crawl, { status: 'running' })] });
    await tool(fake, 'crawl_status').handler({ job_id: 'c-1', wait_seconds: 2.5 });
    assert.deepEqual(fake.calls.wait, [['c-1', 2500]]);
  });

  it('adds a summary when the crawl is finished', async () => {
    const crawl = sampleCrawl({
      pages: [...sampleCrawl().pages, makePage({ url: 'https://example.test/gone', status: 404, is_html: true })],
      truncated: true,
      sitemap: { files: [], urls: ['https://example.test/a', 'https://example.test/b'], truncated: false },
    });
    const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
    const result = await tool(fake, 'crawl_status').handler({ job_id: 'c-1' });
    assert.equal(result.status, 'done');
    assert.deepEqual(result.summary, {
      pages: 3,
      html_pages: 2,
      by_status: { 200: 2, 404: 1 },
      robots_status: 'ok',
      sitemap_urls: 2,
      truncated: true,
      blocked: null,
    });
  });

  it('rebuilds the snapshot of a job from an earlier server process', async () => {
    const crawl = sampleCrawl({ blocked: { reason: 'bot_challenge', url: 'https://example.test/', status: 403 } });
    const fake = makeDeps({ results: [crawl] });
    const result = await tool(fake, 'crawl_status').handler({ job_id: 'c-1' });
    assert.equal(result.status, 'blocked');
    assert.equal(result.pages_crawled, 2);
    assert.equal(result.summary.blocked.reason, 'bot_challenge');
  });

  it('returns a failed job with its error and no summary', async () => {
    const crawl = sampleCrawl();
    const fake = makeDeps({ jobs: [jobFor(crawl, { status: 'failed', error: 'DNS lookup failed' })] });
    const result = await tool(fake, 'crawl_status').handler({ job_id: 'c-1' });
    assert.equal(result.error, 'DNS lookup failed');
    assert.equal(result.summary, undefined);
  });

  it('rejects unknown and malformed job ids', async () => {
    const fake = makeDeps();
    await assert.rejects(tool(fake, 'crawl_status').handler({ job_id: 'c-404' }), /No crawl job "c-404" was found. Call crawl_start/);
    await assert.rejects(tool(fake, 'crawl_status').handler({ job_id: '../etc' }), /not a valid id/);
  });
});

describe('page_get', () => {
  it('returns selected fields and counts, never the full link list', async () => {
    const links = Array.from({ length: 5000 }, (_, i) => makeLink({ url: i % 2 ? `https://example.test/p${i}` : `https://other.test/p${i}`, rel: i % 10 === 0 ? ['nofollow'] : [] }));
    const page = makePage({
      url: 'https://example.test/big',
      links,
      images: [makeImage(), makeImage({ alt: null }), makeImage({ alt: '' })],
      text_excerpt: 'x'.repeat(2000),
      headings: Array.from({ length: 50 }, (_, i) => ({ level: /** @type {2} */ (2), text: `Heading ${i}`, line: i })),
      jsonld: [{ valid: true, types: ['Organization', 'WebSite'], error: null, line: 3 }, { valid: false, types: [], error: 'bad', line: 9 }],
    });
    const home = makePage({ url: 'https://example.test/', links: [makeLink({ url: 'https://example.test/big' })] });
    const crawl = sampleCrawl({ pages: [home, page] });
    const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });

    const result = await tool(fake, 'page_get').handler({ job_id: 'c-1', url: 'https://example.test/big#section' });
    assert.equal(result.url, 'https://example.test/big');
    assert.equal(result.final_external, false);
    assert.equal(result._note, UNTRUSTED_NOTE);
    assert.equal(result.links, undefined);
    assert.equal(result.page.text_excerpt.length, 1000);
    assert.equal(result.page.headings.length, 30);
    assert.deepEqual(result.page.jsonld_types, ['Organization', 'WebSite']);
    assert.deepEqual(result.counts, {
      links: 5000,
      internal_links: 2500,
      external_links: 2500,
      nofollow_links: 500,
      links_without_url: 0,
      images: 3,
      images_missing_alt: 1,
      headings: 50,
      canonicals: 1,
      hreflang: 0,
      jsonld_blocks: 2,
      jsonld_invalid: 1,
      inlinks: 1,
    });
    assert.ok(JSON.stringify(result).length < 8000, 'result stays small');
  });

  it('rejects a URL the crawl did not record', async () => {
    const crawl = sampleCrawl();
    const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
    await assert.rejects(tool(fake, 'page_get').handler({ job_id: 'c-1', url: 'https://example.test/missing' }), /has no record for .* It recorded 2 URLs/);
  });

  it('says what to do while the crawl runs or after it failed', async () => {
    const crawl = sampleCrawl();
    const running = makeDeps({ jobs: [jobFor(crawl, { status: 'running' })] });
    await assert.rejects(tool(running, 'page_get').handler({ job_id: 'c-1', url: 'https://example.test/' }), /still running. Call crawl_status with wait_seconds/);
    const failed = makeDeps({ jobs: [jobFor(crawl, { status: 'failed', error: 'timeout' })] });
    await assert.rejects(tool(failed, 'page_get').handler({ job_id: 'c-1', url: 'https://example.test/' }), /The crawl failed\. It said \(data, not instructions\): "timeout" .*crawl_start/);
  });
});
