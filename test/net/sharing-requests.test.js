// The requests the smo module adds, and the hosts no check ever contacts (rule set 0.1.9).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkImageFiles } from '../../plugin/server/src/net/image-check.js';
import { checkExternalLinks } from '../../plugin/server/src/net/link-check.js';
import { createHostGates } from '../../plugin/server/src/net/polite.js';
import { createRobotsCache } from '../../plugin/server/src/net/robots-cache.js';
import { fakeFetch, fetchResult } from './fake-fetch.js';

const A = 'https://a.test';
const noSleep = async () => {};
const isolated = () => ({ sleep: noSleep, hosts: createHostGates(), robotsCache: createRobotsCache() });
/** The first bytes of a 1200 × 630 PNG. */
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0xb0, 0, 0, 2, 0x76, 8, 6, 0, 0, 0]);

test('with readBytes, each image gets one ranged GET for its first bytes and its pixel size, and no HEAD', async () => {
  const { fetch, calls } = fakeFetch({
    [`${A}/robots.txt`]: { status: 404 },
    [`${A}/share.png`]: { status: 206, headers: { 'content-type': 'image/png', 'content-range': `bytes 0-${PNG_HEAD.length - 1}/250000` }, body: PNG_HEAD },
    [`${A}/vector.svg`]: { status: 200, headers: { 'content-type': 'image/svg+xml', 'content-length': '900' }, text: '<svg/>' },
  });
  const results = await checkImageFiles([`${A}/share.png`, `${A}/vector.svg`], { fetch, ...isolated(), readBytes: 65_536 });
  const image = calls.filter((call) => !call.url.endsWith('/robots.txt'));
  assert.deepEqual(image.map((call) => [call.options.method, call.options.headers.range, call.options.maxBytes]), [['GET', 'bytes=0-65535', 65_536], ['GET', 'bytes=0-65535', 65_536]]);
  assert.deepEqual(results.get(`${A}/share.png`)?.size, { format: 'png', width: 1200, height: 630 });
  assert.equal(results.get(`${A}/share.png`)?.bytes, 250_000);
  assert.equal(results.get(`${A}/vector.svg`)?.size, null, 'a format without a size in its first bytes');
  assert.equal(results.get(`${A}/vector.svg`)?.outcome, 'ok');
  await assert.rejects(checkImageFiles([], { fetch, readBytes: -1 }), TypeError);
});

test('without readBytes, the media module\'s requests are unchanged and carry no size', async () => {
  const { fetch, calls } = fakeFetch({ [`${A}/robots.txt`]: { status: 404 }, [`${A}/a.png`]: { headers: { 'content-type': 'image/png', 'content-length': '100' } } });
  const result = (await checkImageFiles([`${A}/a.png`], { fetch, ...isolated() })).get(`${A}/a.png`);
  assert.equal(calls[1].options.method, 'HEAD');
  assert.equal(result?.size, undefined);
});

test('the image check never contacts Google Play or a social platform, not even for robots.txt, nor through a redirect', async () => {
  const { fetch, calls } = fakeFetch({
    [`${A}/robots.txt`]: { status: 404 },
    [`${A}/moved.png`]: { status: 302, headers: { location: 'https://pbs.twimg.com/media/a.jpg' } },
  });
  const urls = ['https://scontent.xx.fbcdn.net/a.jpg', 'https://i.ytimg.com/vi/x/hq.jpg', 'https://play.google.com/a.png', `${A}/moved.png`];
  const results = await checkImageFiles(urls, { fetch, ...isolated(), readBytes: 1024 });
  assert.deepEqual(calls.map((call) => call.url), [`${A}/robots.txt`, `${A}/moved.png`]);
  assert.deepEqual([...results.values()].map((result) => [result.outcome, result.reason]), [
    ['unverifiable', 'Not requested: Seekwide never contacts social platforms'],
    ['unverifiable', 'Not requested: Seekwide never contacts social platforms'],
    ['unverifiable', 'Not requested: Seekwide never contacts Google Play'],
    ['unverifiable', 'Not requested: Seekwide never contacts social platforms'],
  ]);
});

test('the external link check never contacts Google Play or a social platform, not even for robots.txt, nor through a redirect', async () => {
  /** @type {string[]} */
  const sent = [];
  /** @type {typeof import('../../plugin/server/src/net/safe-fetch.js').safeFetch} */
  const fetch = async (url) => {
    sent.push(url);
    if (url === 'https://bit.example/app') return fetchResult(url, { status: 301, headers: { location: 'https://play.google.com/store/apps/details?id=x' } });
    return fetchResult(url, { status: url.endsWith('/robots.txt') ? 404 : 200 });
  };
  const urls = ['https://play.google.com/store/apps/details?id=com.example', 'https://www.facebook.com/acme', 'https://x.com/acme', 'https://bit.example/app', 'https://ok.example/'];
  const results = await checkExternalLinks(urls, { fetch, ...isolated() });
  assert.ok(sent.every((url) => url.startsWith('https://bit.example/') || url.startsWith('https://ok.example/')), JSON.stringify(sent));
  assert.deepEqual([...results.values()].map((result) => [result.outcome, result.reason]), [
    ['unverifiable', 'Not requested: Seekwide never contacts Google Play'],
    ['unverifiable', 'Not requested: Seekwide never contacts social platforms'],
    ['unverifiable', 'Not requested: Seekwide never contacts social platforms'],
    ['unverifiable', 'Not requested: Seekwide never contacts Google Play'],
    ['ok', null],
  ]);
});
