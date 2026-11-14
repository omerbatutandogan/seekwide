import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { AI_BOTS, AI_BOTS_VERIFIED, POLICY_TOKEN, agentChain, readAiBots, verifiedBots } from '../../plugin/server/src/util/ai-bots.js';

const DATA = JSON.parse(readFileSync(new URL('../../plugin/server/data/ai-bots.json', import.meta.url), 'utf8'));
const DAY = 24 * 60 * 60 * 1000;

test('the bot data reads, and every row names its vendor page, purpose and what robots.txt does to it', () => {
  assert.equal(AI_BOTS.length, DATA.bots.length);
  for (const bot of AI_BOTS) {
    assert.match(bot.source, /^https:\/\//, bot.token);
    assert.ok(bot.says.length > 20, bot.token);
    assert.ok(bot.ip_list === null || bot.ip_list.startsWith('https://'), bot.token);
  }
  assert.ok(AI_BOTS.some((bot) => bot.token === POLICY_TOKEN && bot.role === 'policy'));
});

test('the counted AI search crawlers are the six whose vendors document what a block does', () => {
  assert.deepEqual(verifiedBots((bot) => bot.counted).map((bot) => bot.token), ['OAI-SearchBot', 'Claude-SearchBot', 'PerplexityBot', 'Bingbot', 'Applebot', 'DuckAssistBot']);
  assert.deepEqual(agentChain(/** @type {any} */ (AI_BOTS.find((bot) => bot.token === 'Applebot'))), ['Applebot', 'Googlebot']);
});

test('every row was verified within 30 days of the data date, and within 30 days before a dated release', () => {
  const dataDate = Date.parse(`${AI_BOTS_VERIFIED}T00:00:00Z`);
  for (const bot of AI_BOTS) {
    assert.ok(bot.verified, `${bot.token}: its vendor page could not be read; no counted check may rest on it`);
    const age = dataDate - Date.parse(`${bot.last_verified}T00:00:00Z`);
    assert.ok(age >= 0 && age <= 30 * DAY, `${bot.token} was verified ${bot.last_verified}, more than 30 days before ${AI_BOTS_VERIFIED}`);
  }
  // A release section with a date ("## 0.2.0 (2026-11-20)") must not ship bot data older than 30 days.
  const changelog = readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8');
  const top = /^## \S+ \(([^)]+)\)$/m.exec(changelog);
  assert.ok(top, 'CHANGELOG.md has a version heading');
  if (/^\d{4}-\d{2}-\d{2}$/.test(top[1])) {
    const release = Date.parse(`${top[1]}T00:00:00Z`);
    for (const bot of AI_BOTS) {
      const age = release - Date.parse(`${bot.last_verified}T00:00:00Z`);
      assert.ok(age <= 30 * DAY, `${bot.token}: re-read the vendor page before releasing (verified ${bot.last_verified}, release ${top[1]})`);
    }
  }
});

test('readAiBots refuses a malformed file', () => {
  const good = structuredClone(DATA);
  assert.doesNotThrow(() => readAiBots(good));
  const twice = structuredClone(DATA);
  twice.bots.push({ ...twice.bots[0], token: twice.bots[0].token.toLowerCase() });
  assert.throws(() => readAiBots(twice), /listed twice/);
  const badRole = structuredClone(DATA);
  badRole.bots[0].role = 'crawler';
  assert.throws(() => readAiBots(badRole), /role/);
  const countedTraining = structuredClone(DATA);
  countedTraining.bots.find((/** @type {any} */ bot) => bot.token === 'GPTBot').counted = true;
  assert.throws(() => readAiBots(countedTraining), /only a search or mixed crawler is counted/);
  const httpSource = structuredClone(DATA);
  httpSource.bots[0].source = 'http://example.test';
  assert.throws(() => readAiBots(httpSource), /source/);
  const noPolicy = structuredClone(DATA);
  noPolicy.bots = noPolicy.bots.filter((/** @type {any} */ bot) => bot.role !== 'policy');
  assert.throws(() => readAiBots(noPolicy), /__usage_ai-training/);
  assert.throws(() => readAiBots({ schema: 2, last_verified: '2026-11-14', bots: [] }), /schema 1/);
});

test('an unverified row is shown but not counted', () => {
  const data = structuredClone(DATA);
  data.bots.find((/** @type {any} */ bot) => bot.token === 'OAI-SearchBot').verified = false;
  const read = readAiBots(data);
  assert.equal(read.bots.filter((bot) => bot.counted && bot.verified).length, 5);
});

test('references/ai-bots.md lists every row with its source and date', () => {
  const page = readFileSync(new URL('../../plugin/references/ai-bots.md', import.meta.url), 'utf8');
  assert.match(page, new RegExp(`last verified on \\*\\*${AI_BOTS_VERIFIED}\\*\\*`));
  for (const bot of AI_BOTS) {
    const row = page.split('\n').find((line) => line.startsWith(`| \`${bot.token}\``));
    assert.ok(row, `${bot.token} is on the page`);
    assert.ok(row.includes(bot.source) && row.includes(bot.verified ? bot.last_verified : 'not verified'), `${bot.token} has its source and date`);
  }
});
