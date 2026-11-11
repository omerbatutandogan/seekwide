import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { describeFailure, isServiceFailure, nonNegative, requestJson } from '../../server/src/vitals/google-api.js';
import { INVALID_KEY, KEYLESS_PSI, NO_CRUX_DATA, googleError } from '../helpers/google-api.js';
import { startServer } from '../helpers/http-server.js';

/** @import { ApiFailure } from '../../server/src/vitals/google-api.js' */

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
const LOOP = { fetchOptions: { allowLoopback: true } };
const KEY = 'AIzaTestKey-123_abc';

/** @param {import('../helpers/google-api.js').Reply} reply */
const json = (reply) => ({ status: reply.status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(reply.json) });

before(async () => {
  server = await startServer({
    '/ok': { headers: { 'content-type': 'application/json' }, body: '{"record": {"key": {}}}' },
    '/echo': (req, res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
    },
    '/quota': json(KEYLESS_PSI),
    '/exhausted': json(googleError(403, 'RESOURCE_EXHAUSTED', 'RATE_LIMIT_EXCEEDED')),
    '/key': json(INVALID_KEY),
    '/forbidden': json(googleError(403, 'PERMISSION_DENIED', 'SERVICE_DISABLED')),
    '/nodata': json(NO_CRUX_DATA),
    '/bad-request': json(googleError(400, 'INVALID_ARGUMENT')),
    '/boom': json(googleError(500, 'INTERNAL')),
    '/bad-gateway': { status: 502, body: '<html>Bad gateway</html>' },
    '/moved': { status: 302, redirect: '/echo' },
    '/not-json': { body: 'hello' },
    '/array': { headers: { 'content-type': 'application/json' }, body: '[1, 2]' },
    '/big': { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ filler: 'x'.repeat(5000) }) },
    '/hang': () => {},
  });
});

after(() => server.close());

/** @param {string} path @param {Parameters<typeof requestJson>[1]} [options] */
const call = (path, options = {}) => requestJson(`${server.origin}${path}`, { ...LOOP, ...options });

/** @param {Awaited<ReturnType<typeof requestJson>>} result @returns {ApiFailure} */
function failureOf(result) {
  assert.equal(result.ok, false, 'expected a failure');
  return /** @type {{failure: ApiFailure}} */ (result).failure;
}

test('a JSON answer is returned as data', async () => {
  const result = await call('/ok');
  assert.deepEqual(result, { ok: true, data: { record: { key: {} } } });
});

test('the key travels in the x-goog-api-key header and never in the URL', async () => {
  const result = await call('/echo?url=https%3A%2F%2Fexample.com%2F', { apiKey: KEY });
  assert.ok(result.ok);
  const seen = /** @type {any} */ (result.data);
  assert.equal(seen.method, 'GET');
  assert.equal(seen.headers['x-goog-api-key'], KEY);
  assert.equal(seen.headers.accept, 'application/json');
  assert.equal(seen.url, '/echo?url=https%3A%2F%2Fexample.com%2F');
  assert.ok(!JSON.stringify(server.requests.map((request) => request.url)).includes(KEY), 'no request URL contains the key');
});

test('without a key no key header is sent', async () => {
  const result = await call('/echo');
  assert.ok(result.ok);
  assert.equal(/** @type {any} */ (result.data).headers['x-goog-api-key'], undefined);
});

test('a POST sends its body as JSON', async () => {
  const result = await call('/echo', { method: 'POST', body: { origin: 'https://example.com', formFactor: 'PHONE' }, apiKey: KEY });
  assert.ok(result.ok);
  const seen = /** @type {any} */ (result.data);
  assert.equal(seen.method, 'POST');
  assert.equal(seen.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(seen.body), { origin: 'https://example.com', formFactor: 'PHONE' });
});

test('a redirect is not followed, so the key is not sent anywhere else', async () => {
  const before = server.requests.length;
  const failure = failureOf(await call('/moved', { apiKey: KEY }));
  assert.deepEqual(failure, { kind: 'bad_response', status: 302, reason: null });
  assert.deepEqual(server.requests.slice(before).map((request) => request.url), ['/moved']);
});

test('refusals are told apart: quota, a key Google does not accept, a key without permission', async () => {
  assert.deepEqual(failureOf(await call('/quota')), { kind: 'quota', status: 429, reason: 'RATE_LIMIT_EXCEEDED' });
  assert.deepEqual(failureOf(await call('/exhausted')), { kind: 'quota', status: 403, reason: 'RATE_LIMIT_EXCEEDED' });
  assert.deepEqual(failureOf(await call('/key', { apiKey: 'wrong' })), { kind: 'key_invalid', status: 400, reason: 'API_KEY_INVALID' });
  assert.deepEqual(failureOf(await call('/forbidden', { apiKey: KEY })), { kind: 'permission', status: 403, reason: 'SERVICE_DISABLED' });
});

test('"not found" is reported only when Google says so itself', async () => {
  assert.deepEqual(failureOf(await call('/nodata')), { kind: 'not_found', status: 404, reason: 'NOT_FOUND' });
  // A wrong address answers 404 too, with a page instead of Google's error; that is not "no data".
  assert.deepEqual(failureOf(await call('/no-such-path')), { kind: 'bad_response', status: 404, reason: null });
});

