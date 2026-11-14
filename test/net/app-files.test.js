import assert from 'node:assert/strict';
import { test } from 'node:test';

import { APP_FILE_PATHS, fetchAppFiles } from '../../plugin/server/src/net/app-files.js';
import { createHostGates } from '../../plugin/server/src/net/polite.js';
import { createRobotsCache } from '../../plugin/server/src/net/robots-cache.js';
import { fakeFetch } from './fake-fetch.js';

const A = 'https://a.test';
const AASA_URL = `${A}${APP_FILE_PATHS.aasa}`;
const LINKS_URL = `${A}${APP_FILE_PATHS.assetlinks}`;
const ROBOTS_OPEN = { text: 'User-agent: *\nAllow: /\n' };
const JSON_TYPE = { 'content-type': 'application/json' };
const noSleep = async () => {};
/** Isolated pacing and robots cache for each call. */
const isolated = () => ({ sleep: noSleep, hosts: createHostGates(), robotsCache: createRobotsCache() });

test('robots.txt first, then one GET of each file, as JSON, without following redirects', async () => {
  const { fetch, calls } = fakeFetch({
    [`${A}/robots.txt`]: ROBOTS_OPEN,
    [AASA_URL]: { headers: JSON_TYPE, text: '{"applinks":{"details":[]}}' },
    [LINKS_URL]: { headers: { 'content-type': 'application/json; charset=utf-8' }, text: '﻿[]' },
  });
  const files = await fetchAppFiles(A, { fetch, ...isolated() });
  assert.deepEqual(calls.map((call) => [call.url, call.options.method ?? 'GET']), [[`${A}/robots.txt`, 'GET'], [AASA_URL, 'GET'], [LINKS_URL, 'GET']]);
  assert.equal(calls[1].options.maxRedirects, 0);
  assert.equal(calls[1].options.headers.accept, 'application/json');
  assert.deepEqual(files.aasa, { url: AASA_URL, outcome: 'answered', status: 200, reason: null, location: null, final_url: null, content_type: 'application/json', body: '{"applinks":{"details":[]}}' });
  assert.equal(files.assetlinks.body, '[]', 'a byte order mark is dropped');
});

test('404, an HTML page and an empty body all mean there is no file, the body deciding over the content type; a refusal or server error is unverifiable', async () => {
  const { fetch } = fakeFetch({
    [`${A}/robots.txt`]: { status: 404 },
    [AASA_URL]: { headers: { 'content-type': 'text/html' }, text: '<!doctype html><title>Home</title>' },
    [LINKS_URL]: { text: '   ' },
  });
  const files = await fetchAppFiles(A, { fetch, ...isolated() });
  assert.deepEqual([files.aasa.outcome, files.aasa.reason, files.aasa.body], ['not_found', 'html_page', null]);
  assert.deepEqual([files.assetlinks.outcome, files.assetlinks.reason], ['not_found', 'empty']);
  const refused = await fetchAppFiles(A, { fetch: fakeFetch({ [AASA_URL]: { status: 403 }, [LINKS_URL]: { status: 503 } }).fetch, ...isolated() });
  assert.deepEqual([refused.aasa.outcome, refused.aasa.reason, refused.assetlinks.reason], ['unverifiable', 'status_403', 'status_503']);
  // Found on a real site in the validation of 2026-11-13: the file itself, sent as text/html.
  const mislabelled = await fetchAppFiles(A, { fetch: fakeFetch({ [AASA_URL]: { headers: { 'content-type': 'text/html; charset=utf-8' }, text: '{"webcredentials":{"apps":[]}}' } }).fetch, ...isolated() });
  assert.deepEqual([mislabelled.aasa.outcome, mislabelled.aasa.content_type], ['answered', 'text/html']);
  const gone = await fetchAppFiles(A, { fetch: fakeFetch({ [AASA_URL]: { status: 410 } }).fetch, ...isolated() });
  assert.deepEqual([gone.aasa.outcome, gone.aasa.status, gone.assetlinks.outcome], ['not_found', 410, 'not_found']);
});

