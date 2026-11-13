import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { LIMITS } from '../../plugin/server/src/config.js';
import { queryCrux } from '../../plugin/server/src/vitals/crux.js';
import { measureVitals, unavailableVitals } from '../../plugin/server/src/vitals/measure.js';
import { runPagespeed } from '../../plugin/server/src/vitals/psi.js';
import { SITE, makeCrawl, makeField, makeLab, makePage } from '../helpers/factories.js';
import { INVALID_KEY, KEYLESS_PSI, NO_CRUX_DATA, cruxAnswer, psiAnswer, startGoogle } from '../helpers/google-api.js';

/** @import { ApiFailure } from '../../plugin/server/src/vitals/google-api.js' */
/** @import { CrawlResult, FieldRecord, LabMetrics } from '../../plugin/server/src/types.js' */

const KEY = 'AIzaTestKey-123_abc';
const NO_KEY = 'No Google API key is set, and the Chrome UX Report API requires one. Add a key in the plugin settings to collect field data.';
const KEYLESS_QUOTA = "PageSpeed Insights refused the request: Google's quota for requests without an API key is used up. Add a Google API key in the plugin settings.";

/** A site with a start page, a blog of three posts and a shop of two products. */
function site(overrides = {}) {
  /** @param {string} path @param {number} depth */
  const page = (path, depth) => makePage({ url: `${SITE}${path}`, depth });
  return makeCrawl({
    pages: [page('/', 0), page('/blog/a', 2), page('/blog/b', 2), page('/blog/c', 2), page('/shop/x', 2), page('/shop/y', 2), page('/about', 1)],
    ...overrides,
  });
}

/** @param {ApiFailure['kind']} kind @param {number} [status] */
const failure = (kind, status = 0) => ({ ok: /** @type {const} */ (false), failure: { kind, status, reason: null } });

/**
 * Fake clients that record every call.
 * @param {{lab?: (url: string) => {ok: true, lab: LabMetrics}|{ok: false, failure: ApiFailure},
 *          field?: (target: {url?: string, origin?: string}) => {ok: true, record: FieldRecord|null}|{ok: false, failure: ApiFailure}}} [answers]
 */
function clients(answers = {}) {
  /** @type {{url: string, apiKey: unknown}[]} */
  const psiCalls = [];
  /** @type {{target: object, apiKey: unknown}[]} */
  const cruxCalls = [];
  let running = 0;
  let peak = 0;
  return {
    psiCalls,
    cruxCalls,
    peak: () => peak,
    /** @type {typeof runPagespeed} */
    runPagespeed: async (url, options) => {
      psiCalls.push({ url, apiKey: options?.apiKey });
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setImmediate(resolve));
      running -= 1;
      return answers.lab ? answers.lab(url) : { ok: true, lab: makeLab() };
    },
    /** @type {typeof queryCrux} */
    queryCrux: async (target, options) => {
      cruxCalls.push({ target, apiKey: options.apiKey });
      return answers.field ? answers.field(target) : { ok: true, record: makeField() };
    },
  };
}

test('with a key: lab data for the chosen pages, field data for the origin and each page', async () => {
  const fake = clients();
  const vitals = await measureVitals(site(), { apiKey: KEY, ...fake });

  assert.deepEqual(vitals.lab, { available: true, reason: null, device: 'mobile' });
  assert.deepEqual(vitals.field, { available: true, reason: null, form_factor: 'phone' });
  assert.deepEqual(vitals.pages.map((page) => [page.url, page.why]), [
    [`${SITE}/`, 'Start page'],
    [`${SITE}/blog/a`, 'One of 3 pages under /blog/'],
    [`${SITE}/shop/x`, 'One of 2 pages under /shop/'],
  ]);
  for (const page of vitals.pages) {
    assert.deepEqual(page.lab, makeLab());
    assert.deepEqual(page.field, makeField());
    assert.equal(page.lab_note, null);
    assert.equal(page.field_note, null);
  }
  assert.deepEqual(vitals.origin, { origin: SITE, field: makeField(), field_note: null });
  assert.deepEqual(vitals.notes, []);

  assert.deepEqual(fake.psiCalls.map((call) => call.url).sort(), [`${SITE}/`, `${SITE}/blog/a`, `${SITE}/shop/x`]);
  assert.ok(fake.psiCalls.every((call) => call.apiKey === KEY));
  assert.deepEqual(fake.cruxCalls.map((call) => call.target), [{ origin: SITE }, { url: `${SITE}/` }, { url: `${SITE}/blog/a` }, { url: `${SITE}/shop/x` }]);
});

