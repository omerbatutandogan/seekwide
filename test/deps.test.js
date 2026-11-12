import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createToolDeps } from '../server/src/deps.js';
import { measureVitals } from '../server/src/vitals/measure.js';
import { SITE, makeCrawl, makePage, makeVitals } from './helpers/factories.js';

const KEY = 'fake-DepsTestKey-0123456789_abcdefghij';
const ENV = {
  SEEKWIDE_GOOGLE_API_KEY: KEY,
  SEEKWIDE_REPORT_BRAND: 'Acme',
  SEEKWIDE_REPORT_LOGO: '/logo.png',
  SEEKWIDE_DATA_DIR: '/nonexistent/seekwide-deps-test',
  CLAUDE_PROJECT_DIR: '/projects/site',
  HOME: '/home/someone',
  PATH: '/usr/bin',
};

/** A measurement that records what it was called with. */
function recorder() {
  /** @type {object[]} */
  const calls = [];
  /** @type {any} */
  const measure = async (/** @type {unknown} */ _crawl, /** @type {object} */ options) => {
    calls.push(options);
    return makeVitals();
  };
  return { calls, measure };
}

test('the tools are handed the two report settings and nothing else of the environment', () => {
  const deps = createToolDeps(ENV);
  assert.deepEqual(Object.keys(deps.env).sort(), ['SEEKWIDE_REPORT_BRAND', 'SEEKWIDE_REPORT_LOGO']);
  assert.deepEqual(deps.env, { SEEKWIDE_REPORT_BRAND: 'Acme', SEEKWIDE_REPORT_LOGO: '/logo.png' });
  assert.equal(deps.defaultProjectDir(), '/projects/site');
});

test('nothing a tool can read holds the Google API key: it lives only inside the measurement function', () => {
  const deps = createToolDeps(ENV);
  for (const [name, value] of Object.entries(deps)) {
    if (typeof value === 'function') continue;
    assert.ok(!(JSON.stringify(value) ?? '').includes(KEY), `deps.${name} holds the key`);
  }
});

test('the key from the environment is bound into the measurement, and a caller cannot replace it', async () => {
  const { calls, measure } = recorder();
  const deps = createToolDeps(ENV, measure);
  await deps.measureVitals(makeCrawl(), { maxPages: 5 });
  await deps.measureVitals(makeCrawl(), /** @type {any} */ ({ maxPages: 1, apiKey: 'passed-in-by-a-tool' }));
  assert.deepEqual(calls, [{ maxPages: 5, apiKey: KEY }, { maxPages: 1, apiKey: KEY }]);
});

test('without a key, or with the placeholder of an empty setting, the measurement gets none', async () => {
  for (const value of [undefined, '', '   ', '${user_config.google_api_key}']) {
    const { calls, measure } = recorder();
    const deps = createToolDeps({ ...ENV, SEEKWIDE_GOOGLE_API_KEY: value }, measure);
    await deps.measureVitals(makeCrawl(), { maxPages: 3 });
    assert.deepEqual(calls, [{ maxPages: 3, apiKey: null }], JSON.stringify(value));
  }
});

test('building the dependencies touches neither the disk nor the network', () => {
  // The data directory does not exist and must not be created until a crawl starts.
  const deps = createToolDeps(ENV);
  assert.equal(deps.crawlManager.get('c-unknown'), null);
  assert.equal(typeof deps.measureVitals, 'function');
  assert.ok(deps.checks.length >= 56);
});

test('the key is read when a measurement starts, so a setting changed after the tools were built counts', async () => {
  const { calls, measure } = recorder();
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...ENV, SEEKWIDE_GOOGLE_API_KEY: undefined };
  const deps = createToolDeps(env, measure);
  env.SEEKWIDE_GOOGLE_API_KEY = KEY;
  await deps.measureVitals(makeCrawl(), { maxPages: 3 });
  env.SEEKWIDE_GOOGLE_API_KEY = 'two words';
  await deps.measureVitals(makeCrawl(), { maxPages: 3 });
  assert.deepEqual(calls, [{ maxPages: 3, apiKey: KEY }, { maxPages: 3, apiKey: null, apiKeyUnusable: true }]);
});

test('a key that is set but cannot be sent is reported as unusable, never as no key, and nothing goes to Google', async () => {
  const UNUSABLE = 'AIza Deps Test Key with spaces';
  const { calls, measure } = recorder();
  await createToolDeps({ ...ENV, SEEKWIDE_GOOGLE_API_KEY: UNUSABLE }, measure).measureVitals(makeCrawl(), { maxPages: 3 });
  assert.deepEqual(calls, [{ maxPages: 3, apiKey: null, apiKeyUnusable: true }]);

  // The real measurement, with clients that record what would have been sent.
  /** @type {string[]} */
  const sent = [];
  /** @type {any} */
  const spy = async (/** @type {unknown} */ target) => {
    sent.push(JSON.stringify(target));
    return { ok: false, failure: { kind: 'network', status: 0, reason: null } };
  };
  const real = /** @type {typeof measureVitals} */ ((crawl, options) => measureVitals(crawl, { ...options, runPagespeed: spy, queryCrux: spy }));
  const crawl = makeCrawl({ pages: [makePage({ url: `${SITE}/` })] });
  const vitals = await createToolDeps({ ...ENV, SEEKWIDE_GOOGLE_API_KEY: UNUSABLE }, real).measureVitals(crawl, { maxPages: 3 });
  assert.deepEqual(sent, [], 'nothing is sent, not even without the key');
  assert.match(vitals.lab.reason ?? '', /^The Google API key in the plugin settings cannot be used: .* Nothing was sent to Google\. Check the key in the plugin settings\.$/);
  assert.equal(vitals.field.reason, vitals.lab.reason);
  assert.doesNotMatch(JSON.stringify(vitals), /No Google API key is set/);
  for (const part of UNUSABLE.split(' ')) assert.ok(!JSON.stringify(vitals).includes(part), `the result echoes ${part}`);

  // The same crawl with a usable key is asked about, so the refusal above came from the key alone.
  await createToolDeps({ ...ENV, SEEKWIDE_GOOGLE_API_KEY: 'AIzaUsable-Key_123' }, real).measureVitals(crawl, { maxPages: 3 });
  assert.ok(sent.length > 0);
});
