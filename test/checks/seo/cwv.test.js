import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makeField, makeLab, makePage, makeVitals } from '../../helpers/factories.js';
import { audit } from './helpers.js';

/** @import { VitalsData, VitalsPage } from '../../../plugin/server/src/types.js' */

const HOME = `${SITE}/`;
const POST = `${SITE}/blog/post`;
const crawl = { pages: [makePage({ url: HOME }), makePage({ url: POST, depth: 1 })] };

/**
 * @param {Partial<VitalsPage> & {url: string}} overrides
 * @returns {VitalsPage}
 */
const tested = (overrides) => ({ why: 'Start page', lab: makeLab(), lab_note: null, field: makeField(), field_note: null, ...overrides });

/** @param {string} id @param {Partial<VitalsData>} vitals */
const run = (id, vitals) => audit(id, crawl, { vitals: makeVitals(vitals) });

// ───────────── field data ─────────────

for (const { id, metric, key, good, bad, poor, expected } of /** @type {const} */ ([
  { id: 'seo.cwv.field_lcp', metric: 'lcp_ms', key: 'p75_ms', good: 2500, bad: 2501, poor: 4001, expected: 'A 75th percentile of 2500 ms or less' },
  { id: 'seo.cwv.field_inp', metric: 'inp_ms', key: 'p75_ms', good: 200, bad: 201, poor: 501, expected: 'A 75th percentile of 200 ms or less' },
  { id: 'seo.cwv.field_cls', metric: 'cls', key: 'p75', good: 0.1, bad: 0.11, poor: 0.26, expected: 'A 75th percentile of 0.1 or less' },
])) {
  test(`${id} passes at the threshold, for the whole site and for a tested page`, () => {
    const field = makeField({ [metric]: { p75: good, good: 0.75 } });
    const result = run(id, { origin: { origin: SITE, field, field_note: null }, pages: [tested({ url: HOME, field })] });
    assert.deepEqual(result.units, [HOME, null], 'one unit for the origin and one for the page');
    assert.equal(result.stat.failed, 0);
    assert.deepEqual(result.findings, []);
  });

  test(`${id} fails just above the threshold, with the measured value as evidence`, () => {
    const result = run(id, {
      origin: { origin: SITE, field: makeField({ [metric]: { p75: bad, good: 0.61 } }), field_note: null },
      pages: [tested({ url: HOME, field: makeField({ [metric]: { p75: poor, good: null } }) })],
    });
    assert.equal(result.stat.applicable, 2);
    assert.equal(result.stat.failed, 2);
    const [siteWide, onPage] = result.findings;
    assert.equal(siteWide.url, null);
    assert.equal(siteWide.selector, 'origin');
    assert.deepEqual(siteWide.evidence, {
      observed: { [key]: bad, rating: 'needs improvement', good_loads: '61%' },
      expected,
      detail: `Real Chrome users on phones, 2026-10-12 to 2026-11-08, across the whole site (${SITE}).`,
    });
    assert.equal(onPage.url, HOME);
    assert.equal(onPage.selector, null);
    assert.deepEqual(onPage.evidence, {
      observed: { [key]: poor, rating: 'poor' },
      expected,
      detail: 'Real Chrome users on phones, 2026-10-12 to 2026-11-08, on this page.',
    });
    assert.equal(siteWide.confidence, 'confirmed');
    assert.equal(siteWide.severity, 'medium');
    assert.notEqual(siteWide.id, onPage.id);
  });

  test(`${id} has no unit where the Chrome UX Report has no value`, () => {
    const without = makeField({ [metric]: null });
    const result = run(id, {
      origin: { origin: SITE, field: null, field_note: 'The Chrome UX Report has no phone data for this site.' },
      pages: [tested({ url: HOME, field: without }), tested({ url: POST, field: null })],
    });
    assert.equal(result.stat.status, 'run');
    assert.equal(result.stat.applicable, 0);
    assert.deepEqual(result.findings, []);
  });

  test(`${id} is skipped, with the collector's reason, when there is no field data`, () => {
    const reason = 'No Google API key is set, and the Chrome UX Report API requires one. Add a key in the plugin settings to collect field data.';
    const result = run(id, { field: { available: false, reason, form_factor: 'phone' } });
    assert.equal(result.stat.status, 'skipped');
    assert.equal(result.stat.skip_reason, reason);
    const unmeasured = audit(id, crawl);
    assert.equal(unmeasured.stat.status, 'skipped');
    assert.equal(unmeasured.stat.skip_reason, 'Needs field data from the Chrome UX Report. It was not collected.');
  });
}

test('a field finding without a collection period still says whose data it is', () => {
  const result = run('seo.cwv.field_lcp', {
    origin: { origin: SITE, field: makeField({ lcp_ms: { p75: 3000, good: 0.5 }, period: null }), field_note: null },
    pages: [],
  });
  assert.equal(result.findings[0].evidence.detail, `Real Chrome users on phones, across the whole site (${SITE}).`);
});

