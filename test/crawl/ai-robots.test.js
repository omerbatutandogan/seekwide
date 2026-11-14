import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_AI_PAGES, aiRobots } from '../../plugin/server/src/crawl/ai-robots.js';
import { loadRobots } from '../../plugin/server/src/net/robots.js';
import { SITE, makePage } from '../helpers/factories.js';
import { fetchResult } from '../net/fake-fetch.js';

/** @param {string} text */
const robotsOf = (text) => loadRobots(SITE, { fetch: async (url) => fetchResult(url, { text }) });

test('every known crawler is asked about the start page with its own token and its fallbacks', async () => {
  const robots = await robotsOf('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /\n');
  const ai = aiRobots(robots, SITE, [makePage()]);
  assert.ok(ai);
  assert.deepEqual(ai.agents.Applebot, { allowed: false, group: 'fallback' }, 'Applebot follows the Googlebot rules');
  assert.deepEqual(ai.agents.GPTBot, { allowed: true, group: 'star' });
  assert.equal(ai.agents.__usage_ai_training, undefined);
  assert.deepEqual(ai.policy, { group: 'none', allowed: null });
});

test('pages a counted crawler may not read are listed, for the first html pages of the site only', async () => {
  const robots = await robotsOf('User-agent: PerplexityBot\nDisallow: /docs/\n\nUser-agent: OAI-SearchBot\nDisallow: /\n');
  const pages = [makePage(), makePage({ url: `${SITE}/docs/a` }), makePage({ url: 'https://sub.example.test/docs/b' })];
  const ai = aiRobots(robots, SITE, pages);
  assert.deepEqual(ai?.blocked_pages, { PerplexityBot: [`${SITE}/docs/a`] }, 'OAI-SearchBot is blocked everywhere, so it is not partial');
  assert.equal(ai?.pages_asked, 2);
  const many = Array.from({ length: MAX_AI_PAGES + 50 }, (_, i) => makePage({ url: `${SITE}/docs/${i}` }));
  assert.equal(aiRobots(robots, SITE, [makePage(), ...many])?.pages_asked, MAX_AI_PAGES);
});

test('nothing is recorded without a start page on the file\'s origin', async () => {
  const robots = await robotsOf('User-agent: *\nAllow: /\n');
  assert.equal(aiRobots(robots, SITE, []), null);
  assert.equal(aiRobots(robots, SITE, [makePage({ url: 'https://other.test/' })]), null);
});

test('a hostile robots.txt of many wildcard rules stays bounded', async () => {
  const rules = Array.from({ length: 4000 }, (_, i) => `Disallow: /*a*b*c*d*${i}*`).join('\n');
  const robots = await robotsOf(`User-agent: *\n${rules}\n`);
  const pages = Array.from({ length: MAX_AI_PAGES }, (_, i) => makePage({ url: `${SITE}/${'a'.repeat(60)}/${i}` }));
  const started = performance.now();
  aiRobots(robots, SITE, pages);
  assert.ok(performance.now() - started < 15_000);
});

test('a robots.txt that refused this crawler (418, 403, 401) leaves AI access unknown; 404 and 410 mean no file', async () => {
  for (const status of [418, 403, 401]) {
    const refused = await loadRobots(SITE, { fetch: async (url) => fetchResult(url, { status, text: 'User-agent: GPTBot\nDisallow: /\n' }) });
    assert.equal(refused.summary.status, 'missing', 'the crawler itself reads it as no file (RFC 9309)');
    assert.equal(aiRobots(refused, SITE, [makePage()]), null, `HTTP ${status}`);
  }
  for (const status of [404, 410]) {
    const absent = await loadRobots(SITE, { fetch: async (url) => fetchResult(url, { status }) });
    assert.equal(aiRobots(absent, SITE, [makePage()])?.agents.GPTBot.allowed, true, `HTTP ${status}`);
  }
});