test('the budget: maxPages bounds the tests, and at most three run at once', async () => {
  const fake = clients();
  const vitals = await measureVitals(site(), { apiKey: KEY, maxPages: 7, ...fake });
  assert.equal(vitals.pages.length, 7);
  assert.equal(fake.psiCalls.length, 7);
  assert.equal(fake.cruxCalls.length, 8);
  assert.equal(fake.peak(), LIMITS.psiConcurrency);
  const one = clients();
  assert.equal((await measureVitals(site(), { apiKey: KEY, maxPages: 1, ...one })).pages.length, 1);
  assert.equal(one.psiCalls.length, 1);
});

test('without a key: one request at a time, the Chrome UX Report is not asked, and the reason is plain', async () => {
  const fake = clients();
  const vitals = await measureVitals(site(), fake);
  assert.equal(fake.peak(), 1);
  assert.deepEqual(fake.psiCalls.map((call) => call.apiKey), [null, null, null]);
  assert.deepEqual(fake.cruxCalls, []);
  assert.equal(vitals.lab.available, true);
  assert.deepEqual(vitals.field, { available: false, reason: NO_KEY, form_factor: 'phone' });
  assert.deepEqual(vitals.notes, [NO_KEY]);
  assert.ok(vitals.pages.every((page) => page.field === null && page.field_note === null));
});

test('a refusal without a key stops after the first request and never fails', async () => {
  const fake = clients({ lab: () => ({ ok: false, failure: { kind: 'quota', status: 429, reason: 'RATE_LIMIT_EXCEEDED' } }) });
  const vitals = await measureVitals(site(), fake);
  assert.equal(fake.psiCalls.length, 1, 'the other pages are not requested');
  assert.deepEqual(vitals.lab, { available: false, reason: KEYLESS_QUOTA, device: 'mobile' });
  assert.equal(vitals.pages[0].lab_note, KEYLESS_QUOTA);
  assert.equal(vitals.pages[1].lab_note, 'Not asked: an earlier request in this audit was refused.');
  assert.deepEqual(vitals.notes, [KEYLESS_QUOTA, NO_KEY]);
});

test('a key Google does not accept stops both services, each with its own reason', async () => {
  const refused = { ok: /** @type {const} */ (false), failure: /** @type {ApiFailure} */ ({ kind: 'key_invalid', status: 400, reason: 'API_KEY_INVALID' }) };
  const fake = clients({ lab: () => refused, field: () => refused });
  const vitals = await measureVitals(site(), { apiKey: 'wrong', ...fake });
  assert.equal(fake.cruxCalls.length, 1, 'only the origin was asked');
  assert.ok(fake.psiCalls.length <= LIMITS.psiConcurrency, 'only the tests already under way were sent');
  assert.equal(vitals.lab.available, false);
  assert.equal(vitals.lab.reason, 'PageSpeed Insights did not accept the Google API key. Check the key in the plugin settings.');
  assert.equal(vitals.field.available, false);
  assert.equal(vitals.field.reason, 'The Chrome UX Report API did not accept the Google API key. Check the key in the plugin settings.');
  assert.equal(vitals.origin.field_note, vitals.field.reason);
  assert.equal(vitals.pages[0].field_note, 'Not asked: an earlier request in this audit was refused.');
  assert.deepEqual(vitals.notes, [vitals.lab.reason, vitals.field.reason]);
});