test('other errors keep their status and a machine-readable reason only', async () => {
  assert.deepEqual(failureOf(await call('/bad-request')), { kind: 'bad_request', status: 400, reason: 'INVALID_ARGUMENT' });
  assert.deepEqual(failureOf(await call('/boom')), { kind: 'server_error', status: 500, reason: 'INTERNAL' });
  assert.deepEqual(failureOf(await call('/bad-gateway')), { kind: 'server_error', status: 502, reason: null });
});

test('a failure never carries text written by the service', async () => {
  for (const path of ['/quota', '/key', '/forbidden', '/nodata', '/boom']) {
    const failure = failureOf(await call(path, { apiKey: KEY }));
    const text = `${JSON.stringify(failure)} ${describeFailure('psi', failure, true)}`;
    assert.ok(!/project_number|1234567890|Quota exceeded|API key not valid/.test(text), `${path}: ${text}`);
    assert.ok(!text.includes(KEY));
  }
});

test('answers that cannot be used are bad responses', async () => {
  assert.deepEqual(failureOf(await call('/not-json')), { kind: 'bad_response', status: 200, reason: null });
  assert.deepEqual(failureOf(await call('/array')), { kind: 'bad_response', status: 200, reason: null });
  assert.deepEqual(failureOf(await call('/big', { maxBytes: 1000 })), { kind: 'bad_response', status: 200, reason: 'TOO_LARGE' });
});

test('no answer in time is a timeout; no connection is a network failure', async () => {
  assert.deepEqual(failureOf(await call('/hang', { timeoutMs: 80 })), { kind: 'timeout', status: 0, reason: 'timeout' });
  const refused = failureOf(await requestJson('http://127.0.0.1:1/', LOOP));
  assert.deepEqual(refused, { kind: 'network', status: 0, reason: 'connection_error' });
  // Without the test-only loopback permission the same address is refused before any connection.
  assert.deepEqual(failureOf(await requestJson(`${server.origin}/ok`)), { kind: 'network', status: 0, reason: 'blocked_address' });
});

test('a key that cannot be a header value fails without leaking it', async () => {
  const failure = failureOf(await call('/echo', { apiKey: 'bad\nkey' }));
  assert.equal(failure.kind, 'network');
  assert.ok(!JSON.stringify(failure).includes('bad'));
});

test('service failures stop an audit from asking again; page failures do not', () => {
  /** @param {ApiFailure['kind']} kind */
  const failure = (kind) => ({ kind, status: 0, reason: null });
  for (const kind of /** @type {const} */ (['quota', 'key_invalid', 'permission', 'network'])) assert.equal(isServiceFailure(failure(kind)), true, kind);
  for (const kind of /** @type {const} */ (['timeout', 'server_error', 'bad_request', 'bad_response', 'page_error', 'not_found'])) assert.equal(isServiceFailure(failure(kind)), false, kind);
});

test('describeFailure says what happened and what to do', () => {
  /** @param {ApiFailure['kind']} kind @param {number} [status] @param {string|null} [reason] */
  const failure = (kind, status = 0, reason = null) => ({ kind, status, reason });
  assert.equal(
    describeFailure('psi', failure('quota', 429), false),
    "PageSpeed Insights refused the request: Google's quota for requests without an API key is used up. Add a Google API key in the plugin settings.",
  );
  assert.equal(describeFailure('psi', failure('quota', 429), true), 'PageSpeed Insights refused the request: the quota of the Google API key is used up for now. Try again later.');
  assert.equal(describeFailure('crux', failure('key_invalid', 400), true), 'The Chrome UX Report API did not accept the Google API key. Check the key in the plugin settings.');
  assert.match(describeFailure('crux', failure('permission', 403), true), /Enable this API for the key's Google Cloud project/);
  assert.match(describeFailure('psi', failure('permission', 403), false), /carried no API key\. Add a Google API key/);
  assert.equal(describeFailure('psi', failure('timeout'), true), 'PageSpeed Insights did not answer in time.');
  assert.equal(describeFailure('psi', failure('network', 0, 'dns_temporary'), true), 'PageSpeed Insights could not be reached (dns_temporary).');
  assert.equal(describeFailure('psi', failure('server_error', 500, 'INTERNAL'), true), 'PageSpeed Insights answered with an error of its own (HTTP 500, INTERNAL).');
  assert.equal(describeFailure('psi', failure('bad_request', 400), true), 'PageSpeed Insights could not handle the request (HTTP 400).');
  assert.equal(describeFailure('psi', failure('page_error', 200, 'NO_FCP'), true), 'PageSpeed Insights could not load the page (NO_FCP).');
  assert.equal(describeFailure('psi', failure('bad_response', 200, 'NOT_MOBILE'), true), 'PageSpeed Insights tested the page as a desktop browser, not as the phone that was asked for.');
  assert.equal(describeFailure('psi', failure('bad_response', 200, 'TOO_LARGE'), true), 'PageSpeed Insights sent an answer that was too large to read.');
  assert.equal(describeFailure('crux', failure('bad_response', 200), true), 'The Chrome UX Report API sent an answer that could not be read (HTTP 200).');
  assert.equal(describeFailure('crux', failure('not_found', 404), true), 'The Chrome UX Report API has no data for this address.');
});

test('nonNegative accepts numbers and numeric strings, and nothing else', () => {
  assert.equal(nonNegative(2500), 2500);
  assert.equal(nonNegative('0.05'), 0.05);
  assert.equal(nonNegative(0), 0);
  for (const value of [-1, NaN, Infinity, '', ' ', 'abc', null, undefined, {}, [], true]) assert.equal(nonNegative(value), null, String(value));
});
