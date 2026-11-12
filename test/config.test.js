import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CAPABILITIES, LIMITS, googleApiKey, googleApiKeySetting, toolSettings } from '../server/src/config.js';

test('googleApiKey returns the key from the plugin settings, trimmed', () => {
  assert.equal(googleApiKey({ SEEKWIDE_GOOGLE_API_KEY: 'AIzaSyExample-Key_123' }), 'AIzaSyExample-Key_123');
  assert.equal(googleApiKey({ SEEKWIDE_GOOGLE_API_KEY: '  AIzaSyExample-Key_123\n' }), 'AIzaSyExample-Key_123');
});

test('googleApiKey treats a missing, blank or unsubstituted setting as no key', () => {
  assert.equal(googleApiKey({}), null);
  assert.equal(googleApiKey({ SEEKWIDE_GOOGLE_API_KEY: '' }), null);
  assert.equal(googleApiKey({ SEEKWIDE_GOOGLE_API_KEY: '   ' }), null);
  assert.equal(googleApiKey({ SEEKWIDE_GOOGLE_API_KEY: '${user_config.google_api_key}' }), null);
});

test('googleApiKey refuses a value that could not be sent in a request header', () => {
  assert.equal(googleApiKey({ SEEKWIDE_GOOGLE_API_KEY: 'two words' }), null);
  assert.equal(googleApiKey({ SEEKWIDE_GOOGLE_API_KEY: 'line\nbreak' }), null);
  assert.equal(googleApiKey({ SEEKWIDE_GOOGLE_API_KEY: 'anahtar-ü' }), null);
  assert.equal(googleApiKey({ SEEKWIDE_GOOGLE_API_KEY: 'x'.repeat(257) }), null);
});

test('googleApiKeySetting tells a key that is set but cannot be used from no key at all', () => {
  for (const value of ['two words', 'line\nbreak', 'anahtar-ü', 'x'.repeat(257), 'tab\tinside']) {
    assert.deepEqual(googleApiKeySetting({ SEEKWIDE_GOOGLE_API_KEY: value }), { key: null, unusable: true }, JSON.stringify(value));
  }
  for (const value of [undefined, '', '   ', '${user_config.google_api_key}']) {
    assert.deepEqual(googleApiKeySetting({ SEEKWIDE_GOOGLE_API_KEY: value }), { key: null, unusable: false }, JSON.stringify(value));
  }
  assert.deepEqual(googleApiKeySetting({ SEEKWIDE_GOOGLE_API_KEY: ' AIzaSyExample-Key_123\n' }), { key: 'AIzaSyExample-Key_123', unusable: false });
});

test('the Core Web Vitals budget is small and bounded', () => {
  assert.equal(LIMITS.vitalsPagesDefault, 3);
  assert.equal(LIMITS.vitalsPagesMax, 10);
  assert.ok(LIMITS.vitalsPagesDefault <= LIMITS.vitalsPagesMax);
  assert.ok(LIMITS.psiConcurrency >= 1 && LIMITS.psiConcurrency <= LIMITS.vitalsPagesMax);
  assert.deepEqual([...CAPABILITIES], ['full_crawl', 'sitemap', 'robots', 'outbound', 'lab_data', 'field_data', 'live_site']);
});

test('the tools get the two report settings from the environment and nothing else, the Google API key least of all', () => {
  const env = { SEEKWIDE_REPORT_BRAND: 'Acme', SEEKWIDE_REPORT_LOGO: '/logo.png', SEEKWIDE_GOOGLE_API_KEY: 'AIzaSecret', HOME: '/home/me', PATH: '/bin' };
  assert.deepEqual(toolSettings(env), { SEEKWIDE_REPORT_BRAND: 'Acme', SEEKWIDE_REPORT_LOGO: '/logo.png' });
  assert.ok(!JSON.stringify(toolSettings(env)).includes('AIzaSecret'));
  assert.deepEqual(toolSettings({}), { SEEKWIDE_REPORT_BRAND: undefined, SEEKWIDE_REPORT_LOGO: undefined });
});
