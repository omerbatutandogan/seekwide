// The real entry point as a child process: both protocol styles over stdin and
// stdout, nothing but protocol lines on stdout, and exit when stdin closes.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

import { startServer } from '../helpers/http-server.js';

const ENTRY = fileURLToPath(new URL('../../server/src/index.js', import.meta.url));
const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'process-test', version: '1.0.0' },
};

/** @type {string} */
let tmp;
before(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'seekwide-proc-'));
});
after(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/**
 * Start the real entry point as a child process and talk to it over stdio.
 * @param {Record<string, string>} [extraEnv]
 */
function startProcess(extraEnv = {}) {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: tmp,
    env: {
      PATH: process.env.PATH,
      HOME: tmp,
      SEEKWIDE_DATA_DIR: path.join(tmp, 'data'),
      CLAUDE_PROJECT_DIR: tmp,
      // What .mcp.json passes when the plugin settings are not filled in.
      SEEKWIDE_REPORT_BRAND: '${user_config.report_brand_name}',
      SEEKWIDE_REPORT_LOGO: '',
      SEEKWIDE_GOOGLE_API_KEY: '${user_config.google_api_key}',
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));

  /** @type {string[]} */
  const lines = [];
  /** @type {Map<string|number, (message: any) => void>} */
  const waiting = new Map();
  const io = { buffer: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    io.buffer += chunk;
    let newline = io.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = io.buffer.slice(0, newline);
      io.buffer = io.buffer.slice(newline + 1);
      lines.push(line);
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message);
      newline = io.buffer.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    io.stderr += chunk;
  });

  /** @param {Record<string, unknown>} message @returns {Promise<any>} */
  const request = (message) => {
    const answer = new Promise((resolve) => waiting.set(/** @type {string|number} */ (message.id), resolve));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    return answer;
  };
  /** @param {any} response */
  const toolResult = (response) => {
    assert.equal(response.result.isError, undefined, response.result.content?.[0]?.text);
    return JSON.parse(response.result.content[0].text);
  };
  /** Close stdin and wait for the server to exit on its own. */
  const close = async () => {
    child.stdin.end();
    /** @type {NodeJS.Timeout|undefined} */
    let timer;
    const { code, signal } = /** @type {{code: number|null, signal: string|null}} */ (
      await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(() => resolve({ code: null, signal: 'timeout' }), 10_000); })])
    );
    clearTimeout(timer);
    if (signal === 'timeout') child.kill('SIGKILL');
    assert.equal(signal, null, 'the server exits on its own when stdin closes');
    assert.equal(code, 0, io.stderr);
  };
  return { child, lines, io, request, toolResult, close };
}

test('the server speaks both protocol styles over stdio and exits when stdin closes', async () => {
  const { child, lines, io, request, toolResult, close } = startProcess();

  // 2026-07-28: no handshake, per-request _meta.
  const discover = await request({ id: 'd', method: 'server/discover', params: { _meta: META } });
  assert.deepEqual(discover.result.supportedVersions, ['2026-07-28']);
  assert.equal(discover.result._meta['io.modelcontextprotocol/serverInfo'].name, 'seekwide');
  assert.match(discover.result.instructions, /crawl_start/);

  const modernList = await request({ id: 1, method: 'tools/list', params: { _meta: META } });
  assert.equal(modernList.result.resultType, 'complete');
  assert.equal(modernList.result.tools.length, 11);

  const runs = toolResult(await request({ id: 2, method: 'tools/call', params: { _meta: META, name: 'runs_list', arguments: {} } }));
  assert.deepEqual(runs, { project_dir: tmp, total: 0, runs: [] });

  // Handshake style (2025-11-25 and earlier).
  const init = await request({ id: 3, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const legacyList = await request({ id: 4, method: 'tools/list' });
  assert.equal(legacyList.result.resultType, undefined);
  assert.deepEqual(
    legacyList.result.tools.map((/** @type {any} */ tool) => tool.name),
    modernList.result.tools.map((/** @type {any} */ tool) => tool.name),
  );

  const profile = toolResult(await request({ id: 5, method: 'tools/call', params: { name: 'profile_get', arguments: {} } }));
  assert.deepEqual(profile, { exists: false, profile: null });

  const unknown = await request({ id: 6, method: 'resources/list' });
  assert.equal(unknown.error.code, -32601);

  await close();

  assert.equal(io.buffer, '', 'stdout ends with a complete line');
  assert.equal(lines.length, 7);
  for (const line of lines) {
    const message = JSON.parse(line);
    assert.equal(message.jsonrpc, '2.0');
    assert.ok('result' in message || 'error' in message, line);
  }
});

test('with a Google API key set, nothing the server writes contains it: no tool result, log line or stored file', async () => {
  const KEY = 'fake-ProcessTestKey-0123456789_abcdefghij';
  const site = await startServer({
    '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' },
    '/': { body: '<!doctype html><html lang="en"><head><title>Home page of the site</title></head><body><h1>Home</h1><p>Some text.</p></body></html>' },
  });
  // The most verbose log level, so anything the server would ever log is written.
  const { lines, io, request, toolResult, close } = startProcess({ SEEKWIDE_GOOGLE_API_KEY: KEY, SEEKWIDE_LOG: 'debug' });
  try {
    await request({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'key-test', version: '1' } } });
    /** @param {number} id @param {string} name @param {Record<string, unknown>} args */
    const call = async (id, name, args) => toolResult(await request({ id, method: 'tools/call', params: { name, arguments: args } }));

    // A site on this machine is audited, so the measurement runs with the key bound in but sends nothing to Google.
    const started = await call(2, 'crawl_start', { url: `${site.origin}/`, allow_localhost: true, max_pages: 1 });
    let status = await call(3, 'crawl_status', { job_id: started.job_id, wait_seconds: 25 });
    for (let id = 4; status.status === 'running'; id += 1) status = await call(id, 'crawl_status', { job_id: started.job_id, wait_seconds: 25 });
    assert.equal(status.status, 'done', JSON.stringify(status));

    const audit = await call(20, 'audit_run', { job_id: started.job_id, modules: ['seo'] });
    assert.equal(audit.core_web_vitals.lab.available, false);
    assert.match(audit.core_web_vitals.lab.reason, /Nothing was sent to Google\.$/);
    const report = await call(21, 'report_render', {});
    await call(22, 'findings_query', {});
    await call(23, 'page_get', { job_id: started.job_id, url: `${site.origin}/` });
    await call(24, 'runs_list', {});

    await close();
    assert.ok(!lines.join('\n').includes(KEY), 'a tool result or protocol message contains the key');
    assert.ok(!io.stderr.includes(KEY), 'a log line contains the key');
    const written = (await readdir(tmp, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile());
    assert.ok(written.some((entry) => entry.name === 'findings.json') && written.some((entry) => entry.name === path.basename(report.files.html)));
    for (const entry of written) {
      const content = await readFile(path.join(entry.parentPath, entry.name), 'utf8');
      assert.ok(!content.includes(KEY), `${entry.name} contains the key`);
    }
    assert.ok(site.requests.every((seen) => !JSON.stringify(seen.headers).includes(KEY)), 'the audited site was sent the key');
  } finally {
    await site.close();
  }
});
