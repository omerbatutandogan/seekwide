import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeProfile } from '../../plugin/server/src/store/profile-validate.js';
import { storedRunProblem } from '../../plugin/server/src/store/run-validate.js';
import {
  LLMS_NOT_ASKED, LLMS_REFUSED, POLICY_NO_SITE_URL, POLICY_OTHER_SITE, aiNotes, aiSummary, collectAi, policyFor, searchCrawlerCount,
} from '../../plugin/server/src/tools/audit-ai.js';
import { SITE, makeCrawl, makePage } from '../helpers/factories.js';
import { makeRun } from '../helpers/run-factory.js';

/** @import { AiRobots, Profile } from '../../plugin/server/src/types.js' */

/** @param {Partial<Profile>} overrides @returns {Profile} */
const profile = (overrides) => ({ schema_version: 1, site_url: SITE, brand: { name: 'Acme' }, updated_at: '2026-11-14T00:00:00.000Z', ...overrides });

/** @returns {AiRobots} */
const robots = () => ({
  url: `${SITE}/`, status: 'ok',
  agents: { 'OAI-SearchBot': { allowed: false, group: 'own' }, PerplexityBot: { allowed: true, group: 'star' }, GPTBot: { allowed: false, group: 'own' } },
  policy: { group: 'rules', allowed: false }, pages_asked: 1, blocked_pages: {}, content_usage: [], content_signal: [], preference_lines: 2,
});

test('the profile sets the AI policy: one of three values, or null for not stated', () => {
  const base = { site_url: 'https://example.com', brand: { name: 'Acme' } };
  assert.equal(normalizeProfile({ ...base, ai_policy: 'allow_search' }).profile?.ai_policy, 'allow_search');
  assert.equal(normalizeProfile({ ...base, ai_policy: null }).profile?.ai_policy, undefined);
  assert.deepEqual(normalizeProfile({ ...base, ai_policy: 'everything' }).errors.map((e) => e.field), ['ai_policy']);
});

test('the AI policy speaks only for the audited host: www. and a trailing dot do not count, the port and a subdomain do (D5)', () => {
  const crawl = makeCrawl();
  /** @param {string} url @param {import('../../plugin/server/src/types.js').CrawlResult} [on] */
  const policy = (url, on = crawl) => policyFor(profile({ ai_policy: 'block_all', site_url: url }), on).policy;
  assert.equal(policy(SITE), 'block_all');
  assert.equal(policy('https://www.example.test/'), 'block_all');
  assert.equal(policy('https://example.test./'), 'block_all');
  assert.equal(policy('http://example.test/'), 'block_all', 'http and https on their default ports are one site');
  assert.equal(policy('https://shop.example.test/'), null, 'a subdomain has a robots.txt of its own');
  assert.equal(policy('https://example.test:8443/'), null, 'another port is another site');
  assert.deepEqual(policyFor(profile({ ai_policy: 'block_all', site_url: 'https://competitor.test/' }), crawl), { policy: null, note: POLICY_OTHER_SITE });
  assert.deepEqual(policyFor(profile({ ai_policy: 'block_all', site_url: '' }), crawl), { policy: null, note: POLICY_NO_SITE_URL });
  assert.deepEqual(policyFor(profile({}), crawl), { policy: null, note: null });
  assert.deepEqual(policyFor(null, crawl), { policy: null, note: null });
  const local = makeCrawl({ site_origin: 'http://127.0.0.1:3000', site_host: '127.0.0.1:3000', options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true, deployed_origin: 'https://example.test' } });
  assert.equal(policy('http://127.0.0.1:4000/', local), null, 'another local port is another site');
  assert.equal(policy('http://127.0.0.1:3000/', local), 'block_all');
  assert.equal(policy('https://www.example.test/', local), 'block_all', 'the deployed site of a local crawl');
});