test('a page that cannot be tested does not stop the others, and the note names it', async () => {
  const fake = clients({ lab: (url) => (url.endsWith('/blog/a') ? failure('timeout') : { ok: true, lab: makeLab() }) });
  const vitals = await measureVitals(site(), { apiKey: KEY, ...fake });
  assert.equal(fake.psiCalls.length, 3);
  assert.equal(vitals.lab.available, true);
  assert.equal(vitals.pages[1].lab, null);
  assert.equal(vitals.pages[1].lab_note, 'PageSpeed Insights did not answer in time.');
  assert.deepEqual(vitals.notes, [
    `PageSpeed Insights tested 2 of 3 pages. Without a lab result: ${SITE}/blog/a (PageSpeed Insights did not answer in time.).`,
  ]);
});

test('when no page gives a result the reason is the first problem', async () => {
  const fake = clients({ lab: () => failure('server_error', 500) });
  const vitals = await measureVitals(site(), { apiKey: KEY, ...fake });
  assert.equal(fake.psiCalls.length, 3, 'a page-level failure does not stop the rest');
  assert.equal(vitals.lab.available, false);
  assert.equal(
    vitals.lab.reason,
    'PageSpeed Insights returned no result for any of the 3 tested pages. The first problem: PageSpeed Insights answered with an error of its own (HTTP 500).',
  );
});

test('more than three pages without a result are counted, not all named', async () => {
  const fake = clients({ lab: (url) => (url === `${SITE}/` ? { ok: true, lab: makeLab() } : failure('timeout')) });
  const vitals = await measureVitals(site(), { apiKey: KEY, maxPages: 6, ...fake });
  assert.match(vitals.notes[0], /^PageSpeed Insights tested 1 of 6 pages\. Without a lab result: .*; and 2 more\.$/);
});

test('no new test starts once the time budget is used up', async () => {
  let clock = 0;
  const fake = clients({
    lab: () => {
      clock += 40_000;
      return { ok: true, lab: makeLab() };
    },
  });
  const vitals = await measureVitals(site(), { apiKey: KEY, maxPages: 7, concurrency: 1, deadlineMs: 90_000, now: () => clock, ...fake });
  assert.equal(fake.psiCalls.length, 3, 'tests start at 0, 40 and 80 seconds; the fourth would start at 120');
  assert.equal(vitals.pages[3].lab_note, 'Not tested: the time set aside for PageSpeed Insights ran out.');
  assert.equal(vitals.lab.available, true);
  assert.match(vitals.notes[0], /tested 3 of 7 pages/);
});

test('"no data" from the Chrome UX Report is an answer: the checks can run and the note explains', async () => {
  const fake = clients({ field: () => ({ ok: true, record: null }) });
  const vitals = await measureVitals(site(), { apiKey: KEY, ...fake });
  assert.equal(fake.cruxCalls.length, 4, 'every address is asked');
  assert.deepEqual(vitals.field, { available: true, reason: null, form_factor: 'phone' });
  assert.equal(vitals.origin.field_note, 'The Chrome UX Report has no phone data for this site.');
  assert.equal(vitals.pages[0].field_note, 'The Chrome UX Report has no phone data for this page.');
  assert.deepEqual(vitals.notes, [
    'The Chrome UX Report has no phone data for this site or for the tested pages. It only publishes data for sites and pages with enough visits from Chrome users.',
  ]);
});

test('origin data without page data is the common case and needs no note', async () => {
  const fake = clients({ field: (target) => ({ ok: true, record: 'origin' in target ? makeField() : null }) });
  const vitals = await measureVitals(site(), { apiKey: KEY, ...fake });
  assert.deepEqual(vitals.origin.field, makeField());
  assert.ok(vitals.pages.every((page) => page.field === null));
  assert.deepEqual(vitals.notes, []);
});

