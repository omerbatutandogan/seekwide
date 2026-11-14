// A crawl never starts on, or is led to, Google Play or a social platform
// (review of batch 1, D2).

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { validateStart } from '../../plugin/server/src/crawl/start-input.js';
import { InputError } from '../../plugin/server/src/util/errors.js';
import { fetchResult } from '../net/fake-fetch.js';
import { crawl, removeTempDirs, testManager } from './harness.js';

after(removeTempDirs);

test('a start URL on Google Play or a social platform is refused up front, naming the rule', async () => {
  for (const url of ['https://www.youtube.com/@acme', 'https://play.google.com/store/apps/details?id=a', 'https://www.pinterest.co.uk/acme/']) {
    assert.throws(() => validateStart({ url }), (error) => error instanceof InputError && /never sends a request to Google Play or to social platforms/.test(error.message), url);
  }
  /** @type {string[]} */
  const sent = [];
  const { manager } = await testManager({ fetch: async (url) => { sent.push(url); return fetchResult(url); } });
  await assert.rejects(manager.start({ url: 'https://www.instagram.com/acme/' }), InputError);
  assert.deepEqual(sent, []);
  assert.doesNotThrow(() => validateStart({ url: 'https://acme.example/' }));
});

test('a start URL that redirects to a social platform fails before that request, with a reason that names the rule', async () => {
  /** @type {string[]} */
  const sent = [];
  /** @param {string} url */
  const fetch = async (url) => {
    sent.push(url);
    if (url === 'https://acme.example/') return fetchResult(url, { status: 301, headers: { location: 'https://www.facebook.com/acme' } });
    return fetchResult(url, { status: 404, text: 'not found' });
  };
  const { job } = await crawl({ url: 'https://acme.example/' }, { fetch });
  assert.equal(job?.status, 'failed');
  assert.match(job?.error ?? '', /^The start URL redirects to https:\/\/www\.facebook\.com\/acme, which is not crawled: it is on a social platform, and Seekwide never sends a request/);
  assert.deepEqual(sent, ['https://acme.example/robots.txt', 'https://acme.example/']);
});
