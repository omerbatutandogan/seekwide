// The cro module's Lighthouse audits from the PageSpeed Insights test, and the
// sxo module's Chrome UX Report query for ad metrics (rule set 0.2.1).

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { buildContext, runChecks } from '../../plugin/server/src/checks/engine.js';
import { checks as croChecks } from '../../plugin/server/src/checks/cro/index.js';
import { createToolDeps } from '../../plugin/server/src/deps.js';
import { adObservation } from '../../plugin/server/src/observations/sxo.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { storedRunProblem } from '../../plugin/server/src/store/run-validate.js';
import { ADS_NO_DATA, ADS_NO_KEY, measureAds } from '../../plugin/server/src/vitals/ads.js';
import { AD_METRICS, queryCruxAds } from '../../plugin/server/src/vitals/crux.js';
import { measureVitals } from '../../plugin/server/src/vitals/measure.js';
import { runPagespeed } from '../../plugin/server/src/vitals/psi.js';
import { makeCrawl, makeLab, makePage, makeVitals } from '../helpers/factories.js';
import { INVALID_KEY, NO_CRUX_DATA, psiAnswer, startGoogle } from '../helpers/google-api.js';
import { makeRun } from '../helpers/run-factory.js';

/** @import { Reply, SeenRequest } from '../helpers/google-api.js' */

const KEY = 'AIzaTestKey-123_abc';
const PAGE = 'https://example.test/contact';

/** @type {Awaited<ReturnType<typeof startGoogle>>} */
let google;
/** @type {(request: SeenRequest) => Reply} */
let psiReply;
/** @type {(request: SeenRequest) => Reply} */
let cruxReply;

/** A PageSpeed Insights answer with the accessibility and best-practices audits. */
function withAudits(/** @type {Record<string, unknown>} */ audits) {
  const json = /** @type {any} */ (psiAnswer({ url: PAGE }));
  Object.assign(json.lighthouseResult.audits, audits);
  return json;
}

const adRecord = {
  record: {
    key: { formFactor: 'PHONE', origin: 'https://example.test' },
    metrics: {
      experimental_ad_density: { percentiles: { p75: '0.234' } }, experimental_ad_count: { percentiles: { p75: 2.5 } },
      experimental_ad_cpu: { percentiles: { p75: 812.4 } }, experimental_ad_kilobytes: { percentiles: { p75: 1530.6 } },
    },
    collectionPeriod: { firstDate: { year: 2026, month: 10, day: 16 }, lastDate: { year: 2026, month: 11, day: 12 } },
  },
};

before(async () => {
  google = await startGoogle({ psi: (request) => psiReply(request), crux: (request) => cruxReply(request) });
});
beforeEach(() => {
  google.requests.length = 0;
  google.raw.length = 0;
  psiReply = (request) => ({ json: psiAnswer({ url: request.query.url }) });
  cruxReply = () => ({ json: adRecord });
});
after(() => google.close());

const local = { fetchOptions: { allowLoopback: true } };

test('with labAudits the one PageSpeed Insights request also asks for the accessibility and best-practices categories', async () => {
  psiReply = () => ({
    json: withAudits({
      'target-size': { score: 0, scoreDisplayMode: 'binary', details: { items: [{}, {}, {}] } },
      'errors-in-console': { score: 1, scoreDisplayMode: 'binary', details: { items: [] } },
    }),
  });
  const result = await runPagespeed(PAGE, { endpoint: google.psiEndpoint, ...local, apiKey: KEY, labAudits: true });
  assert.equal(google.requests.length, 1);
  assert.deepEqual(new URL(google.raw[0].url, 'http://x').searchParams.getAll('category'), ['PERFORMANCE', 'ACCESSIBILITY', 'BEST_PRACTICES']);
  assert.ok(result.ok);
  assert.deepEqual(result.lab.audits, { target_size: { score: 0, items: 3 }, console_errors: { score: 1, items: 0 } });
  const plain = await runPagespeed(PAGE, { endpoint: google.psiEndpoint, ...local });
  assert.ok(plain.ok && plain.lab.audits === undefined, 'without the option nothing changes');
  assert.deepEqual(new URL(google.raw[1].url, 'http://x').searchParams.getAll('category'), ['PERFORMANCE']);
});

test('an audit that is missing, not applicable, failed or not scored gives no unit', async () => {
  psiReply = () => ({ json: withAudits({ 'target-size': { score: null, scoreDisplayMode: 'notApplicable' }, 'errors-in-console': { score: 0.5, scoreDisplayMode: 'error' } }) });
  const result = await runPagespeed(PAGE, { endpoint: google.psiEndpoint, ...local, labAudits: true });
  assert.ok(result.ok);
  assert.deepEqual(result.lab.audits, { target_size: null, console_errors: null });
});

