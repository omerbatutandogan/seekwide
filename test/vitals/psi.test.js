import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { USER_AGENT } from '../../plugin/server/src/config.js';
import { PSI_ENDPOINT, runPagespeed } from '../../plugin/server/src/vitals/psi.js';
import { INVALID_KEY, KEYLESS_PSI, PSI_PATH, googleError, psiAnswer, startGoogle } from '../helpers/google-api.js';

/** @import { Reply, SeenRequest } from '../helpers/google-api.js' */

const PAGE = 'https://example.test/blog/a post?x=1&y=ü';
const KEY = 'AIzaTestKey-123_abc';

/** @type {Awaited<ReturnType<typeof startGoogle>>} */
let google;
/** @type {(request: SeenRequest) => Reply} */
let answer;

before(async () => {
  google = await startGoogle({ psi: (request) => answer(request) });
});
beforeEach(() => {
  google.requests.length = 0;
  answer = (request) => ({ json: psiAnswer({ url: request.query.url }) });
});
after(() => google.close());

/** @param {string} url @param {Parameters<typeof runPagespeed>[1]} [options] */
const run = (url, options = {}) => runPagespeed(url, { endpoint: google.psiEndpoint, fetchOptions: { allowLoopback: true }, ...options });

test('the endpoint is the one in the API reference', () => {
  assert.equal(PSI_ENDPOINT, 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed');
});

test('sends one GET with the page URL, the performance category and the mobile strategy', async () => {
  const result = await run(PAGE, { apiKey: KEY });
  assert.equal(result.ok, true);
  assert.equal(google.requests.length, 1);
  const [request] = google.requests;
  assert.equal(request.method, 'GET');
  assert.equal(request.path, PSI_PATH);
  assert.deepEqual(request.query, { url: PAGE, category: 'PERFORMANCE', strategy: 'MOBILE' });
  assert.equal(request.headers['x-goog-api-key'], KEY);
  assert.equal(request.headers['user-agent'], USER_AGENT);
  assert.ok(!google.raw.some((seen) => seen.url.includes(KEY)), 'the key is not in the URL');
});

test('without a key the request carries none', async () => {
  await run(PAGE);
  assert.equal(google.requests[0].headers['x-goog-api-key'], undefined);
  assert.deepEqual(Object.keys(google.requests[0].query).sort(), ['category', 'strategy', 'url']);
});

test('returns the three lab metrics, rounded, and the Lighthouse version', async () => {
  answer = () => ({ json: psiAnswer({ url: PAGE, lcp: 2513.49, cls: 0.10449, tbt: 199.5, version: '12.8.2' }) });
  assert.deepEqual(await run(PAGE), {
    ok: true,
    lab: { lcp_ms: 2513, cls: 0.104, tbt_ms: 200, lighthouse_version: '12.8.2', final_url: null },
  });
});

test('reads the lab result only, never the field data Google plans to remove from the answer', async () => {
  const result = await run(PAGE);
  assert.ok(result.ok);
  assert.equal(result.lab.lcp_ms, 1800, 'the loadingExperience value of 9999 ms is not used');
});

test('a metric Lighthouse could not compute is null; the others are kept', async () => {
  answer = () => ({ json: psiAnswer({ lcp: null }) });
  const result = await run(PAGE);
  assert.ok(result.ok);
  assert.deepEqual([result.lab.lcp_ms, result.lab.cls, result.lab.tbt_ms], [null, 0.02, 121]);
});

test('an answer without any of the three metrics is a failure, not empty data', async () => {
  answer = () => ({ json: psiAnswer({ lcp: null, cls: null, tbt: null }) });
  assert.deepEqual(await run(PAGE), { ok: false, failure: { kind: 'bad_response', status: 200, reason: 'NO_METRICS' } });
  answer = () => ({ json: { kind: 'pagespeedonline#result' } });
  assert.deepEqual(await run(PAGE), { ok: false, failure: { kind: 'bad_response', status: 200, reason: 'NO_METRICS' } });
});

test('values that are not measurements are ignored', async () => {
  const json = psiAnswer();
  /** @type {any} */ (json.lighthouseResult.audits['largest-contentful-paint']).numericValue = '1800';
  /** @type {any} */ (json.lighthouseResult.audits['cumulative-layout-shift']).numericValue = -1;
  /** @type {any} */ (json.lighthouseResult.audits['total-blocking-time']).numericValue = Number.NaN;
  answer = () => ({ json });
  assert.deepEqual(await run(PAGE), { ok: false, failure: { kind: 'bad_response', status: 200, reason: 'NO_METRICS' } });
});

test('a desktop result is refused, because the values are rated against the mobile thresholds', async () => {
  answer = () => ({ json: psiAnswer({ formFactor: 'desktop' }) });
  assert.deepEqual(await run(PAGE), { ok: false, failure: { kind: 'bad_response', status: 200, reason: 'NOT_MOBILE' } });
});

test('a page Lighthouse could not load is a page error with its code', async () => {
  answer = () => ({ json: psiAnswer({ runtimeError: { code: 'NO_FCP', message: 'The page did not paint any content.' } }) });
  assert.deepEqual(await run(PAGE), { ok: false, failure: { kind: 'page_error', status: 200, reason: 'NO_FCP' } });
  answer = () => ({ json: psiAnswer({ runtimeError: { code: 'something <odd>', message: '' } }) });
  assert.deepEqual(await run(PAGE), { ok: false, failure: { kind: 'page_error', status: 200, reason: null } });
  answer = () => ({ json: psiAnswer({ runtimeError: { code: 'NO_ERROR', message: '' } }) });
  assert.equal((await run(PAGE)).ok, true, 'NO_ERROR is not an error');
});

test('records where Google ended up when it was redirected', async () => {
  answer = () => ({ json: psiAnswer({ url: 'https://example.test/old', finalUrl: 'https://example.test/new#top' }) });
  const result = await run('https://example.test/old');
  assert.ok(result.ok);
  assert.equal(result.lab.final_url, 'https://example.test/new');
  answer = () => ({ json: psiAnswer({ url: 'https://example.test/x', finalUrl: 'javascript:alert(1)' }) });
  const odd = await run('https://example.test/x');
  assert.ok(odd.ok);
  assert.equal(odd.lab.final_url, null, 'only an http(s) URL is recorded');
});

test('a version that is not a version is dropped', async () => {
  answer = () => ({ json: psiAnswer({ version: '<script>alert(1)</script>' }) });
  const result = await run(PAGE);
  assert.ok(result.ok);
  assert.equal(result.lab.lighthouse_version, null);
});

test('the refusal Google gives without a key is a quota failure', async () => {
  answer = () => KEYLESS_PSI;
  assert.deepEqual(await run(PAGE), { ok: false, failure: { kind: 'quota', status: 429, reason: 'RATE_LIMIT_EXCEEDED' } });
});

test('a key Google does not accept, a server error and a slow answer are failures, never exceptions', async () => {
  answer = () => INVALID_KEY;
  assert.deepEqual(await run(PAGE, { apiKey: 'nope' }), { ok: false, failure: { kind: 'key_invalid', status: 400, reason: 'API_KEY_INVALID' } });
  answer = () => googleError(500, 'INTERNAL');
  assert.deepEqual(await run(PAGE), { ok: false, failure: { kind: 'server_error', status: 500, reason: 'INTERNAL' } });
  answer = () => ({ hang: true });
  assert.deepEqual(await run(PAGE, { timeoutMs: 80 }), { ok: false, failure: { kind: 'timeout', status: 0, reason: 'timeout' } });
});

test('a redirect from the API is not followed', async () => {
  answer = () => ({ status: 302, headers: { location: `${google.origin}/elsewhere` }, json: {} });
  const result = await run(PAGE, { apiKey: KEY });
  assert.deepEqual(result, { ok: false, failure: { kind: 'bad_response', status: 302, reason: null } });
  assert.deepEqual(google.raw.filter((seen) => seen.url.startsWith('/elsewhere')), []);
});

test('reads values shaped like the official Lighthouse sample result', async () => {
  // Numbers from core/test/results/sample_v2.json in the Lighthouse repository (13.6.0, read 2026-11-11).
  answer = () => ({ json: psiAnswer({ url: PAGE, lcp: 10884.681, cls: 0.099576, tbt: 1055.1980000000003, version: '13.6.0' }) });
  assert.deepEqual(await run(PAGE), {
    ok: true,
    lab: { lcp_ms: 10885, cls: 0.1, tbt_ms: 1055, lighthouse_version: '13.6.0', final_url: null },
  });
});
