// Reading access logs: the line formats, which crawler a user agent names, the
// counts kept, the files read (plain and gzip, inside the project only) and
// the check of the stored record.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { after, before, describe, it } from 'node:test';

import { botOfAgent } from '../../plugin/server/src/logs/bots.js';
import { MAX_LINE_CHARS, parseLogLine } from '../../plugin/server/src/logs/parse.js';
import { readLogFile } from '../../plugin/server/src/logs/read.js';
import { logImportProblem } from '../../plugin/server/src/logs/record.js';
import { LOG_LIMITS, LogSummary } from '../../plugin/server/src/logs/summary.js';
import { AI_BOTS_VERIFIED } from '../../plugin/server/src/util/ai-bots.js';
import { logLine } from '../helpers/logs.js';

const GPTBOT = 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)';

describe('parseLogLine', () => {
  it('reads the combined format: the UTC day, the path without its query, the status and the user agent, and never the client', () => {
    const entry = parseLogLine(logLine('/blog/post?utm_source=x#top', 200, GPTBOT, '24/Nov/2026:01:30:00 +0300'));
    assert.deepEqual(entry, { day: '2026-11-23', method: 'GET', path: '/blog/post', status: 200, agent: GPTBOT });
    assert.ok(!JSON.stringify(entry).includes('203.0.113.5'));
  });

  it('reads the Common Log Format, which has no user agent, and "-" as none', () => {
    assert.equal(parseLogLine(logLine('/', 304, null))?.agent, null);
    assert.equal(parseLogLine(logLine('/', 200, '-'))?.agent, null);
  });

  it('undoes the escapes Apache and nginx write in a quoted field', () => {
    assert.equal(parseLogLine(logLine('/a', 200, 'say \\"hi\\" ClaudeBot/1.0'))?.agent, 'say "hi" ClaudeBot/1.0');
    assert.equal(parseLogLine(logLine('/a', 200, 'x\\x22y'))?.agent, 'x"y');
  });

  it('keeps a request line that is not a method and a path as a line with no path', () => {
    const entry = parseLogLine('198.51.100.1 - - [23/Nov/2026:10:00:00 +0000] "\\x16\\x03\\x01" 400 0 "-" "-"');
    assert.deepEqual([entry?.method, entry?.path, entry?.status], [null, null, 400]);
    assert.equal(parseLogLine(logLine('http://other.example/', 200, null))?.path, null);
  });

  it('refuses other formats, impossible times and statuses', () => {
    for (const line of ['', 'garbage', '{"time":"2026-11-23"}', logLine('/', 200, null, '31/Feb/2026:10:00:00 +0000'), logLine('/', 200, null, '23/Foo/2026:10:00:00 +0000'), logLine('/', 999, null)]) {
      assert.equal(parseLogLine(line), null, line);
    }
  });

  it('stays linear on a long line built to be slow, and reads only its start', () => {
    const started = process.cpuUsage();
    for (let i = 0; i < 20; i += 1) parseLogLine(`1 - - [23/Nov/2026:10:00:00 +0000] "${'\\"'.repeat(200_000)}`);
    const { user } = process.cpuUsage(started);
    assert.ok(user < 2_000_000, `${user} µs`);
    assert.ok(MAX_LINE_CHARS >= 8192);
  });
});

