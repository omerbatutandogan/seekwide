import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isBotChallenge, retryAfterMs } from '../../plugin/server/src/crawl/challenge.js';
import { fetchResult } from '../net/fake-fetch.js';

const URL_ = 'https://site.test/';

test('a 403, 429 or 503 with a challenge marker is a bot challenge', () => {
  for (const status of [403, 429, 503]) {
    for (const text of ['<title>Just a moment...</title>', 'window._cf_chl_opt={}; /cdn-cgi/challenge-platform/', 'Please solve the CAPTCHA', 'Incapsula incident ID']) {
      assert.equal(isBotChallenge(fetchResult(URL_, { status, text })), true, `${status} ${text}`);
    }
  }
  assert.equal(isBotChallenge(fetchResult(URL_, { status: 403, headers: { 'cf-mitigated': 'challenge' } })), true);
});

test('other statuses, or the same statuses without a marker, are not a challenge', () => {
  assert.equal(isBotChallenge(fetchResult(URL_, { status: 200, text: 'Just a moment' })), false);
  assert.equal(isBotChallenge(fetchResult(URL_, { status: 404, headers: { 'cf-mitigated': 'challenge' } })), false);
  assert.equal(isBotChallenge(fetchResult(URL_, { status: 403, text: 'Forbidden' })), false);
  assert.equal(isBotChallenge(fetchResult(URL_, { status: 503, text: 'Maintenance' })), false);
  assert.equal(isBotChallenge(fetchResult(URL_, { status: 429, body: null })), false);
});

test('retryAfterMs reads delta-seconds and HTTP dates and caps at 30 s', () => {
  const now = new Date('2026-11-11T14:00:00Z');
  assert.equal(retryAfterMs('7', now), 7000);
  assert.equal(retryAfterMs(' 0 ', now), 0);
  assert.equal(retryAfterMs('120', now), 30_000);
  assert.equal(retryAfterMs('Wed, 11 Nov 2026 14:00:05 GMT', now), 5000);
  assert.equal(retryAfterMs('Wed, 11 Nov 2026 15:00:00 GMT', now), 30_000);
  assert.equal(retryAfterMs('Wed, 11 Nov 2026 13:00:00 GMT', now), 0);
});

test('retryAfterMs gives 0 for a missing or unreadable header', () => {
  const now = new Date('2026-11-11T14:00:00Z');
  assert.equal(retryAfterMs(undefined, now), 0);
  assert.equal(retryAfterMs('soon', now), 0);
  assert.equal(retryAfterMs('-5', now), 0);
});
