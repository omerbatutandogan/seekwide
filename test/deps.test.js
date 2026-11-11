import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createToolDeps } from '../server/src/deps.js';
import { makeCrawl, makeVitals } from './helpers/factories.js';

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