test('auditsOnly asks for the two categories without PERFORMANCE and returns the audits with every metric null', async () => {
  psiReply = () => ({ json: withAudits({ 'target-size': { score: 1, scoreDisplayMode: 'binary', details: { items: [] } } }) });
  const result = await runPagespeed(PAGE, { endpoint: google.psiEndpoint, ...local, labAudits: true, auditsOnly: true });
  assert.deepEqual(new URL(google.raw[0].url, 'http://x').searchParams.getAll('category'), ['ACCESSIBILITY', 'BEST_PRACTICES']);
  assert.ok(result.ok);
  assert.deepEqual(result.lab.audits?.target_size, { score: 1, items: 0 });
});

test('measureVitals with a base adds the audits to its pages and keeps every value, without asking the Chrome UX Report', async () => {
  const base = makeVitals({ pages: [{ url: 'https://example.test/', why: 'Start page', lab: makeLab({ lcp_ms: 2222 }), lab_note: null, field: null, field_note: null }] });
  /** @type {object[]} */
  const psiCalls = [];
  let cruxCalls = 0;
  const merged = await measureVitals(makeCrawl({ pages: [makePage()] }), {
    apiKey: KEY, base, queryCrux: async () => { cruxCalls += 1; return { ok: true, record: null }; },
    runPagespeed: async (url, options) => { psiCalls.push(options ?? {}); return { ok: true, lab: { ...makeLab({ lcp_ms: null, cls: null, tbt_ms: null }), audits: { target_size: { score: 0, items: 4 }, console_errors: null } } }; },
  });
  assert.equal(cruxCalls, 0);
  assert.deepEqual(psiCalls, [{ apiKey: KEY, labAudits: true, auditsOnly: true }]);
  assert.equal(merged.pages[0].lab?.lcp_ms, 2222, 'the earlier value is kept');
  assert.deepEqual(merged.pages[0].lab?.audits?.target_size, { score: 0, items: 4 });
  assert.equal(merged.lab.audits_requested, true);
  assert.deepEqual(merged.notes, base.notes, 'the stored measurement gains no note: only the audit that asked says so');
  const refused = await measureVitals(makeCrawl({ pages: [makePage()] }), { apiKey: KEY, base, runPagespeed: async () => ({ ok: false, failure: { kind: 'quota', status: 429, reason: null } }) });
  assert.match(String(refused.lab.audits_reason), /quota/);
  assert.equal(refused.pages[0].lab?.lcp_ms, 2222);
  const local2 = await measureVitals(makeCrawl({ pages: [makePage()], options: { ...makeCrawl().options, local: true } }), { apiKey: KEY, base, runPagespeed: async () => { throw new Error('never'); } });
  assert.match(String(local2.lab.audits_reason), /this machine/);
});

test('measureVitals passes labAudits to every lab test and records that it asked', async () => {
  /** @type {object[]} */
  const seen = [];
  const vitals = await measureVitals(makeCrawl({ pages: [makePage()] }), {
    labAudits: true, runPagespeed: async (url, options) => {
      seen.push(options ?? {});
      return { ok: true, lab: { ...makeLab(), audits: { target_size: { score: 1, items: 0 }, console_errors: null } } };
    },
  });
  assert.ok(seen.length > 0 && seen.every((options) => /** @type {any} */ (options).labAudits === true));
  assert.equal(vitals.lab.audits_requested, true);
  await assert.rejects(measureVitals(makeCrawl(), /** @type {any} */ ({ labAudits: 'yes' })), TypeError);
});

test('the cro lab checks judge the tested pages\' audits and are skipped with a reason without them', () => {
  const page = (/** @type {string} */ url, /** @type {any} */ audits) => ({ url, why: 'Start page', lab: { ...makeLab(), audits }, lab_note: null, field: null, field_note: null });
  const vitals = makeVitals({
    lab: { available: true, reason: null, device: 'mobile', audits_requested: true },
    pages: [
      page('https://example.test/', { target_size: { score: 1, items: 0 }, console_errors: { score: 0, items: 4 } }),
      page('https://example.test/contact', { target_size: { score: 0, items: 6 }, console_errors: null }),
    ],
  });
  const result = runChecks(croChecks, buildContext(makeCrawl(), { vitals }), { modules: ['cro'], detectedAt: '2026-11-14T00:00:00.000Z' });
  const stat = (/** @type {string} */ id) => result.checks.find((check) => check.id === id);
  assert.deepEqual([stat('cro.lab.target_size')?.applicable, stat('cro.lab.target_size')?.failed], [2, 1]);
  assert.deepEqual([stat('cro.lab.console_errors')?.applicable, stat('cro.lab.console_errors')?.failed], [1, 1]);
  const target = result.findings.find((finding) => finding.check_id === 'cro.lab.target_size');
  assert.deepEqual([target?.url, target?.confidence, /** @type {any} */ (target?.evidence.observed).targets], ['https://example.test/contact', 'likely', 6]);

  const without = runChecks(croChecks, buildContext(makeCrawl(), { vitals: makeVitals() }), { modules: ['cro'], detectedAt: '2026-11-14T00:00:00.000Z' });
  assert.match(String(without.checks.find((check) => check.id === 'cro.lab.target_size')?.skip_reason), /did not ask for/);
  const none = runChecks(croChecks, buildContext(makeCrawl()), { modules: ['cro'], detectedAt: '2026-11-14T00:00:00.000Z' });
  assert.equal(none.checks.find((check) => check.id === 'cro.lab.console_errors')?.status, 'skipped');
});

