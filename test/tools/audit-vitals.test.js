// Core Web Vitals in audit_run are measured once per crawl: a later audit of
// the same crawl rates the same numbers and says that it reused them.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTools } from '../../server/src/tools/index.js';
import { reusedNote } from '../../server/src/tools/audit-vitals.js';
import { LIMITS } from '../../server/src/config.js';
import { makeLab, makeVitals } from '../helpers/factories.js';
import { NOW, jobFor, makeCheck, makeDeps, sampleCrawl, toolNamed } from './fakes.js';

/** @import { VitalsData } from '../../server/src/types.js' */

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
    (fake.calls.measureVitals ??= []).push([measured.id, options]);
    call += 1;
    return vitalsFor(call);
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
    assert.deepEqual(fake.calls.measureVitals, [['c-1', { maxPages: 3 }], ['c-2', { maxPages: 3 }], ['c-1', { maxPages: 5 }]]);
    assert.equal(again.core_web_vitals.reused, true);
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
