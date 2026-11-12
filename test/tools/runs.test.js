import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ToolError } from '../../server/src/mcp/stdio.js';
import { LIMITS } from '../../server/src/config.js';
import { createTools } from '../../server/src/tools/index.js';
import { UNTRUSTED_NOTE } from '../../server/src/tools/common.js';
import { PROJECT, makeDeps, toolNamed } from './fakes.js';

/** @import { Finding, Run } from '../../server/src/types.js' */

/**
 * @param {string} id
 * @param {Partial<Finding>} [overrides]
 * @returns {Finding}
 */
function makeFinding(id, overrides = {}) {
  return {
    id, check_id: 'seo.title.missing', module: 'seo', engine: 'code', title: 'Title is missing', severity: 'high',
    weight: 4, impact: 3, effort: 1, confidence: 'confirmed', status: 'fail', url: `https://example.test/${id}`,
    selector: null, line: null, evidence: { observed: 'page text' }, related_urls: [], recommendation: 'Add a title.',
    fix: null, doc_ref: 'https://developers.google.com/search', detected_at: '2026-11-11T14:03:22.000Z', ...overrides,
  };
}

/**
 * @param {string} runId
 * @param {Finding[]} findings
 * @returns {Run}
 */
function makeRun(runId, findings) {
  return /** @type {Run} */ ({
    schema_version: 1, rules_version: '0.1.0', plugin_version: '0.1.0', run_id: runId, created_at: '2026-11-11T14:03:22.000Z',
    start_url: 'https://example.test/', site_origin: 'https://example.test', crawl: /** @type {any} */ ({}),
    modules_requested: ['seo'], modules: {}, checks: [], findings,
  });
}

const FINDINGS = [
  makeFinding('a'),
  makeFinding('b', { severity: 'medium', check_id: 'seo.h1.missing', url: 'https://example.test/Blog/post' }),
  makeFinding('c', { module: 'links', check_id: 'links.internal.broken', severity: 'medium' }),
  makeFinding('d', { url: null }),
];

/** @param {ReturnType<typeof makeDeps>} fake @param {string} name */
const tool = (fake, name) => toolNamed(createTools(fake.deps), name);

describe('findings_query', () => {
  it('returns the last run with defaults and the untrusted-text note', async () => {
    const fake = makeDeps({ runs: [makeRun('r1', []), makeRun('r2', FINDINGS)] });
    const result = await tool(fake, 'findings_query').handler({});
    assert.deepEqual(fake.calls.loadRun, [[PROJECT, 'last']]);
    assert.equal(result.run_id, 'r2');
    assert.equal(result.total, 4);
    assert.equal(result.returned, 4);
    assert.equal(result.next_offset, null);
    assert.equal(result._note, UNTRUSTED_NOTE);
  });

  it('filters by module, severity, check id and URL text', async () => {
    const fake = makeDeps({ runs: [makeRun('r2', FINDINGS)] });
    const query = tool(fake, 'findings_query').handler;
    assert.deepEqual((await query({ module: 'links' })).findings.map((/** @type {Finding} */ f) => f.id), ['c']);
    assert.deepEqual((await query({ severity: 'medium' })).findings.map((/** @type {Finding} */ f) => f.id), ['b', 'c']);
    assert.deepEqual((await query({ check_id: 'seo.title.missing' })).findings.map((/** @type {Finding} */ f) => f.id), ['a', 'd']);
    assert.deepEqual((await query({ url_contains: 'blog/' })).findings.map((/** @type {Finding} */ f) => f.id), ['b']);
  });

  it('pages with limit and offset', async () => {
    const many = Array.from({ length: 120 }, (_, i) => makeFinding(`f${i}`));
    const fake = makeDeps({ runs: [makeRun('r', many)] });
    const query = tool(fake, 'findings_query').handler;
    const first = await query({});
    assert.equal(first.returned, 50);
    assert.equal(first.next_offset, 50);
    const last = await query({ limit: 30, offset: 100 });
    assert.equal(last.returned, 20);
    assert.equal(last.findings[0].id, 'f100');
    assert.equal(last.next_offset, null);
  });

  it('clips long evidence strings and lists in the result, not in the stored run', async () => {
    const big = makeFinding('big', {
      evidence: { observed: 'x'.repeat(5_000_000), expected: Array.from({ length: 300 }, (_, i) => `title ${i}`), detail: { nested: ['y'.repeat(1000)] } },
    });
    const fake = makeDeps({ runs: [makeRun('r', [big])] });
    const result = await tool(fake, 'findings_query').handler({});
    const evidence = result.findings[0].evidence;
    assert.equal(evidence.observed.length, LIMITS.maxStringLength);
    assert.equal(evidence.expected.length, 10);
    assert.equal(evidence.detail.nested[0].length, LIMITS.maxStringLength);
    assert.ok(JSON.stringify(result).length < 10_000);
    assert.equal(fake.runs[0].findings[0].evidence.observed.length, 5_000_000);
  });

  it('explains a missing run and rejects malformed run ids', async () => {
    const fake = makeDeps();
    await assert.rejects(tool(fake, 'findings_query').handler({ run_id: 'r9' }), (error) =>
      error instanceof ToolError && error.message === 'Run r9 was not found. Call runs_list to see the saved runs, or audit_run to create one.');
    await assert.rejects(tool(fake, 'findings_query').handler({ run_id: '../../etc' }), (error) => error instanceof ToolError && /Invalid run id/.test(error.message));
  });
});