test('the ad metrics query asks for the four experimental metrics of one origin, once, and reads their 75th percentiles', async () => {
  const result = await queryCruxAds('https://example.test', { apiKey: KEY, endpoint: google.cruxEndpoint, ...local });
  assert.equal(google.requests.length, 1);
  assert.deepEqual(google.requests[0].body, { origin: 'https://example.test', formFactor: 'PHONE', metrics: Object.values(AD_METRICS) });
  assert.equal(google.requests[0].headers['x-goog-api-key'], KEY);
  assert.deepEqual(result, { ok: true, ads: { density: 0.23, count: 2.5, cpu_ms: 812, kilobytes: 1531, period: { first: '2026-10-16', last: '2026-11-12' } } });
  cruxReply = () => NO_CRUX_DATA;
  assert.deepEqual(await queryCruxAds('https://example.test', { apiKey: KEY, endpoint: google.cruxEndpoint, ...local }), { ok: true, ads: null });
  cruxReply = () => INVALID_KEY;
  const refused = await queryCruxAds('https://example.test', { apiKey: KEY, endpoint: google.cruxEndpoint, ...local });
  assert.equal(refused.ok, false);
  assert.equal(google.requests.length, 3, 'a refusal is not retried');
});

test('measureAds asks only for a public site with a usable key, and says why otherwise', async () => {
  /** @type {string[]} */
  const asked = [];
  const queryAds = async (/** @type {string} */ origin) => {
    asked.push(origin);
    return /** @type {const} */ ({ ok: true, ads: null });
  };
  assert.deepEqual(await measureAds(makeCrawl(), { queryAds }), { ads: null, reason: ADS_NO_KEY });
  assert.match(String((await measureAds(makeCrawl(), { apiKey: null, apiKeyUnusable: true, queryAds })).reason), /cannot be used/);
  assert.match(String((await measureAds(makeCrawl({ options: { ...makeCrawl().options, local: true } }), { apiKey: KEY, queryAds })).reason), /this machine/);
  assert.deepEqual(asked, []);
  assert.deepEqual(await measureAds(makeCrawl(), { apiKey: KEY, queryAds }), { ads: null, reason: ADS_NO_DATA });
  assert.deepEqual(asked, ['https://example.test']);
  const refused = await measureAds(makeCrawl(), { apiKey: KEY, queryAds: async () => ({ ok: false, failure: { kind: 'quota', status: 429, reason: null } }) });
  assert.match(String(refused.reason), /quota/);
});

test('the key is bound into measureAds by the dependencies, and a caller cannot replace it', async () => {
  /** @type {unknown[]} */
  const keys = [];
  const deps = createToolDeps({ SEEKWIDE_GOOGLE_API_KEY: KEY });
  await deps.measureAds(makeCrawl(), /** @type {any} */ ({ apiKey: 'from-a-tool', queryAds: async (/** @type {string} */ _, /** @type {any} */ options) => {
    keys.push(options.apiKey);
    return { ok: true, ads: null };
  } }));
  assert.deepEqual(keys, [KEY]);
});

test('the ad observation is stored by form and both reports show it, measured or not', () => {
  const measured = adObservation({ ads: { density: 0.23, count: 2.5, cpu_ms: 812, kilobytes: 1531, period: { first: '2026-10-16', last: '2026-11-12' } }, reason: null });
  const missing = adObservation({ ads: null, reason: ADS_NO_DATA });
  const run = { ...makeRun(), modules_requested: ['sxo'], observations: [measured, missing] };
  assert.equal(storedRunProblem(run), null);
  const md = renderMarkdown(run);
  assert.match(md, /### Ads real Chrome users saw \(Chrome UX Report, experimental\)/);
  assert.match(md, /- Ad density \(share of the viewport\): 0\.23\./);
  assert.match(md, /- Ad CPU time: 812 ms\./);
  assert.match(md, /- Collection period: 2026-10-16 to 2026-11-12\./);
  assert.match(md, /Chrome publishes no threshold for these experimental metrics/);
  assert.match(md, /- Not available: The Chrome UX Report has no ad data for this origin on phones\./);
  assert.match(renderHtml(run), /Ad network weight: 1531 KB\./);
});