test('the field finding of the whole site keeps its id from run to run', () => {
  const slow = { origin: { origin: SITE, field: makeField({ lcp_ms: { p75: 3000, good: 0.5 } }), field_note: null }, pages: [] };
  const slower = { origin: { origin: SITE, field: makeField({ lcp_ms: { p75: 5200, good: 0.2 } }), field_note: null }, pages: [] };
  assert.equal(run('seo.cwv.field_lcp', slow).findings[0].id, run('seo.cwv.field_lcp', slower).findings[0].id);
});

// ───────────── lab data ─────────────

for (const { id, metric, good, bad, poor, expected, severity, weight } of /** @type {const} */ ([
  { id: 'seo.cwv.lab_lcp', metric: 'lcp_ms', good: 2500, bad: 2501, poor: 4001, expected: '2500 ms or less', severity: 'low', weight: 2 },
  { id: 'seo.cwv.lab_cls', metric: 'cls', good: 0.1, bad: 0.101, poor: 0.251, expected: '0.1 or less', severity: 'low', weight: 2 },
  { id: 'seo.cwv.lab_tbt', metric: 'tbt_ms', good: 200, bad: 201, poor: 601, expected: '200 ms or less', severity: 'low', weight: 1 },
])) {
  test(`${id} passes at the threshold for every tested page`, () => {
    const result = run(id, { pages: [tested({ url: HOME, lab: makeLab({ [metric]: good }) }), tested({ url: POST, lab: makeLab({ [metric]: 0 }) })] });
    assert.deepEqual(result.units, [POST, HOME].sort());
    assert.deepEqual(result.findings, []);
  });

  test(`${id} fails just above the threshold, with the measured value as evidence`, () => {
    const result = run(id, {
      pages: [
        tested({ url: HOME, lab: makeLab({ [metric]: bad }) }),
        tested({ url: POST, lab: makeLab({ [metric]: poor, lighthouse_version: null }) }),
      ],
    });
    assert.equal(result.stat.failed, 2);
    const byUrl = new Map(result.findings.map((finding) => [finding.url, finding]));
    assert.deepEqual(byUrl.get(HOME)?.evidence, {
      observed: { [metric]: bad, rating: 'needs improvement' },
      expected,
      detail: 'One simulated load on an emulated mid-range phone (Lighthouse 12.8.2). Lab values change from run to run.',
    });
    assert.deepEqual(byUrl.get(POST)?.evidence, {
      observed: { [metric]: poor, rating: 'poor' },
      expected,
      detail: 'One simulated load on an emulated mid-range phone. Lab values change from run to run.',
    });
    const finding = /** @type {import('../../../plugin/server/src/types.js').Finding} */ (byUrl.get(HOME));
    assert.deepEqual([finding.confidence, finding.severity, finding.weight], ['likely', severity, weight]);
  });

  test(`${id} has no unit for a page without that lab value`, () => {
    const result = run(id, {
      pages: [
        tested({ url: HOME, lab: makeLab({ [metric]: null }) }),
        tested({ url: POST, lab: null, lab_note: 'PageSpeed Insights did not answer in time.' }),
      ],
    });
    assert.equal(result.stat.status, 'run');
    assert.equal(result.stat.applicable, 0);
  });

  test(`${id} is skipped, with the collector's reason, when there is no lab data`, () => {
    const reason = "PageSpeed Insights refused the request: Google's quota for requests without an API key is used up. Add a Google API key in the plugin settings.";
    const result = run(id, { lab: { available: false, reason, device: 'mobile' } });
    assert.equal(result.stat.status, 'skipped');
    assert.equal(result.stat.skip_reason, reason);
    assert.equal(audit(id, crawl).stat.skip_reason, 'Needs lab data from PageSpeed Insights. It was not collected.');
  });
}

test('a lab finding says so when Google was redirected and tested another page', () => {
  const result = run('seo.cwv.lab_lcp', {
    pages: [tested({ url: HOME, lab: makeLab({ lcp_ms: 5000, final_url: 'https://m.example.test/' }) }), tested({ url: POST, lab: makeLab({ lcp_ms: 5000 }) })],
  });
  const byUrl = new Map(result.findings.map((finding) => [finding.url, finding.evidence.detail]));
  assert.equal(
    byUrl.get(HOME),
    'One simulated load on an emulated mid-range phone (Lighthouse 12.8.2). Lab values change from run to run. Google was redirected to https://m.example.test/ and tested that page.',
  );
  assert.equal(byUrl.get(POST), 'One simulated load on an emulated mid-range phone (Lighthouse 12.8.2). Lab values change from run to run.');
});

test('lab checks have no unit for the whole site: a lab test loads one page', () => {
  const result = run('seo.cwv.lab_lcp', { pages: [tested({ url: HOME, lab: makeLab({ lcp_ms: 9000 }) })] });
  assert.deepEqual(result.units, [HOME]);
});

test('the six checks leave the score alone when their data is missing', () => {
  for (const id of ['seo.cwv.field_lcp', 'seo.cwv.field_inp', 'seo.cwv.field_cls', 'seo.cwv.lab_lcp', 'seo.cwv.lab_cls', 'seo.cwv.lab_tbt']) {
    const { stat } = audit(id, crawl);
    assert.deepEqual([stat.status, stat.applicable, stat.failed], ['skipped', 0, 0], id);
  }
});
