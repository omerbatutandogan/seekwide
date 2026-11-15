// Core Web Vitals in audit_run are measured once per crawl: a later audit of
// the same crawl rates the same numbers and says that it reused them.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { auditsAddedNote, reusedNote } from '../../plugin/server/src/tools/audit-vitals.js';
import { LIMITS } from '../../plugin/server/src/config.js';
import { makeLab, makeVitals } from '../helpers/factories.js';
import { NOW, jobFor, makeCheck, makeDeps, sampleCrawl, toolNamed } from './fakes.js';

/** @import { VitalsData } from '../../plugin/server/src/types.js' */

/** @param {ReturnType<typeof makeDeps>} fake */
const audit = (fake) => toolNamed(createTools(fake.deps), 'audit_run');

/**
 * Deps whose measurement gives another lab value each time Google is asked, as a real lab test does.
 * @param {(call: number) => VitalsData} [vitalsFor]
 */
function setup(vitalsFor = (call) => makeVitals({ pages: [{ url: 'https://example.test/', why: 'Start page', lab: makeLab({ lcp_ms: 2000 + call * 1000 }), lab_note: null, field: null, field_note: null }] })) {
  const crawl = sampleCrawl();
  const other = sampleCrawl({ id: 'c-2' });
  const fake = makeDeps({ jobs: [jobFor(crawl), jobFor(other)], results: [crawl, other] });
  let call = 0;
  fake.deps.measureVitals = async (measured, options) => {
    const { signal, ...rest } = options;
    assert.ok(signal instanceof AbortSignal);
    (fake.calls.measureVitals ??= []).push([measured.id, rest]);
    // As the real measurement does: audits added to a base keep its values; a lab test that asked for the audits says so.
    if (rest.base) {
      const base = /** @type {VitalsData} */ (rest.base);
      return { ...base, lab: { ...base.lab, audits_requested: true }, pages: base.pages.map((page) => ({ ...page, lab: page.lab && { ...page.lab, audits: { target_size: { score: 0, items: 2 }, console_errors: null } } })) };
    }
    call += 1;
    const vitals = vitalsFor(call);
    return rest.labAudits ? { ...vitals, lab: { ...vitals.lab, audits_requested: true } } : vitals;
  };
  fake.deps.checks = [
    ...fake.deps.checks,
    makeCheck({
      id: 'seo.cwv.lab_lcp', severity: 'low', requires: ['lab_data'],
      run: (ctx) => (ctx.vitals?.pages ?? []).filter((page) => page.lab).map((page) => ({ status: (page.lab?.lcp_ms ?? 0) > 2500 ? 'fail' : 'pass', url: page.url })),
    }),
  ];
  return fake;
}