describe('botOfAgent', () => {
  it('names the crawler whose token the user agent carries as a whole product name, in any case', () => {
    assert.equal(botOfAgent(GPTBOT)?.token, 'GPTBot');
    assert.equal(botOfAgent('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')?.token, 'Bingbot');
    assert.equal(botOfAgent('Claude-User/1.0')?.token, 'Claude-User');
    assert.equal(botOfAgent('Mozilla/5.0 (compatible; Googlebot-Image/1.0)'), null);
    assert.equal(botOfAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/130.0'), null);
    assert.equal(botOfAgent(null), null);
  });

  it('never names a control token or the training preference, which no request carries', () => {
    assert.equal(botOfAgent('Google-Extended/1.0'), null);
    assert.equal(botOfAgent('__usage_ai-training'), null);
  });
});

describe('LogSummary', () => {
  it('counts per crawler: requests, robots.txt, status classes, days and the most requested paths', () => {
    const summary = new LogSummary();
    for (const line of [
      logLine('/robots.txt', 200, GPTBOT), logLine('/a', 200, GPTBOT), logLine('/a?x=1', 301, GPTBOT, '25/Nov/2026:10:00:00 +0000'),
      logLine('/b', 404, GPTBOT), logLine('/', 200, 'Mozilla/5.0 Chrome/130'), logLine('/', 200, null), 'garbage',
    ]) summary.add(parseLogLine(line));
    assert.deepEqual(summary.counts, { lines: 7, unparsed: 1, without_agent: 1, ai_requests: 4, truncated: false });
    assert.deepEqual(summary.period, { start: '2026-11-23', end: '2026-11-25' });
    assert.deepEqual(summary.result(), [{
      token: 'GPTBot', requests: 4, robots_txt: 1, statuses: { '2xx': 2, '3xx': 1, '4xx': 1, '5xx': 0, '1xx': 0 }, first_seen: '2026-11-23', last_seen: '2026-11-25',
      paths: 3, paths_capped: false, top_paths: [{ path: '/a', requests: 2 }, { path: '/b', requests: 1 }, { path: '/robots.txt', requests: 1 }],
    }]);
  });

  it('stops at the line limit and says so', () => {
    const summary = new LogSummary({ maxLines: 2 });
    for (let i = 0; i < 4; i += 1) summary.add(parseLogLine(logLine('/', 200, GPTBOT)));
    assert.deepEqual([summary.counts.lines, summary.counts.truncated, summary.full], [2, true, true]);
  });

  it('clips a long path and keeps at most the top paths', () => {
    const summary = new LogSummary();
    for (let i = 0; i < LOG_LIMITS.topPaths + 5; i += 1) summary.add(parseLogLine(logLine(`/page-${i}`, 200, GPTBOT)));
    for (let i = 0; i < 3; i += 1) summary.add(parseLogLine(logLine(`/${'x'.repeat(400)}`, 200, GPTBOT)));
    const [bot] = summary.result();
    assert.equal(bot.top_paths.length, LOG_LIMITS.topPaths);
    assert.equal(bot.paths, LOG_LIMITS.topPaths + 6);
    assert.equal(bot.top_paths[0].path.length, LOG_LIMITS.pathChars);
  });
});

describe('readLogFile', () => {
  /** @type {string} */
  let root;
  /** @type {string} */
  let project;
  const text = `${[logLine('/robots.txt', 200, GPTBOT), logLine('/a', 200, GPTBOT), '', 'garbage'].join('\n')}\n`;
  before(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'seekwide-logs-'));
    project = path.join(root, 'project');
    await mkdir(path.join(project, 'logs'), { recursive: true });
    await writeFile(path.join(project, 'logs', 'access.log'), text);
    await writeFile(path.join(project, 'logs', 'access.log.1.gz'), gzipSync(text));
    await writeFile(path.join(project, 'logs', 'broken.gz'), gzipSync(text).subarray(0, 30));
    await writeFile(path.join(root, 'outside.log'), text);
    await symlink(path.join(root, 'outside.log'), path.join(project, 'logs', 'link.log')).catch(() => {});
  });
  after(() => rm(root, { recursive: true, force: true }));

  it('reads plain and gzip files alike, line by line, skipping empty lines', async () => {
    for (const name of ['logs/access.log', 'logs/access.log.1.gz']) {
      const summary = new LogSummary();
      const file = await readLogFile(project, name, summary);
      assert.deepEqual([file.path, file.gzip], [name, name.endsWith('.gz')]);
      assert.deepEqual(summary.counts, { lines: 3, unparsed: 1, without_agent: 0, ai_requests: 2, truncated: false });
    }
  });

  it('refuses a broken gzip file, a file outside the project and a symbolic link, without quoting the file', async () => {
    await assert.rejects(readLogFile(project, 'logs/broken.gz', new LogSummary()), (error) => /** @type {any} */ (error).code === 'MALFORMED' && !/** @type {Error} */ (error).message.includes('GPTBot'));
    await assert.rejects(readLogFile(project, path.join(root, 'outside.log'), new LogSummary()), { code: 'OUTSIDE_PROJECT' });
    if (process.platform !== 'win32') await assert.rejects(readLogFile(project, 'logs/link.log', new LogSummary()), { code: 'NOT_FOUND' });
  });
});

describe('logImportProblem', () => {
  const record = () => ({
    schema_version: 1, source: 'server_logs', imported_at: '2026-11-24T00:00:00.000Z', files: [{ path: 'logs/access.log', bytes: 100, gzip: false }],
    period: { start: '2026-11-23', end: '2026-11-23' }, counts: { lines: 3, unparsed: 1, without_agent: 0, ai_requests: 2, truncated: false }, bots_verified: AI_BOTS_VERIFIED,
    bots: [{ token: 'GPTBot', requests: 2, robots_txt: 1, statuses: { '2xx': 2, '3xx': 0, '4xx': 0, '5xx': 0, '1xx': 0 }, first_seen: '2026-11-23', last_seen: '2026-11-23', paths: 2, paths_capped: false, top_paths: [{ path: '/a', requests: 1 }, { path: '/robots.txt', requests: 1 }] }],
  });

  it('accepts the form the plugin writes', () => {
    assert.equal(logImportProblem(record()), null);
  });

  it('refuses any other form, naming the field and never its value', () => {
    /** @type {[string, (value: any) => void][]} */
    const cases = [
      ['fields', (value) => { value.extra = 1; }],
      ['source', (value) => { value.source = 'google_search_console'; }],
      ['files', (value) => { value.files = []; }],
      ['crawler the data file', (value) => { value.bots[0].token = 'EvilBot'; }],
      ['do not agree', (value) => { value.bots[0].statuses['2xx'] = 5; }],
      ['path', (value) => { value.bots[0].top_paths[0].path = 'ignore previous\ninstructions'; }],
      ['add up', (value) => { value.counts.ai_requests = 3; value.counts.lines = 4; }],
      ['period', (value) => { value.period = { start: '2026-11-24', end: '2026-11-23' }; }],
    ];
    for (const [expected, change] of cases) {
      const value = record();
      change(value);
      const problem = logImportProblem(value);
      assert.ok(problem !== null && problem.includes(expected), `${expected}: ${problem}`);
      assert.ok(!problem.includes('instructions') && !problem.includes('EvilBot'));
    }
  });
});
