import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { USER_AGENT } from '../../server/src/config.js';
import { CRUX_ENDPOINT, queryCrux } from '../../server/src/vitals/crux.js';
import { CRUX_PATH, INVALID_KEY, NO_CRUX_DATA, cruxAnswer, googleError, startGoogle } from '../helpers/google-api.js';

/** @import { Reply, SeenRequest } from '../helpers/google-api.js' */

const KEY = 'AIzaTestKey-123_abc';

/** @type {Awaited<ReturnType<typeof startGoogle>>} */
let google;
/** @type {(request: SeenRequest) => Reply} */
let answer;

before(async () => {
  google = await startGoogle({ crux: (request) => answer(request) });
});
beforeEach(() => {
  google.requests.length = 0;
  answer = (request) => ({ json: cruxAnswer(request.body) });
});
after(() => google.close());

/** @param {Parameters<typeof queryCrux>[0]} target @param {Partial<Parameters<typeof queryCrux>[1]>} [options] */
const query = (target, options = {}) => queryCrux(target, { apiKey: KEY, endpoint: google.cruxEndpoint, fetchOptions: { allowLoopback: true }, ...options });

test('the endpoint is the one in the API reference', () => {
  assert.equal(CRUX_ENDPOINT, 'https://chromeuxreport.googleapis.com/v1/records:queryRecord');
});

test('sends one POST with the URL, the phone form factor and the three Core Web Vitals', async () => {
  const result = await query({ url: 'https://example.test/pricing' });
  assert.equal(result.ok, true);
  assert.equal(google.requests.length, 1);
  const [request] = google.requests;
  assert.equal(request.method, 'POST');
  assert.equal(request.path, CRUX_PATH);
  assert.deepEqual(request.query, {}, 'nothing in the query string, the key included');
  assert.deepEqual(request.body, {
    url: 'https://example.test/pricing',
    formFactor: 'PHONE',
    metrics: ['largest_contentful_paint', 'interaction_to_next_paint', 'cumulative_layout_shift'],
  });
  assert.equal(request.headers['content-type'], 'application/json');
  assert.equal(request.headers['x-goog-api-key'], KEY);
  assert.equal(request.headers['user-agent'], USER_AGENT);
});

test('an origin is asked for as an origin', async () => {
  await query({ origin: 'https://example.test' });
  assert.equal(google.requests[0].body.origin, 'https://example.test');
  assert.equal(google.requests[0].body.url, undefined);
});

test('returns the 75th percentiles, the share of good loads and the collection period', async () => {
  answer = () => ({ json: cruxAnswer({ lcp: 3140, inp: 232, cls: '0.31' }) });
  assert.deepEqual(await query({ url: 'https://example.test/' }), {
    ok: true,
    record: {
      lcp_ms: { p75: 3140, good: 0.8234 },
      inp_ms: { p75: 232, good: 0.9 },
      cls: { p75: 0.31, good: 0.93 },
      period: { first: '2026-10-12', last: '2026-11-08' },
    },
  });
});

test('the share of good loads is left out when Google draws the boundary elsewhere', async () => {
  answer = () => ({ json: cruxAnswer({ lcpEnd: 2000 }) });
  const result = await query({ url: 'https://example.test/' });
  assert.ok(result.ok && result.record);
  assert.deepEqual(result.record.lcp_ms, { p75: 2100, good: null });
  assert.equal(result.record.inp_ms?.good, 0.9);
});

test('a record can hold only some of the metrics', async () => {
  answer = () => ({ json: cruxAnswer({ inp: null }) });
  const result = await query({ url: 'https://example.test/' });
  assert.ok(result.ok && result.record);
  assert.equal(result.record.inp_ms, null);
  assert.equal(result.record.lcp_ms?.p75, 2100);
  assert.equal(result.record.cls?.p75, 0.05);
});

test('"not found" means Google has no data: an answer, not a failure', async () => {
  answer = () => NO_CRUX_DATA;
  assert.deepEqual(await query({ url: 'https://example.test/quiet-page' }), { ok: true, record: null });
});

test('a record without any of the three metrics is no data', async () => {
  answer = () => ({ json: cruxAnswer({ lcp: null, inp: null, cls: null }) });
  assert.deepEqual(await query({ origin: 'https://example.test' }), { ok: true, record: null });
  answer = () => ({ json: {} });
  assert.deepEqual(await query({ origin: 'https://example.test' }), { ok: true, record: null });
});

test('a 404 that is not Google\'s own "not found" is a failure', async () => {
  answer = () => ({ status: 404, body: '<html>Not found</html>' });
  assert.deepEqual(await query({ url: 'https://example.test/' }), { ok: false, failure: { kind: 'bad_response', status: 404, reason: null } });
});

test('a record for another form factor is refused', async () => {
  answer = () => ({ json: cruxAnswer({ formFactor: 'DESKTOP' }) });
  assert.deepEqual(await query({ url: 'https://example.test/' }), { ok: false, failure: { kind: 'bad_response', status: 200, reason: null } });
});

test('values that are not measurements are ignored, and a period that is not a date is dropped', async () => {
  const json = cruxAnswer();
  /** @type {any} */ (json.record.metrics.largest_contentful_paint).percentiles.p75 = 'fast';
  /** @type {any} */ (json.record.metrics.interaction_to_next_paint).percentiles = {};
  /** @type {any} */ (json.record.metrics.cumulative_layout_shift).histogram = 'none';
  /** @type {any} */ (json.record.collectionPeriod).firstDate = { year: 2026, month: 13, day: 1 };
  answer = () => ({ json });
  assert.deepEqual(await query({ url: 'https://example.test/' }), {
    ok: true,
    record: { lcp_ms: null, inp_ms: null, cls: { p75: 0.05, good: null }, period: null },
  });
});

test('refusals and errors are failures, never exceptions', async () => {
  answer = () => INVALID_KEY;
  assert.deepEqual(await query({ url: 'https://example.test/' }), { ok: false, failure: { kind: 'key_invalid', status: 400, reason: 'API_KEY_INVALID' } });
  answer = () => googleError(403, 'PERMISSION_DENIED', 'ACCESS_DENIED');
  assert.deepEqual(await query({ url: 'https://example.test/' }), { ok: false, failure: { kind: 'permission', status: 403, reason: 'ACCESS_DENIED' } });
  answer = () => googleError(429, 'RESOURCE_EXHAUSTED', 'RATE_LIMIT_EXCEEDED');
  assert.deepEqual(await query({ url: 'https://example.test/' }), { ok: false, failure: { kind: 'quota', status: 429, reason: 'RATE_LIMIT_EXCEEDED' } });
  answer = () => ({ hang: true });
  assert.deepEqual(await query({ url: 'https://example.test/' }, { timeoutMs: 80 }), { ok: false, failure: { kind: 'timeout', status: 0, reason: 'timeout' } });
});

test('a redirect from the API is not followed, so the body and the key go nowhere else', async () => {
  answer = () => ({ status: 307, headers: { location: `${google.origin}/elsewhere` }, json: {} });
  const result = await query({ url: 'https://example.test/' });
  assert.deepEqual(result, { ok: false, failure: { kind: 'bad_response', status: 307, reason: null } });
  assert.deepEqual(google.raw.filter((seen) => seen.url.startsWith('/elsewhere')), []);
});