test('a field failure for one address does not stop the others', async () => {
  const fake = clients({ field: (target) => ('origin' in target ? failure('server_error', 503) : { ok: true, record: makeField() }) });
  const vitals = await measureVitals(site(), { apiKey: KEY, ...fake });
  assert.equal(fake.cruxCalls.length, 4);
  assert.equal(vitals.field.available, true);
  assert.equal(vitals.field.reason, null);
  assert.equal(vitals.origin.field_note, 'The Chrome UX Report API answered with an error of its own (HTTP 503).');
});

test('a Chrome UX Report request that hangs stops the rest: that API never loads the page, so the service is at fault', async () => {
  const fake = clients({ field: () => failure('timeout') });
  const vitals = await measureVitals(site(), { apiKey: KEY, ...fake });
  assert.equal(fake.cruxCalls.length, 1, 'eleven timeouts in a row would hold the audit for minutes');
  assert.equal(vitals.origin.field_note, 'The Chrome UX Report API did not answer in time.');
  assert.equal(vitals.pages[0].field_note, 'Not asked: the Chrome UX Report API did not answer an earlier request in time.');
  assert.deepEqual(vitals.field, { available: false, reason: 'The Chrome UX Report API did not answer in time.', form_factor: 'phone' });
  assert.equal(vitals.lab.available, true, 'the lab tests are not affected');
});

test('the time budget covers the Chrome UX Report too', async () => {
  let clock = 0;
  const fake = clients({
    field: () => {
      clock += 40_000;
      return { ok: true, record: makeField() };
    },
  });
  const vitals = await measureVitals(site(), { apiKey: KEY, maxPages: 5, deadlineMs: 90_000, now: () => clock, ...fake });
  assert.equal(fake.cruxCalls.length, 3, 'requests start at 0, 40 and 80 seconds; the fourth would start at 120');
  assert.deepEqual(vitals.origin.field, makeField());
  assert.deepEqual(vitals.pages[1].field, makeField(), 'the third request, for the second page, was still sent');
  assert.equal(vitals.pages[2].field_note, 'Not asked: the time set aside for the measurement ran out.');
  assert.equal(vitals.pages[4].field_note, 'Not asked: the time set aside for the measurement ran out.');
  assert.equal(vitals.field.available, true);

  const never = clients();
  const late = await measureVitals(site(), { apiKey: KEY, deadlineMs: 0, ...never });
  assert.deepEqual([never.psiCalls.length, never.cruxCalls.length], [0, 0]);
  assert.equal(late.field.reason, 'Not asked: the time set aside for the measurement ran out.');
  assert.match(late.lab.reason ?? '', /The first problem: Not tested: the time set aside for PageSpeed Insights ran out\.$/);
});

test('a client that throws is a bug, not an answer: nothing new is sent and the error surfaces once nothing is in flight', async () => {
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  // The first test to come back throws, while two others are under way and four pages are still waiting.
  const brokenLab = clients({
    lab: (url) => {
      if (url === `${SITE}/`) throw new Error('lab client bug');
      return { ok: true, lab: makeLab() };
    },
  });
  await assert.rejects(measureVitals(site(), { apiKey: KEY, maxPages: 7, ...brokenLab }), /lab client bug/);
  await tick();
  await tick();
  assert.equal(brokenLab.psiCalls.length, LIMITS.psiConcurrency, 'only the tests that were already under way were sent');

  const brokenField = clients({
    field: () => {
      throw new Error('field client bug');
    },
  });
  await assert.rejects(measureVitals(site(), { apiKey: KEY, maxPages: 7, ...brokenField }), /field client bug/);
  await tick();
  await tick();
  assert.equal(brokenField.cruxCalls.length, 1);
  assert.equal(brokenField.psiCalls.length, LIMITS.psiConcurrency);
});

