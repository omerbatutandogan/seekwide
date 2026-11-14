import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDictionary, readContentSignal, readContentUsage } from '../../plugin/server/src/net/ai-prefs.js';
import { loadRobots } from '../../plugin/server/src/net/robots.js';
import { MAX_PREFERENCE_LINES, parseRobotsTxt } from '../../plugin/server/src/net/robots-parse.js';
import { fetchResult } from './fake-fetch.js';

test('parseDictionary reads a Structured Field Dictionary and refuses what is not one', () => {
  assert.deepEqual([...(parseDictionary('train-ai=y, search=n') ?? [])], [['train-ai', 'y'], ['search', 'n']]);
  assert.deepEqual([...(parseDictionary('train-ai=n;note="x", ai-use, x=(a b);p=1, n=-1.5') ?? [])], [['train-ai', 'n'], ['ai-use', '?1'], ['x', '()'], ['n', '-1.5']]);
  for (const bad of ['', 'Train-AI=n', 'train-ai = n', 'train-ai=n,', 'train-ai=n;;', '=n', 'a="open', 'a=:Ymlu:', 'a=(b']) {
    assert.equal(parseDictionary(bad), null, bad);
  }
});

test('readContentUsage: a path, then a usage preference whose known labels take y or n; unknown labels are ignored', () => {
  assert.deepEqual(readContentUsage('train-ai=n'), { valid: true, problem: null, values: { 'train-ai': 'n' }, path: null });
  assert.deepEqual(readContentUsage('/ai-ok/ train-ai=y'), { valid: true, problem: null, values: { 'train-ai': 'y' }, path: '/ai-ok/' });
  assert.deepEqual(readContentUsage('future-use=n, search=y').values, { search: 'y' });
  assert.deepEqual(readContentUsage('train-ai=maybe'), { valid: false, problem: 'value', values: {}, path: null });
  assert.deepEqual(readContentUsage('train-ai: no'), { valid: false, problem: 'syntax', values: {}, path: null });
  assert.equal(readContentUsage('TRAIN-AI=N').problem, 'syntax');
});

test('readContentSignal: name=value pairs; Cloudflare\'s signals take their values; other names are left alone', () => {
  assert.deepEqual(readContentSignal('search=yes, ai-train=no, use=reference'), { valid: true, problem: null, values: { search: 'yes', 'ai-train': 'no', use: 'reference' } });
  assert.deepEqual(readContentSignal('Search=Yes').values, { search: 'yes' });
  assert.equal(readContentSignal('ai-train=nope').problem, 'value');
  assert.equal(readContentSignal('ai-train').problem, 'syntax');
  assert.equal(readContentSignal('').problem, 'syntax');
  assert.equal(readContentSignal('custom=1').valid, true);
});

test('a hostile value is read in linear time', () => {
  const long = `${'a'.repeat(400)}=${'b'.repeat(400)}${', x'.repeat(5000)}`;
  const started = performance.now();
  for (let i = 0; i < 200; i += 1) {
    readContentUsage(long);
    readContentSignal(long);
    readContentUsage(`train-ai=(${' a'.repeat(5000)}`);
  }
  assert.ok(performance.now() - started < 2000);
});

test('robots.txt keeps the first preference lines, clipped, without changing groups', () => {
  const lines = Array.from({ length: MAX_PREFERENCE_LINES + 5 }, (_, i) => `Content-Usage: train-ai=n${i === 0 ? 'x'.repeat(600) : ''}`);
  const parsed = parseRobotsTxt(['User-agent: *', 'Allow: /', ...lines, 'Content-Signal: search=yes', 'User-agent: GPTBot', 'Disallow: /'].join('\n'));
  assert.equal(parsed.preferences.content_usage.length, MAX_PREFERENCE_LINES);
  assert.equal(parsed.preferences.content_usage[0].length, 500);
  assert.deepEqual(parsed.preferences.content_signal, ['search=yes']);
  assert.equal(parsed.preferences.lines, MAX_PREFERENCE_LINES + 6);
  assert.deepEqual(parsed.groups.get('gptbot')?.rules, [{ pattern: '/', allow: false }]);
});

/** @param {string} text */
const robotsOf = (text) => loadRobots('https://example.test', { fetch: async (url) => fetchResult(url, { text }) });

test('the shared training token is read from its own group only, never from *', async () => {
  const star = await robotsOf('User-agent: *\nDisallow: /\n');
  assert.deepEqual([star.preference('__usage_ai-training').group, star.preference('__usage_ai-training').allows('https://example.test/')], ['none', null]);
  const own = await robotsOf('User-Agent: __usage_ai-training\nDisallow: /\nAllow: /ok/\n');
  assert.equal(own.preference('__usage_ai-training').group, 'rules');
  assert.equal(own.preference('__usage_ai-training').allows('https://example.test/'), false);
  assert.equal(own.preference('__usage_ai-training').allows('https://example.test/ok/a'), true);
  assert.equal(own.preference('__usage_ai-training').allows('https://other.test/'), null);
  const emptyValue = await robotsOf('User-Agent: __usage_ai-training\nDisallow:\n');
  assert.deepEqual([emptyValue.preference('__usage_ai-training').group, emptyValue.preference('__usage_ai-training').allows('https://example.test/')], ['rules', true]);
  const named = await robotsOf('User-Agent: __usage_ai-training\nCrawl-delay: 1\n');
  assert.equal(named.preference('__usage_ai-training').group, 'empty');
});

test('agentGroup says which group decides for a crawler and its fallbacks', async () => {
  // A User-agent line with no rule after it, at the end of the file: the file names ClaudeBot without a group.
  const robots = await robotsOf('User-agent: Googlebot\nDisallow: /x\n\nUser-agent: *\nDisallow: /private\n\nUser-agent: ClaudeBot\n');
  assert.equal(robots.agentGroup(['Googlebot']), 'own');
  assert.equal(robots.agentGroup(['Applebot', 'Googlebot']), 'fallback');
  assert.equal(robots.agentGroup(['ClaudeBot']), 'named');
  assert.equal(robots.agentGroup(['GPTBot']), 'star');
  const none = await robotsOf('User-agent: Googlebot\nDisallow: /x\n');
  assert.equal(none.agentGroup(['GPTBot']), 'none');
  const missing = await loadRobots('https://example.test', { fetch: async (url) => fetchResult(url, { status: 404 }) });
  assert.deepEqual([missing.agentGroup(['GPTBot']), missing.preference('__usage_ai-training').group, missing.preferences.lines], ['none', 'none', 0]);
});