describe('runs_list', () => {
  it('lists runs newest first and clips to 50', async () => {
    const runs = Array.from({ length: 55 }, (_, i) => makeRun(`r${String(i).padStart(2, '0')}`, []));
    const fake = makeDeps({ runs });
    const result = await tool(fake, 'runs_list').handler({ project_dir: '/x' });
    assert.equal(result.project_dir, '/x');
    assert.equal(result.total, 55);
    assert.equal(result.runs.length, 50);
    assert.equal(result.runs[0].run_id, 'r54');
    assert.equal(result.runs[49].run_id, 'r05');
  });

  it('returns an empty list for a project without runs', async () => {
    const result = await tool(makeDeps(), 'runs_list').handler({});
    assert.deepEqual(result, { project_dir: PROJECT, total: 0, runs: [], _note: UNTRUSTED_NOTE });
  });
});

describe('runs_compare', () => {
  it('compares last with previous by default and clips the lists', async () => {
    const base = makeRun('r1', [makeFinding('old1'), makeFinding('old2'), makeFinding('same')]);
    const current = makeRun('r2', [makeFinding('same'), makeFinding('new1')]);
    const fake = makeDeps({ runs: [base, current] });
    const result = await tool(fake, 'runs_compare').handler({ limit: 1 });
    assert.equal(result.base_run_id, 'r1');
    assert.equal(result.run_id, 'r2');
    assert.equal(result.resolved_total, 2);
    assert.equal(result.added_total, 1);
    assert.equal(result.persisting, 1);
    assert.equal(result.resolved.length, 1);
    assert.deepEqual(result.added, [{ id: 'new1', check_id: 'seo.title.missing', severity: 'high', title: 'Title is missing', url: 'https://example.test/new1', selector: null }]);
    assert.equal(result._note, UNTRUSTED_NOTE);
  });

  it('defaults the limit to 20', async () => {
    const fake = makeDeps({ runs: [makeRun('r1', Array.from({ length: 30 }, (_, i) => makeFinding(`x${i}`))), makeRun('r2', [])] });
    const result = await tool(fake, 'runs_compare').handler({});
    assert.equal(result.resolved.length, 20);
    assert.equal(result.resolved_total, 30);
  });

  it('"previous" means the newest run older than the run being compared', async () => {
    const runs = ['r1', 'r2', 'r3'].map((id) => makeRun(id, [makeFinding(id)]));
    const fake = makeDeps({ runs });
    const middle = await tool(fake, 'runs_compare').handler({ run_id: 'r2' });
    assert.equal(middle.base_run_id, 'r1');
    assert.equal(middle.run_id, 'r2');
    const newest = await tool(fake, 'runs_compare').handler({ run_id: 'r3', base_run_id: 'previous' });
    assert.equal(newest.base_run_id, 'r2');
    await assert.rejects(tool(fake, 'runs_compare').handler({ run_id: 'r1' }), (error) =>
      error instanceof ToolError && error.message === 'No saved run is older than r1, so there is no previous run to compare it with. Pass base_run_id with another run id from runs_list.');
    const explicit = await tool(fake, 'runs_compare').handler({ run_id: 'r1', base_run_id: 'r3' });
    assert.equal(explicit.base_run_id, 'r3');
  });

  it('explains when there is no previous run or both refs name the same run', async () => {
    const one = makeDeps({ runs: [makeRun('r1', [])] });
    await assert.rejects(tool(one, 'runs_compare').handler({}), /No saved run is older than r1/);
    const two = makeDeps({ runs: [makeRun('r1', []), makeRun('r2', [])] });
    await assert.rejects(tool(two, 'runs_compare').handler({ run_id: 'r1', base_run_id: 'r1' }), /both name run r1/);
  });
});