test('a redirect followed by Google is noted', async () => {
  const fake = clients({ lab: (url) => ({ ok: true, lab: makeLab({ final_url: url === `${SITE}/` ? `${SITE}/home` : null }) }) });
  const vitals = await measureVitals(site(), { apiKey: KEY, ...fake });
  assert.deepEqual(vitals.notes, [`PageSpeed Insights was redirected from ${SITE}/ to a page on ${new URL(SITE).host} and tested that page.`]);
});

test('a crawl that does not say the site is public is never named to Google', async () => {
  const unknown = 'This crawl does not record whether the site is on this machine, so nothing was sent to Google. Crawl the site again to measure Core Web Vitals.';
  // A crawl file written before the field existed, or edited by hand: a local site reached
  // through a name such as myapp.test cannot be told from a public one by its host.
  /** @type {any[]} */
  const crawls = [
    site({ site_origin: 'http://myapp.test:3000', site_host: 'myapp.test:3000', options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false } }),
    site({ options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: 'no' } }),
    { ...site(), options: undefined },
  ];
  for (const crawl of crawls) {
    const fake = clients();
    const vitals = await measureVitals(crawl, { apiKey: KEY, ...fake });
    assert.deepEqual(fake.psiCalls, []);
    assert.deepEqual(fake.cruxCalls, []);
    assert.deepEqual(vitals, unavailableVitals(crawl.site_origin, unknown));
  }
});

test('a site on this machine or on a private address is never named to Google', async () => {
  const local = "The audited site is on this machine or on a private network, so Google's services cannot reach it. Nothing was sent to Google.";
  /** @type {Partial<CrawlResult>[]} */
  const sites = [
    { options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true } },
    { site_origin: 'http://localhost:3000', site_host: 'localhost:3000' },
    { site_origin: 'http://app.localhost', site_host: 'app.localhost' },
    { site_origin: 'http://127.0.0.1:8080', site_host: '127.0.0.1:8080' },
    { site_origin: 'http://[::1]:8080', site_host: '[::1]:8080' },
    { site_origin: 'http://10.0.0.5', site_host: '10.0.0.5' },
    { site_origin: 'http://192.168.1.20', site_host: '192.168.1.20' },
    { site_origin: 'not a url', site_host: 'x' },
  ];
  for (const overrides of sites) {
    const fake = clients();
    const vitals = await measureVitals(site(overrides), { apiKey: KEY, ...fake });
    assert.deepEqual(fake.psiCalls, [], JSON.stringify(overrides));
    assert.deepEqual(fake.cruxCalls, [], JSON.stringify(overrides));
    assert.deepEqual(vitals, unavailableVitals(/** @type {string} */ (overrides.site_origin ?? SITE), local));
    assert.deepEqual(vitals.notes, [local]);
    assert.equal(vitals.lab.reason, local);
    assert.equal(vitals.field.reason, local);
  }
});

test('a crawl without an indexable page has nothing to measure', async () => {
  const fake = clients();
  const vitals = await measureVitals(makeCrawl({ pages: [] }), { apiKey: KEY, ...fake });
  assert.deepEqual(fake.psiCalls, []);
  assert.deepEqual(fake.cruxCalls, []);
  assert.equal(vitals.lab.reason, 'No indexable HTML page was crawled, so there was no page to measure.');
  assert.equal(vitals.field.available, false);
  assert.deepEqual(vitals.pages, []);
});

test('invalid options throw TypeError', async () => {
  await assert.rejects(measureVitals(site(), { maxPages: 0 }), TypeError);
  await assert.rejects(measureVitals(site(), { maxPages: LIMITS.vitalsPagesMax + 1 }), /whole number from 1 to 10/);
  await assert.rejects(measureVitals(site(), { maxPages: 2.5 }), TypeError);
  await assert.rejects(measureVitals(site(), { concurrency: 0 }), TypeError);
  await assert.rejects(measureVitals(site(), { deadlineMs: -1 }), TypeError);
});