describe('Core Web Vitals are measured once per crawl', () => {
  it('a second audit of the same crawl reuses the stored measurement, so both rate the same numbers, and says so', async () => {
    const fake = setup();
    const first = await audit(fake).handler({ job_id: 'c-1' });
    const second = await audit(fake).handler({ job_id: 'c-1' });

    assert.equal(fake.calls.measureVitals.length, 1, 'Google is asked once');
    assert.deepEqual(fake.calls.storeVitals.map(([id, pages, , at]) => [id, pages, at]), [['c-1', LIMITS.vitalsPagesDefault, NOW.toISOString()]]);
    const [run1, run2] = fake.runs;
    assert.deepEqual(run2.core_web_vitals?.pages, run1.core_web_vitals?.pages);
    assert.equal(run1.core_web_vitals?.pages[0].lab?.lcp_ms, 3000);
    assert.deepEqual(run2.findings.map((f) => f.id), run1.findings.map((f) => f.id), 'the same lab findings');
    assert.ok(run1.findings.some((f) => f.check_id === 'seo.cwv.lab_lcp'));

    assert.equal(first.core_web_vitals.reused, false);
    assert.equal(second.core_web_vitals.reused, true);
    assert.equal(second.core_web_vitals.measured_at, first.core_web_vitals.measured_at);
    assert.equal(run2.core_web_vitals?.reused, true);
    assert.ok(second.notes.includes(reusedNote(NOW.toISOString())), 'the result says the numbers were reused');
    assert.ok(!first.notes.includes(reusedNote(NOW.toISOString())));
    assert.equal(run2.core_web_vitals?.notes[0], reusedNote(NOW.toISOString()), 'the stored run and the report say it too');
  });

  it('measures again for another crawl or another page count', async () => {
    const fake = setup();
    await audit(fake).handler({ job_id: 'c-1' });
    await audit(fake).handler({ job_id: 'c-2' });
    await audit(fake).handler({ job_id: 'c-1', core_web_vitals_pages: 5 });
    const again = await audit(fake).handler({ job_id: 'c-1', core_web_vitals_pages: 5 });
    assert.deepEqual(fake.calls.measureVitals, [['c-1', { maxPages: 3, labAudits: true }], ['c-2', { maxPages: 3, labAudits: true }], ['c-1', { maxPages: 5, labAudits: true }]]);
    assert.equal(again.core_web_vitals.reused, true);
  });

  it('a cro audit after a seo audit asks only for the missing audits and keeps the stored Core Web Vitals unchanged', async () => {
    const fake = setup();
    const first = await audit(fake).handler({ job_id: 'c-1', modules: ['seo'] });
    const cro = await audit(fake).handler({ job_id: 'c-1', modules: ['cro'] });
    const later = await audit(fake).handler({ job_id: 'c-1', modules: ['seo'] });
    assert.equal(fake.calls.measureVitals.length, 2);
    assert.deepEqual(fake.calls.measureVitals[0], ['c-1', { maxPages: 3 }]);
    assert.deepEqual(Object.keys(fake.calls.measureVitals[1][1]).sort(), ['base', 'labAudits', 'maxPages'], 'the cro audit asks for the audits only, on the stored measurement');
    const lcp = (/** @type {any} */ result) => result.core_web_vitals.pages.map((/** @type {any} */ page) => page.lab?.lcp_ms);
    assert.deepEqual(lcp(cro), lcp(first));
    assert.deepEqual(lcp(later), lcp(first), 'the values never change');
    assert.equal(cro.core_web_vitals.pages[0].lab.audits.target_size.score, 0);
    assert.equal(later.core_web_vitals.pages[0].lab.audits.target_size.score, 0, 'the added audits are stored with the measurement');
    assert.ok(cro.notes.includes(auditsAddedNote(NOW.toISOString())));
    assert.equal(later.core_web_vitals.reused, true);
    await audit(fake).handler({ job_id: 'c-2', modules: ['sxo'] });
    assert.equal(fake.calls.measureVitals.length, 2, 'the sxo module alone runs no lab test');
  });

  it('two audits of one crawl at the same time measure once, and add the audits once', async () => {
    const fake = setup();
    const tool = audit(fake);
    const [seo, all] = await Promise.all([tool.handler({ job_id: 'c-1', modules: ['seo'] }), tool.handler({ job_id: 'c-1', modules: ['seo', 'cro'] })]);
    assert.equal(fake.calls.measureVitals.length, 2, 'one measurement, then the audits');
    assert.equal(fake.calls.measureVitals.filter(([, options]) => /** @type {any} */ (options).base === undefined).length, 1);
    assert.deepEqual(all.core_web_vitals.pages.map((/** @type {any} */ p) => p.lab?.lcp_ms), seo.core_web_vitals.pages.map((/** @type {any} */ p) => p.lab?.lcp_ms));
    const fake2 = setup();
    const tool2 = audit(fake2);
    await Promise.all([tool2.handler({ job_id: 'c-1', modules: ['cro'] }), tool2.handler({ job_id: 'c-1', modules: ['seo'] })]);
    assert.equal(fake2.calls.measureVitals.length, 1, 'a seo audit waits for the cro measurement, which has everything');
  });

  it('a top-up that brought no audit is not kept and is asked again, and one that brought some is kept, as a measurement is', async () => {
    const fake = setup();
    let give = 0;
    const plain = fake.deps.measureVitals;
    fake.deps.measureVitals = async (crawl, options) => {
      if (!options.base) return plain(crawl, options);
      (fake.calls.measureVitals ??= []).push([crawl.id, { ...options, base: 'base' }]);
      const base = /** @type {VitalsData} */ (options.base);
      if (give === 0) return { ...base, lab: { ...base.lab, audits_requested: true, audits_reason: 'PageSpeed Insights refused the request.' } };
      return { ...base, lab: { ...base.lab, audits_requested: true }, pages: base.pages.map((page, i) => ({ ...page, lab: page.lab && (i === 0 ? { ...page.lab, audits: { target_size: { score: 1, items: 0 }, console_errors: null } } : page.lab) })) };
    };
    await audit(fake).handler({ job_id: 'c-1', modules: ['seo'] });
    await audit(fake).handler({ job_id: 'c-1', modules: ['cro'] });
    assert.equal(fake.runs.at(-1)?.core_web_vitals?.lab.audits_reason, 'PageSpeed Insights refused the request.', 'the reason becomes the skip reason of the lab checks');
    give = 1;
    await audit(fake).handler({ job_id: 'c-1', modules: ['cro'] });
    await audit(fake).handler({ job_id: 'c-1', modules: ['cro'] });
    assert.equal(fake.calls.measureVitals.filter(([, options]) => /** @type {any} */ (options).base).length, 2, 'asked again after nothing came back; a partial result is kept and not asked again');
    const notes = (await audit(fake).handler({ job_id: 'c-1', modules: ['seo'] })).notes;
    assert.ok(!notes.some((/** @type {string} */ note) => /asked PageSpeed Insights only for Lighthouse/.test(note)), 'a seo audit never says it asked for the audits');
  });

  it('every cro audit says for how many tested pages the lab checks had Lighthouse\'s audits, from the measurement; a seo audit does not', async () => {
    const partial = (/** @type {RegExp} */ pattern) => (/** @type {string[]} */ notes) => notes.some((note) => pattern.test(note));
    const says = partial(/audits came back for 1 of 2 tested pages/);
    const two = (/** @type {number} */ call) => makeVitals({ pages: ['https://example.test/', 'https://example.test/c'].map((url) => ({ url, why: 'Start page', lab: makeLab({ lcp_ms: 2000 + call }), lab_note: null, field: null, field_note: null })) });
    const fake = setup(two);
    const plain = fake.deps.measureVitals;
    fake.deps.measureVitals = async (crawl, options) => {
      if (!options.base) return plain(crawl, options);
      const base = /** @type {VitalsData} */ (options.base);
      return { ...base, lab: { ...base.lab, audits_requested: true }, pages: base.pages.map((page, i) => ({ ...page, lab: page.lab && (i === 0 ? { ...page.lab, audits: { target_size: { score: 1, items: 0 }, console_errors: null } } : page.lab) })) };
    };
    assert.ok(!says((await audit(fake).handler({ job_id: 'c-1', modules: ['seo'] })).notes));
    assert.ok(says((await audit(fake).handler({ job_id: 'c-1', modules: ['cro'] })).notes), 'the audit that did the top-up');
    assert.ok(says((await audit(fake).handler({ job_id: 'c-1', modules: ['cro'] })).notes), 'a later audit that reuses it');
    assert.ok(!says((await audit(fake).handler({ job_id: 'c-1', modules: ['seo'] })).notes), 'a seo audit says nothing about it');
    const first = setup((call) => {
      const vitals = two(call);
      return { ...vitals, pages: vitals.pages.map((page, i) => ({ ...page, lab: page.lab && (i === 0 ? { ...page.lab, audits: { target_size: { score: 0, items: 3 }, console_errors: null } } : page.lab) })) };
    });
    assert.ok(says((await audit(first).handler({ job_id: 'c-1', modules: ['cro'] })).notes), 'audits that came with the first measurement for one page of two');
  });

  it('keeps nothing when Google gave no values, so the next audit asks again', async () => {
    const refused = makeVitals({
      lab: { available: false, reason: 'Google refused.', device: 'mobile' },
      field: { available: false, reason: 'Google refused.', form_factor: 'phone' },
      origin: { origin: 'https://example.test', field: null, field_note: null },
      pages: [],
    });
    const fake = setup(() => refused);
    await audit(fake).handler({ job_id: 'c-1' });
    const second = await audit(fake).handler({ job_id: 'c-1' });
    assert.equal(fake.calls.measureVitals.length, 2);
    assert.equal(fake.calls.storeVitals, undefined);
    assert.equal(second.core_web_vitals.reused, false);
  });

  it('two audits of one crawl at the same time ask Google once', async () => {
    const fake = setup();
    // One server, as in production: the tools are created once.
    const tool = audit(fake);
    const [a, b] = await Promise.all([tool.handler({ job_id: 'c-1' }), tool.handler({ job_id: 'c-1' })]);
    assert.equal(fake.calls.measureVitals.length, 1);
    assert.deepEqual([a.core_web_vitals.reused, b.core_web_vitals.reused].sort(), [false, true]);
    assert.deepEqual(a.core_web_vitals.pages, b.core_web_vitals.pages);
  });

  it('a store that cannot be read or written never fails the audit', async () => {
    const fake = setup();
    fake.deps.crawlManager.storedVitals = async () => {
      throw new Error('disk gone');
    };
    fake.deps.crawlManager.storeVitals = async () => {
      throw new Error('disk full');
    };
    const first = await audit(fake).handler({ job_id: 'c-1' });
    const second = await audit(fake).handler({ job_id: 'c-1' });
    assert.equal(fake.calls.measureVitals.length, 2);
    assert.equal(first.core_web_vitals.lab.available, true);
    assert.equal(second.core_web_vitals.reused, false);
  });
});
