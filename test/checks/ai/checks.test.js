import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContext, runChecks } from '../../../plugin/server/src/checks/engine.js';
import { checks } from '../../../plugin/server/src/checks/ai/index.js';
import { cdnOf, maxSnippet } from '../../../plugin/server/src/checks/ai/helpers.js';
import { AI_BOTS } from '../../../plugin/server/src/util/ai-bots.js';
import { SITE, makeCrawl, makePage } from '../../helpers/factories.js';

/** @import { AiPolicy, AiRobots, LlmsTxtResult, PageRecord } from '../../../plugin/server/src/types.js' */

const NOW = '2026-11-14T00:00:00.000Z';

/**
 * robots.txt as the crawl read it: every crawler allowed unless named in `blocked`.
 * @param {{blocked?: string[], groups?: Record<string, 'own'|'fallback'|'named'|'star'|'none'>, policy?: AiRobots['policy'], blockedPages?: Record<string, string[]>,
 *          contentUsage?: AiRobots['content_usage'], contentSignal?: AiRobots['content_signal']}} [options]
 * @returns {AiRobots}
 */
function aiRobots({ blocked = [], groups = {}, policy = { group: 'none', allowed: null }, blockedPages = {}, contentUsage = [], contentSignal = [] } = {}) {
  return {
    url: `${SITE}/`, status: 'ok',
    agents: Object.fromEntries(AI_BOTS.filter((bot) => bot.role !== 'policy').map((bot) => [bot.token, { allowed: !blocked.includes(bot.token), group: groups[bot.token] ?? (blocked.includes(bot.token) ? 'own' : 'star') }])),
    policy, pages_asked: 10, blocked_pages: blockedPages, content_usage: contentUsage, content_signal: contentSignal, preference_lines: contentUsage.length + contentSignal.length,
  };
}

/**
 * @param {{pages?: PageRecord[], ai?: AiRobots|null, policy?: AiPolicy|null, llms?: LlmsTxtResult|null, local?: boolean}} [options]
 */
function audit({ pages = [makePage()], ai = aiRobots(), policy = null, llms = null, local = false } = {}) {
  const crawl = makeCrawl({ pages, ...(ai === null ? {} : { ai_robots: ai }), options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local } });
  return runChecks(checks, buildContext(crawl, { aiPolicy: policy, llmsTxt: llms }), { modules: ['ai'], detectedAt: NOW });
}

/** @param {ReturnType<typeof audit>} result @param {string} id */
const stat = (result, id) => {
  const found = result.checks.find((entry) => entry.id === id);
  if (!found) throw new Error(`no stat for ${id}`);
  return found.status === 'skipped' ? 'skipped' : [found.applicable, found.failed];
};
/** @param {ReturnType<typeof audit>} result @param {string} id */
const findings = (result, id) => result.findings.filter((finding) => finding.check_id === id);

test('ai.access.search_bot_blocked: six counted crawlers; a block fails, worded as something to check; none under a block-all policy', () => {
  assert.deepEqual(stat(audit(), 'ai.access.search_bot_blocked'), [6, 0]);
  const result = audit({ ai: aiRobots({ blocked: ['PerplexityBot', 'GPTBot'] }) });
  assert.deepEqual(stat(result, 'ai.access.search_bot_blocked'), [6, 1]);
  const [finding] = findings(result, 'ai.access.search_bot_blocked');
  assert.equal(finding.selector, 'PerplexityBot');
  assert.equal(finding.confidence, 'likely');
  assert.match(String(finding.evidence.expected), /unless keeping it out is intended/);
  assert.match(String(finding.evidence.limit), /CDN or firewall can still treat the real crawler differently/);
  assert.match(finding.recommendation, /Check whether the block is what you want/);
  assert.deepEqual(stat(audit({ ai: aiRobots({ blocked: ['PerplexityBot'] }), policy: 'block_all' }), 'ai.access.search_bot_blocked'), [0, 0]);
  assert.deepEqual(stat(audit({ ai: aiRobots({ blocked: ['PerplexityBot'] }), policy: 'allow_search' }), 'ai.access.search_bot_blocked'), [6, 1]);
  assert.equal(stat(audit({ ai: null }), 'ai.access.search_bot_blocked'), 'skipped', 'a crawl made before rule set 0.2.0');
});

