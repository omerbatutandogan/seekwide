import { once } from 'node:events';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createStdioServer } from '../../plugin/server/src/mcp/stdio.js';
import { validate } from '../../plugin/server/src/mcp/schema.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { makeDeps, sampleCrawl, jobFor, toolNamed } from './fakes.js';

const tools = createTools(makeDeps().deps);

/** @param {string} name @param {object} args */
const problems = (name, args) => validate(toolNamed(tools, name).inputSchema, args);

describe('createTools', () => {
  it('defines the thirteen tools in a fixed order with titles and descriptions', () => {
    assert.deepEqual(tools.map((tool) => tool.name), [
      'crawl_start', 'crawl_status', 'page_get', 'project_detect', 'audit_run', 'fix_plan', 'findings_query',
      'runs_list', 'runs_compare', 'search_data_import', 'report_render', 'profile_get', 'profile_set',
    ]);
    for (const tool of tools) {
      assert.ok(tool.title.length > 0 && tool.description.length > 0, tool.name);
    }
  });

  it('uses only schemas the MCP server accepts', () => {
    assert.doesNotThrow(() => createStdioServer({ name: 'seekwide', version: '0', tools, input: new PassThrough(), output: new PassThrough() }));
  });

  it('enforces the documented argument limits', () => {
    assert.deepEqual(problems('crawl_start', { url: 'https://a.test/', max_pages: 500 }), []);
    assert.deepEqual(problems('crawl_start', { url: 'https://a.test/', max_pages: 501 }), ['max_pages must be at most 500']);
    assert.deepEqual(problems('crawl_start', { url: 'https://a.test/', max_pages: 0 }), ['max_pages must be at least 1']);
    assert.deepEqual(problems('crawl_start', {}), ['url is required']);
    assert.deepEqual(problems('crawl_status', { job_id: 'c', wait_seconds: 26 }), ['wait_seconds must be at most 25']);
    assert.deepEqual(problems('audit_run', { job_id: 'c', modules: ['ads'] }), ['modules[0] must be one of "seo", "links", "security", "media", "smo", "aso", "ai"']);
    assert.deepEqual(problems('findings_query', { limit: 201 }), ['limit must be at most 200']);
    assert.deepEqual(problems('findings_query', { offset: -1 }), ['offset must be at least 0']);
    assert.deepEqual(problems('findings_query', { severity: 'urgent' }), ['severity must be one of "critical", "high", "medium", "low", "info"']);
    assert.deepEqual(problems('report_render', { executive_summary: 'x'.repeat(4001) }), ['executive_summary must be at most 4000 characters (got 4001)']);
    const recs = Array.from({ length: 21 }, () => ({ title: 't', detail: 'd' }));
    assert.deepEqual(problems('report_render', { recommendations: recs }), ['recommendations must have at most 20 items (got 21)']);
    assert.deepEqual(problems('report_render', { recommendations: [{ title: 't' }] }), ['recommendations[0].detail is required']);
    assert.deepEqual(problems('runs_list', { project: '/x' }), ['project is not an accepted argument']);
    assert.deepEqual(problems('profile_set', {}), ['profile is required']);
  });
});

describe('tools through the MCP server', () => {
  it('returns a tool result as compact JSON and a ToolError as isError', async () => {
    const crawl = sampleCrawl();
    const fake = makeDeps({ jobs: [jobFor(crawl, { status: 'running' })] });
    const input = new PassThrough();
    const output = new PassThrough();
    // Collect every chunk the server writes, rather than one read() at the end.
    /** @type {Buffer[]} */
    const chunks = [];
    output.on('data', (chunk) => chunks.push(chunk));
    const server = createStdioServer({ name: 'seekwide', version: '0', tools: createTools(fake.deps), input, output });
    server.start();
    const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { _meta: meta, name: 'audit_run', arguments: { job_id: 'c-1' } } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { _meta: meta, name: 'crawl_start', arguments: { url: 'https://example.test/' } } })}\n`);
    input.end();
    // The server closes itself once it has read the end of its input; wait for that, so the
    // two writes are delivered before the server stops reading, whatever Node's stream timing.
    await once(input, 'end');
    await server.close();
    const raw = Buffer.concat(chunks).toString('utf8');
    const responses = raw.trim().split('\n').map((line) => JSON.parse(line)).sort((a, b) => a.id - b.id);
    assert.deepEqual(responses.map((r) => r.id), [1, 2], raw);
    assert.equal(responses[0].result.isError, true, raw);
    assert.match(responses[0].result.content[0].text, /still running/);
    assert.equal(responses[1].result.isError, undefined);
    assert.equal(responses[1].result.content[0].text, '{"job_id":"c-new","status":"running","start_url":"https://example.test/","max_pages":25}');
  });
});