test('a redirect is recorded and followed on the site, to learn whether the file is behind it', async () => {
  const { fetch, calls } = fakeFetch({
    [AASA_URL]: { status: 301, headers: { location: `https://www.a.test${APP_FILE_PATHS.aasa}` } },
    [`https://www.a.test${APP_FILE_PATHS.aasa}`]: { headers: JSON_TYPE, text: '{"applinks":{}}' },
    [LINKS_URL]: { status: 302, headers: { location: '/' } },
    [`${A}/`]: { headers: { 'content-type': 'text/html' }, text: '<html>home</html>' },
  });
  const files = await fetchAppFiles(A, { fetch, ...isolated(), sameSite: (url) => new URL(url).hostname.endsWith('a.test') });
  assert.deepEqual([files.aasa.outcome, files.aasa.status, files.aasa.location, files.aasa.final_url], ['answered', 301, `https://www.a.test${APP_FILE_PATHS.aasa}`, `https://www.a.test${APP_FILE_PATHS.aasa}`]);
  assert.deepEqual([files.assetlinks.outcome, files.assetlinks.status, files.assetlinks.reason], ['not_found', 302, 'html_page'], 'a redirect to a page means no file');
  assert.ok(calls.some((call) => call.url === 'https://www.a.test/robots.txt'), 'each new origin\'s robots.txt is read');
});

test('a redirect off the site, to Google Play or a social platform, or past three steps is not followed', async () => {
  const away = await fetchAppFiles(A, {
    fetch: fakeFetch({ [AASA_URL]: { status: 302, headers: { location: 'https://cdn.other.test/aasa' } }, [LINKS_URL]: { status: 302, headers: { location: 'https://play.google.com/store' } } }).fetch,
    ...isolated(), sameSite: () => true,
  });
  assert.equal(away.aasa.outcome, 'not_found', 'a host the caller accepts is followed');
  assert.deepEqual([away.assetlinks.outcome, away.assetlinks.reason], ['unverifiable', 'Not requested: Seekwide never contacts Google Play']);
  const { fetch, calls } = fakeFetch({ [AASA_URL]: { status: 302, headers: { location: 'https://cdn.other.test/aasa' } } });
  const offSite = await fetchAppFiles(A, { fetch, ...isolated() });
  assert.equal(offSite.aasa.reason, 'Redirects off the site, so not followed');
  assert.ok(!calls.some((call) => call.url.startsWith('https://cdn.other.test')));
  const hops = Object.fromEntries([0, 1, 2, 3].map((i) => [`${A}/r${i}`, { status: 302, headers: { location: `${A}/r${i + 1}` } }]));
  const many = await fetchAppFiles(A, { fetch: fakeFetch({ ...hops, [AASA_URL]: { status: 302, headers: { location: `${A}/r0` } } }).fetch, ...isolated() });
  assert.deepEqual([many.aasa.outcome, many.aasa.reason], ['unverifiable', 'too_many_redirects']);
});

test('a file robots.txt disallows is never requested, and an unreadable robots.txt stops both files', async () => {
  const { fetch, calls } = fakeFetch({ [`${A}/robots.txt`]: { text: 'User-agent: *\nDisallow: /.well-known/\n' } });
  const files = await fetchAppFiles(A, { fetch, ...isolated() });
  assert.deepEqual([files.aasa.outcome, files.assetlinks.outcome], ['disallowed', 'disallowed']);
  assert.deepEqual(calls.map((call) => call.url), [`${A}/robots.txt`]);
  const down = await fetchAppFiles(A, { fetch: fakeFetch({ [`${A}/robots.txt`]: { status: 503 } }).fetch, ...isolated() });
  assert.deepEqual([down.aasa.outcome, down.aasa.reason], ['unverifiable', 'robots.txt could not be read']);
});

test('a body over the limit is not read as a file, and bad options are refused', async () => {
  const { fetch, calls } = fakeFetch({ [AASA_URL]: { headers: JSON_TYPE, text: '{"applinks":{}', truncated: true } });
  const files = await fetchAppFiles(A, { fetch, ...isolated(), maxBytes: 10 });
  assert.deepEqual([files.aasa.outcome, files.aasa.reason], ['unverifiable', 'Larger than 0 KiB, so not read']);
  assert.equal(calls.find((call) => call.url === AASA_URL)?.options.maxBytes, 10);
  await assert.rejects(fetchAppFiles('ftp://a.test', { fetch }), TypeError);
  await assert.rejects(fetchAppFiles(A, { fetch, maxBytes: 0 }), TypeError);
});

test('no request starts after the audit was cancelled', async () => {
  const controller = new AbortController();
  controller.abort(new Error('cancelled'));
  const { fetch, calls } = fakeFetch({});
  await assert.rejects(fetchAppFiles(A, { fetch, ...isolated(), signal: controller.signal }), /cancelled/);
  assert.equal(calls.length, 0);
});