test('ai.access.search_bot_partial: an indexable page a counted crawler may not read', () => {
  const pages = [makePage(), makePage({ url: `${SITE}/docs` })];
  const result = audit({ pages, ai: aiRobots({ blockedPages: { 'OAI-SearchBot': [`${SITE}/docs`], GPTBot: [`${SITE}/`] } }) });
  assert.deepEqual(stat(result, 'ai.access.search_bot_partial'), [2, 1]);
  assert.deepEqual(findings(result, 'ai.access.search_bot_partial')[0].evidence.observed, { crawlers: ['OAI-SearchBot'], robots_txt: `${SITE}/robots.txt`, bot_data_verified: '2026-11-14' });
  assert.deepEqual(stat(audit({ pages, policy: 'block_all', ai: aiRobots({ blockedPages: { 'OAI-SearchBot': [`${SITE}/docs`] } }) }), 'ai.access.search_bot_partial'), [0, 0]);
});

test('ai.access.user_fetcher_blocked lists blocked user fetchers with what the vendor says robots.txt does to them', () => {
  const result = audit({ ai: aiRobots({ blocked: ['ChatGPT-User', 'Claude-User'] }) });
  assert.deepEqual(findings(result, 'ai.access.user_fetcher_blocked').map((f) => [f.selector, /** @type {any} */ (f.evidence.observed).robots_binding]), [['ChatGPT-User', 'may_ignore'], ['Claude-User', 'obeys']]);
  assert.deepEqual(stat(audit(), 'ai.access.user_fetcher_blocked'), [0, 0]);
});

test('ai.robots.search_crawler_blocked_for_training: Applebot or Bingbot blocked without the training-only control', () => {
  const result = audit({ ai: aiRobots({ blocked: ['Applebot', 'Bingbot'] }) });
  assert.deepEqual(findings(result, 'ai.robots.search_crawler_blocked_for_training').map((f) => f.selector), ['Applebot', 'Bingbot']);
  const named = audit({ ai: aiRobots({ blocked: ['Applebot', 'Applebot-Extended', 'Bingbot'], policy: { group: 'rules', allowed: false } }) });
  assert.deepEqual(stat(named, 'ai.robots.search_crawler_blocked_for_training'), [2, 0]);
  const meta = audit({ pages: [makePage({ ai: { ...makePage().ai, bingbot: ['ai-training:disallow'] } })], ai: aiRobots({ blocked: ['Bingbot'] }) });
  assert.deepEqual(stat(meta, 'ai.robots.search_crawler_blocked_for_training'), [1, 0]);
  assert.deepEqual(stat(audit({ ai: aiRobots({ blocked: ['Applebot'] }), policy: 'block_all' }), 'ai.robots.search_crawler_blocked_for_training'), [0, 0]);
  assert.deepEqual(stat(audit({ ai: aiRobots({ blocked: ['Applebot'] }), policy: 'allow_all' }), 'ai.robots.search_crawler_blocked_for_training'), [0, 0]);
});

test('ai.access.self_refused names the CDN of a refused start page and needs the deployed site', () => {
  const refused = makePage({
    status: 403, final_status: 403, is_html: false, fetch_error: 'bot_challenge', headers: { 'cf-ray': '8a1b-FRA', server: 'cloudflare' },
    indexability: { indexable: false, reasons: ['fetch_error'] },
  });
  const result = audit({ pages: [refused] });
  const [finding] = findings(result, 'ai.access.self_refused');
  assert.deepEqual(finding.evidence.observed, { status: 403, refusal: 'bot_challenge', cdn: 'Cloudflare' });
  assert.match(String(finding.evidence.detail), /2026-09-15/);
  assert.deepEqual(stat(audit(), 'ai.access.self_refused'), [1, 0]);
  assert.equal(stat(audit({ pages: [refused], local: true }), 'ai.access.self_refused'), 'skipped');
});

test('cdnOf names a CDN only from headers it adds', () => {
  assert.equal(cdnOf({ 'x-vercel-id': 'fra1::abc' }), 'Vercel');
  assert.equal(cdnOf({ via: '1.1 abc.cloudfront.net (CloudFront)' }), 'Amazon CloudFront');
  assert.equal(cdnOf({ 'x-served-by': 'cache-fra-1' }), 'Fastly');
  assert.equal(cdnOf({ 'akamai-grn': '0.1' }), 'Akamai');
  assert.equal(cdnOf({ server: 'Netlify' }), 'Netlify');
  assert.equal(cdnOf({ server: 'nginx', via: '1.1 varnish' }), null);
});

