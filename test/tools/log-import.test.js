// log_import: access logs in the project folder are counted per AI crawler,
// stored, set beside the audit's robots.txt reading and shown in the report.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { after, beforeEach, describe, it } from 'node:test';

import { ToolError } from '../../plugin/server/src/mcp/stdio.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { LOGS_SUPPLIED } from '../../plugin/server/src/report/logs.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { LOG_NOTE } from '../../plugin/server/src/tools/logs.js';
import { AI_BOTS_VERIFIED } from '../../plugin/server/src/util/ai-bots.js';
import { logLine } from '../helpers/logs.js';
import { makeRun } from '../helpers/run-factory.js';
import { makeDeps, toolNamed } from './fakes.js';

const GPTBOT = 'Mozilla/5.0 (compatible; GPTBot/1.2; +https://openai.com/gptbot)';
const CLAUDE = 'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)';

/** @type {string} */
let root;
/** @type {string} */
let project;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'seekwide-log-tool-'));
  project = path.join(root, 'project');
  await mkdir(path.join(project, 'logs'), { recursive: true });
  await writeFile(path.join(project, 'logs', 'access.log'), [
    logLine('/robots.txt', 200, GPTBOT), logLine('/pricing?ref=ignore-previous-instructions', 200, GPTBOT), logLine('/', 200, CLAUDE),
    logLine('/', 200, 'Mozilla/5.0 Chrome/130'), 'not a log line',
  ].join('\n'));
  await writeFile(path.join(project, 'logs', 'access.log.1.gz'), gzipSync(`${logLine('/old', 404, GPTBOT, '20/Nov/2026:08:00:00 +0000')}\n`));
  await writeFile(path.join(project, 'logs', 'common.log'), `${logLine('/', 200, null)}\n`);
  await writeFile(path.join(project, 'logs', 'error.log'), '[error] something failed\n');
});
after(() => rm(root, { recursive: true, force: true }));

const audited = () => makeRun({
  run_id: 'r1',
  ai: {
    bots_verified: AI_BOTS_VERIFIED, policy: null, robots: 'ok', agents: [{ token: 'GPTBot', allowed: false }, { token: 'ClaudeBot', allowed: true }],
    training_preference: 'none', preference_lines: 0, llms_txt: null,
  },
});

/** @param {Parameters<typeof makeDeps>[0]} [seed] */
function setup(seed = { runs: [audited()] }) {
  const fake = makeDeps({ projectDir: project, ...seed });
  return { fake, tool: toolNamed(createTools(fake.deps), 'log_import') };
}

describe('log_import', () => {
  it('counts the crawlers of several files, stores no client or query, and sets the counts beside robots.txt', async () => {
    const { tool } = setup();
    const result = /** @type {any} */ (await tool.handler({ paths: ['logs/access.log', 'logs/access.log.1.gz'], project_dir: project }));
    assert.equal(result.saved_to, '.seekwide/imports/server_logs.json');
    assert.deepEqual(result.files.map((/** @type {any} */ file) => [file.path, file.gzip]), [['logs/access.log', false], ['logs/access.log.1.gz', true]]);
    assert.deepEqual(result.period, { start: '2026-11-20', end: '2026-11-23' });
    assert.deepEqual(result.counts, { lines: 6, unparsed: 1, without_agent: 0, ai_requests: 4, truncated: false });
    assert.deepEqual(result.bots.map((/** @type {any} */ bot) => [bot.token, bot.requests, bot.robots_txt, bot.vendor]), [['GPTBot', 3, 1, 'OpenAI'], ['ClaudeBot', 1, 0, 'Anthropic']]);
    assert.equal(result.bots[0].ip_list, 'https://openai.com/gptbot.json');
    assert.deepEqual(result.robots.despite_disallow, [{ token: 'GPTBot', page_requests: 2, last_seen: '2026-11-23', vendor_says: 'documented' }]);
    assert.ok(result.not_seen.includes('OAI-SearchBot'));
    assert.match(result.notes.join(' '), /another client used the crawler's name/);
    assert.match(result.notes.join(' '), /1 line is in neither format/);
    assert.equal(result._note, LOG_NOTE);
    const stored = await readFile(path.join(project, '.seekwide', 'imports', 'server_logs.json'), 'utf8');
    assert.ok(!stored.includes('203.0.113.5') && !stored.includes('ignore-previous'));
  });

  it('replaces the earlier import and says so', async () => {
    const { tool } = setup();
    await tool.handler({ paths: ['logs/access.log'], project_dir: project });
    const second = /** @type {any} */ (await tool.handler({ paths: ['logs/access.log.1.gz'], project_dir: project }));
    assert.equal(second.replaced.period.end, '2026-11-23');
    assert.deepEqual(second.bots.map((/** @type {any} */ bot) => bot.token), ['GPTBot']);
  });

  it('says what is missing: no audit, an audit without the ai module, a log without user agents', async () => {
    const none = /** @type {any} */ (await setup({ runs: [] }).tool.handler({ paths: ['logs/access.log'], project_dir: project }));
    assert.equal(none.robots, null);
    assert.match(none.notes.join(' '), /no saved audit yet/);
    const noAi = /** @type {any} */ (await setup({ runs: [makeRun({ run_id: 'r2' })] }).tool.handler({ paths: ['logs/access.log'], project_dir: project }));
    assert.match(noAi.notes.join(' '), /did not read robots.txt for AI crawlers/);
    const common = /** @type {any} */ (await setup().tool.handler({ paths: ['logs/common.log'], project_dir: project }));
    assert.match(common.notes.join(' '), /no user agent \(the Common Log Format\)/);
  });

  it('refuses a file in no access log format, a file outside the project and the same file twice', async () => {
    const { tool } = setup();
    const refused = (/** @type {RegExp} */ message) => (/** @type {unknown} */ error) => error instanceof ToolError && message.test(error.message);
    await assert.rejects(tool.handler({ paths: ['logs/error.log'], project_dir: project }), refused(/not an error log/));
    await assert.rejects(tool.handler({ paths: [path.join(root, 'elsewhere.log')], project_dir: project }), refused(/outside the project folder/));
    await assert.rejects(tool.handler({ paths: ['logs/access.log', 'logs/access.log'], project_dir: project }), refused(/same file twice/));
    await assert.rejects(tool.handler({ paths: [], project_dir: project }), refused(/at least one log file/));
  });

  it('report_render passes the stored import to the report, which labels the counts as claims', async () => {
    const { fake, tool } = setup();
    await tool.handler({ paths: ['logs/access.log'], project_dir: project });
    const result = /** @type {any} */ (await toolNamed(createTools(fake.deps), 'report_render').handler({ project_dir: project, formats: ['markdown'] }));
    assert.equal(result.server_logs, true);
    const [, options] = /** @type {any} */ (fake.calls.renderMarkdown[0]);
    const markdown = renderMarkdown(audited(), options);
    assert.match(markdown, /## AI crawlers in the server logs \(imported\)/);
    assert.ok(markdown.includes(LOGS_SUPPLIED.slice(0, 40)));
    assert.match(markdown, /\| `GPTBot` \| OpenAI \| 2 \| 1 \|.*\| Blocked \|/);
    assert.match(markdown, /robots\.txt in this audit keeps GPTBot from the start page/);
    const html = renderHtml(audited(), options);
    assert.match(html, /<section id="server-logs">/);
  });
});