// The real clients against a stand-in for Google's two APIs on 127.0.0.1.
/** @type {Awaited<ReturnType<typeof startGoogle>>} */
let google;
/** @type {{psi: (request: import('../helpers/google-api.js').SeenRequest) => import('../helpers/google-api.js').Reply, crux: (request: import('../helpers/google-api.js').SeenRequest) => import('../helpers/google-api.js').Reply}} */
const answers = { psi: () => ({}), crux: () => ({}) };

before(async () => {
  google = await startGoogle({ psi: (request) => answers.psi(request), crux: (request) => answers.crux(request) });
});
after(() => google.close());

/** @param {CrawlResult} crawl @param {string|null} apiKey */
function measureAgainstFake(crawl, apiKey) {
  const fetchOptions = { allowLoopback: true };
  google.requests.length = 0;
  return measureVitals(crawl, {
    apiKey,
    runPagespeed: (url, options) => runPagespeed(url, { ...options, endpoint: google.psiEndpoint, fetchOptions }),
    queryCrux: (target, options) => queryCrux(target, { ...options, endpoint: google.cruxEndpoint, fetchOptions }),
  });
}

test('end to end with the real clients: values, ratings input and the requests Google would get', async () => {
  answers.psi = (request) => ({ json: psiAnswer({ url: request.query.url, lcp: request.query.url.endsWith('/blog/a') ? 4312.7 : 1800, cls: 0.3004, tbt: 90 }) });
  answers.crux = (request) => (request.body.origin ? { json: cruxAnswer({ origin: request.body.origin, lcp: 3140, inp: 180, cls: '0.04' }) } : NO_CRUX_DATA);
  const vitals = await measureAgainstFake(site(), KEY);

  assert.deepEqual(vitals.pages.map((page) => page.lab), [
    { lcp_ms: 1800, cls: 0.3, tbt_ms: 90, lighthouse_version: '12.8.2', final_url: null },
    { lcp_ms: 4313, cls: 0.3, tbt_ms: 90, lighthouse_version: '12.8.2', final_url: null },
    { lcp_ms: 1800, cls: 0.3, tbt_ms: 90, lighthouse_version: '12.8.2', final_url: null },
  ]);
  assert.deepEqual(vitals.origin.field, {
    lcp_ms: { p75: 3140, good: 0.8234 }, inp_ms: { p75: 180, good: 0.9 }, cls: { p75: 0.04, good: 0.93 },
    period: { first: '2026-10-12', last: '2026-11-08' },
  });
  assert.ok(vitals.pages.every((page) => page.field === null));
  assert.deepEqual(vitals.notes, []);

  const psi = google.requests.filter((request) => request.api === 'psi');
  const crux = google.requests.filter((request) => request.api === 'crux');
  assert.deepEqual(psi.map((request) => request.query.url).sort(), [`${SITE}/`, `${SITE}/blog/a`, `${SITE}/shop/x`]);
  assert.deepEqual(crux.map((request) => request.body.origin ?? request.body.url), [SITE, `${SITE}/`, `${SITE}/blog/a`, `${SITE}/shop/x`]);
  assert.ok(google.requests.every((request) => request.headers['x-goog-api-key'] === KEY));
  assert.ok(google.raw.every((request) => !request.url.includes(KEY)));
});

test('end to end without a key, as Google answers today: one refused request and a complete result', async () => {
  answers.psi = () => KEYLESS_PSI;
  answers.crux = () => INVALID_KEY;
  const vitals = await measureAgainstFake(site(), null);
  assert.equal(google.requests.length, 1);
  assert.equal(google.requests[0].api, 'psi');
  assert.equal(google.requests[0].headers['x-goog-api-key'], undefined);
  assert.equal(vitals.lab.reason, KEYLESS_QUOTA);
  assert.equal(vitals.field.reason, NO_KEY);
  assert.ok(!JSON.stringify(vitals).includes('Quota exceeded'), "Google's own message is not copied into the result");
});