test('ai.policy.not_applied compares robots.txt with the stated policy, and ClaudeBot follows the shared preference when not named', () => {
  assert.deepEqual(stat(audit(), 'ai.policy.not_applied'), [0, 0], 'no policy, no units');
  const allowSearch = audit({ policy: 'allow_search', ai: aiRobots({ blocked: ['GPTBot', 'CCBot'] }) });
  const open = findings(allowSearch, 'ai.policy.not_applied').map((f) => f.selector).sort();
  assert.ok(open.includes('ClaudeBot') && open.includes('Google-Extended') && !open.includes('GPTBot'));
  const shared = audit({ policy: 'allow_search', ai: aiRobots({ policy: { group: 'rules', allowed: false } }) });
  assert.ok(!findings(shared, 'ai.policy.not_applied').some((f) => f.selector === 'ClaudeBot'), 'ClaudeBot follows the shared preference');
  assert.ok(findings(shared, 'ai.policy.not_applied').some((f) => f.selector === 'Google-Extended'), 'Google only from early 2027');
  const blockAll = audit({ policy: 'block_all' });
  assert.ok(findings(blockAll, 'ai.policy.not_applied').some((f) => f.selector === 'OAI-SearchBot'));
  assert.ok(!findings(blockAll, 'ai.policy.not_applied').some((f) => f.selector === 'Bingbot'), 'a search engine crawler is not judged by an AI policy');
  const allowAll = audit({ policy: 'allow_all', ai: aiRobots({ blocked: ['GPTBot'] }) });
  assert.deepEqual(findings(allowAll, 'ai.policy.not_applied').map((f) => f.selector), ['GPTBot']);
});

test('ai.robots.training_preference_invalid and ai.robots.shared_preference_overridden', () => {
  const line = (/** @type {string} */ value, /** @type {boolean} */ valid) => ({ value, valid, problem: valid ? null : 'value', values: {} });
  const result = audit({ ai: aiRobots({ policy: { group: 'empty', allowed: null }, contentUsage: [line('train-ai=maybe', false)], contentSignal: [line('search=yes', true)] }) });
  assert.deepEqual(findings(result, 'ai.robots.training_preference_invalid').map((f) => f.selector), ['__usage_ai-training', 'content-usage[0]']);
  assert.deepEqual(stat(result, 'ai.robots.training_preference_invalid'), [3, 2]);
  assert.deepEqual(stat(audit(), 'ai.robots.training_preference_invalid'), [0, 0]);
  const overridden = audit({ ai: aiRobots({ policy: { group: 'rules', allowed: false }, groups: { ClaudeBot: 'own' } }) });
  assert.deepEqual(findings(overridden, 'ai.robots.shared_preference_overridden').map((f) => f.selector), ['ClaudeBot']);
  assert.deepEqual(stat(overridden, 'ai.robots.shared_preference_overridden'), [2, 1]);
  assert.deepEqual(stat(audit({ ai: aiRobots({ groups: { ClaudeBot: 'own' } }) }), 'ai.robots.shared_preference_overridden'), [0, 0]);
});

test('snippet checks: nosnippet and max-snippet:0 fail, a limit is information, data-nosnippet over the main content fails', () => {
  const pages = [
    makePage({ url: `${SITE}/a`, meta_robots: ['nosnippet'] }),
    makePage({ url: `${SITE}/b`, x_robots: ['max-snippet:0'] }),
    makePage({ url: `${SITE}/c`, meta_robots: ['max-snippet: 120'] }),
    makePage({ url: `${SITE}/d`, word_count: 100, ai: { ...makePage().ai, nosnippet_elements: 1, nosnippet_words: 60, nosnippet_h1: false } }),
    makePage({ url: `${SITE}/e`, word_count: 100, ai: { ...makePage().ai, nosnippet_elements: 2, nosnippet_words: 10, nosnippet_h1: false } }),
    makePage({ url: `${SITE}/f`, ai: { ...makePage().ai, nosnippet_elements: 1, nosnippet_words: 3, nosnippet_h1: true } }),
  ];
  const result = audit({ pages });
  assert.deepEqual(findings(result, 'ai.snippet.nosnippet').map((f) => f.url), [`${SITE}/a`, `${SITE}/b`]);
  assert.deepEqual(findings(result, 'ai.snippet.max_snippet_set').map((f) => [f.url, /** @type {any} */ (f.evidence.observed).max_snippet]), [[`${SITE}/c`, 120]]);
  assert.deepEqual(findings(result, 'ai.snippet.data_nosnippet_main').map((f) => f.url), [`${SITE}/d`, `${SITE}/f`]);
  assert.deepEqual(stat(result, 'ai.snippet.data_nosnippet_main'), [3, 2]);
  assert.deepEqual(stat(audit({ pages, policy: 'block_all' }), 'ai.snippet.nosnippet'), [0, 0]);
  assert.deepEqual([maxSnippet('max-snippet:-1'), maxSnippet('max-snippet:abc'), maxSnippet('noindex')], [-1, null, null]);
});