test('collectAi asks for /llms.txt once, on the site itself, and not when told not to or when the site refused the crawler', async () => {
  /** @type {unknown[][]} */
  const calls = [];
  const deps = /** @type {any} */ ({
    readProfile: async () => profile({ ai_policy: 'allow_search' }),
    fetchLlmsTxt: async (/** @type {string} */ origin, /** @type {any} */ options) => {
      calls.push([origin, options.sameSite(`${SITE}/x`), options.sameSite('https://other.test/x'), options.fetchOptions]);
      return { url: `${origin}/llms.txt`, outcome: 'not_found', status: 404, reason: 'status_404', final_url: null, content_type: null, h1: null, links: 0, bytes: 0, truncated: false };
    },
  });
  const crawl = makeCrawl({ pages: [makePage()] });
  const collected = await collectAi(deps, crawl, '/project', { requested: true, check: true });
  assert.equal(collected.policy, 'allow_search');
  assert.deepEqual(calls, [[SITE, true, false, undefined]]);
  assert.equal((await collectAi(deps, crawl, '/project', { requested: true, check: false })).reason, LLMS_NOT_ASKED);
  const refused = makeCrawl({ pages: [makePage({ fetch_error: 'bot_challenge' })] });
  assert.equal((await collectAi(deps, refused, '/project', { requested: true, check: true })).reason, LLMS_REFUSED);
  assert.equal(calls.length, 1);
  const local = makeCrawl({ site_origin: 'http://127.0.0.1:3000', site_host: '127.0.0.1:3000', start_url: 'http://127.0.0.1:3000/', options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true } });
  await collectAi(deps, local, '/project', { requested: true, check: true });
  assert.deepEqual(calls[1], ['http://127.0.0.1:3000', false, false, { allowLoopback: 'http://127.0.0.1:3000' }]);
  assert.deepEqual(await collectAi(deps, crawl, '/project', { requested: false, check: true }), { llms: null, reason: undefined, policy: null, policyNote: null });
});

test('the run summary holds tokens, booleans and statuses only, and passes the stored-run rules', () => {
  const crawl = makeCrawl({ ai_robots: robots() });
  const collected = { llms: null, reason: LLMS_NOT_ASKED, policy: /** @type {const} */ ('allow_search'), policyNote: null };
  const summary = aiSummary(crawl, collected, true);
  assert.deepEqual(summary, {
    bots_verified: '2026-11-14', policy: 'allow_search', robots: 'ok',
    agents: [{ token: 'OAI-SearchBot', allowed: false }, { token: 'PerplexityBot', allowed: true }, { token: 'GPTBot', allowed: false }],
    training_preference: 'disallow', preference_lines: 2, llms_txt: null,
  });
  assert.deepEqual(searchCrawlerCount(summary), { passed: 1, of: 2 });
  assert.deepEqual(aiNotes(summary, collected), [
    'AI search crawlers: robots.txt lets 1 of 2 read the start page (crawler data verified 2026-11-14). This is what robots.txt says; a CDN or firewall can treat the real crawlers differently, which is not tested.',
    LLMS_NOT_ASKED,
  ]);
  assert.equal(aiSummary(crawl, collected, false), null);
  const run = /** @type {any} */ ({ ...makeRun(), ai: summary });
  assert.equal(storedRunProblem(run), null);
});

test('a stored run with an ai record the plugin does not write is refused, naming the field', () => {
  const good = aiSummary(makeCrawl({ ai_robots: robots() }), { llms: { url: `${SITE}/llms.txt`, outcome: 'found', status: 200, reason: null, final_url: null, content_type: null, h1: null, links: 0, bytes: 0, truncated: false }, reason: undefined, policy: null, policyNote: null }, true);
  /** @param {Record<string, unknown>} ai */
  const problem = (ai) => storedRunProblem(/** @type {any} */ ({ ...makeRun(), ai: { ...good, ...ai } }));
  assert.equal(problem({}), null);
  assert.equal(problem({ agents: [{ token: 'EvilBot <script>', allowed: true }] }), 'ai.agents[0]');
  assert.equal(problem({ policy: 'sometimes' }), 'ai.policy');
  assert.equal(problem({ bots_verified: 'yesterday' }), 'ai.bots_verified');
  assert.equal(problem({ llms_txt: { url: 'javascript:alert(1)', outcome: 'found', status: 200 } }), 'ai.llms_txt.url');
  assert.equal(problem({ training_preference: 'maybe' }), 'ai.training_preference');
  assert.equal(storedRunProblem(/** @type {any} */ ({ ...makeRun(), ai: 'x' })), 'ai');
});

test('a robots.txt that refused this crawler is said, and no access is counted', () => {
  const crawl = makeCrawl({ pages: [makePage()], robots: { ...makeCrawl().robots, status: 'missing', http_status: 418 } });
  const collected = { llms: null, reason: undefined, policy: null, policyNote: null };
  const summary = aiSummary(crawl, collected, true);
  assert.deepEqual([summary?.robots, summary?.robots_refused, summary?.agents], [null, 418, []]);
  assert.equal(searchCrawlerCount(summary), null);
  assert.match(aiNotes(summary, collected)[0], /robots\.txt answered HTTP 418 to Seekwide's crawler instead of the file/);
  assert.equal(storedRunProblem(/** @type {any} */ ({ ...makeRun(), ai: summary })), null);
  assert.equal(storedRunProblem(/** @type {any} */ ({ ...makeRun(), ai: { ...summary, robots_refused: 'x' } })), 'ai.robots_refused');
  const absent = aiSummary(makeCrawl({ pages: [makePage()], robots: { ...makeCrawl().robots, status: 'missing', http_status: 404 } }), collected, true);
  assert.equal(absent?.robots_refused, undefined);
});