test('Bing checks: noarchive without the new directives is information; ai-grounding restrictions are listed', () => {
  const ai = makePage().ai;
  const pages = [
    makePage({ url: `${SITE}/old`, ai: { ...ai, bingbot: ['noarchive'] } }),
    makePage({ url: `${SITE}/both`, ai: { ...ai, bingbot: ['nocache', 'ai-training:disallow'] } }),
    makePage({ url: `${SITE}/ground`, ai: { ...ai, bingbot: ['ai-grounding:disallowextended'] } }),
  ];
  const result = audit({ pages });
  assert.deepEqual(findings(result, 'ai.bing.legacy_ai_directive').map((f) => f.url), [`${SITE}/old`]);
  assert.deepEqual(findings(result, 'ai.bing.grounding_restricted').map((f) => [f.url, /** @type {any} */ (f.evidence.observed).directive]), [[`${SITE}/ground`, 'ai-grounding:disallowextended']]);
  assert.deepEqual(stat(audit({ pages, policy: 'block_all' }), 'ai.bing.grounding_restricted'), [0, 0]);
});

test('ai.content.script_only: an empty mount element and a script, or no text and no image at all', () => {
  const ai = makePage().ai;
  const pages = [
    makePage({ url: `${SITE}/spa`, word_count: 3, ai: { ...ai, body_scripts: 2, empty_mount: 'root' } }),
    makePage({ url: `${SITE}/blank`, word_count: 0, images: [], ai: { ...ai, body_scripts: 1 } }),
    makePage({ url: `${SITE}/gallery`, word_count: 0, images: [/** @type {any} */ ({ src: 'a.png' })], ai: { ...ai, body_scripts: 1 } }),
    makePage({ url: `${SITE}/short`, word_count: 20, ai: { ...ai, body_scripts: 3 } }),
    makePage({ url: `${SITE}/ssr`, word_count: 400, ai: { ...ai, body_scripts: 3, empty_mount: 'app' } }),
  ];
  const result = audit({ pages });
  assert.deepEqual(findings(result, 'ai.content.script_only').map((f) => f.url), [`${SITE}/blank`, `${SITE}/spa`]);
  assert.deepEqual(findings(result, 'ai.content.script_only')[1].evidence.observed, { words: 3, body_scripts: 2, empty_mount: '#root' });
});

test('ai.llms_txt.malformed is information about a file the site serves, and needs the file to be asked for', () => {
  /** @param {Partial<LlmsTxtResult>} overrides @returns {LlmsTxtResult} */
  const llms = (overrides) => ({ url: `${SITE}/llms.txt`, outcome: 'found', status: 200, reason: null, final_url: null, content_type: 'text/plain', h1: 'Site', links: 3, bytes: 100, truncated: false, ...overrides });
  assert.equal(stat(audit(), 'ai.llms_txt.malformed'), 'skipped');
  assert.deepEqual(stat(audit({ llms: llms({}) }), 'ai.llms_txt.malformed'), [1, 0]);
  assert.deepEqual(stat(audit({ llms: llms({ outcome: 'not_found', h1: null }) }), 'ai.llms_txt.malformed'), [0, 0]);
  const bad = audit({ llms: llms({ reason: 'no_h1', h1: null }) });
  assert.equal(findings(bad, 'ai.llms_txt.malformed')[0].severity, 'info');
  assert.match(String(findings(bad, 'ai.llms_txt.malformed')[0].evidence.detail), /Google Search, which ignores them/);
});

test('the module is a count: scored checks that passed every unit, never a 0-100 score', () => {
  const result = audit({ ai: aiRobots({ blocked: ['PerplexityBot'] }) });
  assert.equal(result.modules.ai.score, null);
  assert.ok(result.modules.ai.count && result.modules.ai.count.passed < result.modules.ai.count.of);
  assert.match(String(result.modules.ai.note), /^\d+ of \d+ AI readiness checks passed\. A count, not a score\.$/);
});
