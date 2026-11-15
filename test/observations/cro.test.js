// The cro module's observations and the observations field of a run (rule set 0.2.1).

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildContext } from '../../plugin/server/src/checks/engine.js';
import { buildObservations, observationNotes } from '../../plugin/server/src/observations/index.js';
import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { compareRuns } from '../../plugin/server/src/store/compare.js';
import { observationsProblem } from '../../plugin/server/src/store/observation-validate.js';
import { storedRunProblem } from '../../plugin/server/src/store/run-validate.js';
import { loadRun, saveRun } from '../../plugin/server/src/store/runs.js';
import { SITE, makeCrawl, makeLink, makePage, makeSecurity } from '../helpers/factories.js';
import { makeRun } from '../helpers/run-factory.js';

/** @param {Partial<import('../../plugin/server/src/types.js').FormsRecord>} [overrides] */
const forms = (overrides = {}) => ({ forms: [], controls: [], hidden_controls: 0, tcf_stub: false, first_action: null, ...overrides });
/** @param {string} url @param {'script'|'iframe'} [tag] */
const embed = (url, tag = 'script') => ({ tag, url, host: new URL(url).host, hidden: null, line: 3 });
const contactForm = forms({
  forms: [{ line: 4, id: null, name: null, action: `${SITE}/send`, method: 'post', search: false, fields: 1 }],
  controls: [{ form: 0, tag: 'input', type: 'email', name: 'email', id: null, autocomplete: null, named_by: 'label', paste_blocked: false, line: 5 }],
});

function crawl() {
  return makeCrawl({
    pages: [
      makePage({
        url: `${SITE}/`,
        links: [makeLink({ url: `${SITE}/contact-us`, text: 'Write to us' }), makeLink({ url: `${SITE}/about`, text: 'İletişim' }), { ...makeLink({ url: `${SITE}/x` }), href: 'tel:+90 212 000 00 00', url: null, internal: false }],
        security: makeSecurity({ embeds: [embed('https://cdn.cookielaw.org/scripttemplates/otSDKStub.js'), embed('https://js.hsforms.net/forms/v2.js')] }),
        forms: forms({ tcf_stub: true, first_action: { in_main: true, tag: 'button', words_before: 42, elements_before: 7, line: 30 } }),
      }),
      makePage({
        url: `${SITE}/contact-us`,
        links: [{ ...makeLink({ url: `${SITE}/y` }), href: 'MAILTO:hello@example.test', url: null, internal: false }],
        security: makeSecurity({ embeds: [embed('https://docs.google.com/forms/d/e/abc/viewform', 'iframe'), embed('https://docs.google.com/document/d/1')] }),
        forms: contactForm,
      }),
      makePage({ url: `${SITE}/old`, forms: undefined }),
      makePage({ url: `${SITE}/broken`, forms: { ...forms(), failed: true } }),
    ],
  });
}

test('the cro observations count consent tools, the TCF API, contact paths and embedded form services, from the plugin\'s own lists', () => {
  const ctx = buildContext(crawl());
  const [consent, contact, action] = /** @type {import('../../plugin/server/src/types.js').Observation[]} */ (buildObservations(ctx, ['cro']));
  assert.deepEqual(consent.values, { pages_read: 2, providers: 'OneTrust', provider_pages: 1, tcf_pages: 1 }, 'a page without the reading and one whose reading failed are not counted');
  assert.deepEqual(contact.values, { pages_read: 2, tel_pages: 1, mailto_pages: 1, form_pages: 1, contact_link_pages: 1, form_service_pages: 2, form_services: 'Google Forms, HubSpot' });
  assert.deepEqual(contact.urls, [`${SITE}/about`, `${SITE}/contact-us`], 'by path or by link text');
  assert.deepEqual(action.values, { found: true, in_main: true, tag: 'button', words_before: 42, elements_before: 7 });
  assert.deepEqual(action.urls, [`${SITE}/`]);
  assert.equal(storedRunProblem({ ...makeRun(), observations: [consent, contact, action] }), null, 'what the audit writes is what a stored run accepts');
  assert.deepEqual(observationNotes(ctx, ['cro']), ['The forms of 1 page could not be read, so those pages are not units of the checks that read forms and are not counted in the observations.']);
});

test('without the forms reading the observations say they are not available, and modules that observe nothing give none', () => {
  const ctx = buildContext(makeCrawl({ pages: [makePage({ forms: undefined })] }));
  const list = buildObservations(ctx, ['cro', 'seo']) ?? [];
  assert.deepEqual(list.map((o) => [o.id, o.status]), [['cro.consent_tool', 'not_available'], ['cro.contact_path', 'not_available'], ['cro.first_action', 'not_available']]);
  assert.ok(list.every((o) => typeof o.reason === 'string' && o.reason.length > 0));
  assert.equal(buildObservations(ctx, ['seo', 'links']), null);
  assert.deepEqual(buildObservations(ctx, ['sxo']), []);
});

test('the stored form of observations is checked by form, bounded, and absent in older runs', () => {
  const good = { id: 'cro.contact_path', module: 'cro', status: 'measured', reason: null, values: { pages_read: 3, form_services: 'HubSpot', found: true, gone: null }, urls: [`${SITE}/contact`], source: null };
  assert.equal(observationsProblem(undefined), null);
  assert.equal(observationsProblem(null), null);
  assert.equal(observationsProblem([good, { ...good, id: 'zzz.future_name', module: 'zzz', status: 'later_status' }]), null, 'a later version\'s names are accepted by form');
  const bad = /** @type {[string, unknown][]} */ ([
    ['observations', {}], ['observations', Array.from({ length: 21 }, () => good)],
    ['observations[0].id', [{ ...good, id: 'Cro.Contact' }]], ['observations[0].module', [{ ...good, module: '__proto__' }]],
    ['observations[0].status', [{ ...good, status: 'Measured!' }]], ['observations[0].reason', [{ ...good, reason: 'a\nb' }]],
    ['observations[0].values', [{ ...good, values: [] }]], ['observations[0].values', [{ ...good, values: { 'Bad Key': 1 } }]],
    ['observations[0].values', [{ ...good, values: { text: 'x'.repeat(201) } }]], ['observations[0].values', [{ ...good, values: { text: 'right‮left' } }]],
    ['observations[0].values', [{ ...good, values: { n: Number.NaN } }]], ['observations[0].values', [{ ...good, values: { nested: { a: 1 } } }]],
    ['observations[0].urls', [{ ...good, urls: ['javascript:alert(1)'] }]], ['observations[0].urls', [{ ...good, urls: Array.from({ length: 6 }, () => SITE) }]],
    ['observations[0].source', [{ ...good, source: 'http://example.test/doc' }]],
  ]);
  for (const [where, value] of bad) assert.equal(observationsProblem(value), where, JSON.stringify(value).slice(0, 80));
  assert.equal(storedRunProblem({ ...makeRun(), observations: [{ ...good, urls: ['not a url'] }] }), 'observations[0].urls');
});

test('a run with observations is saved and read back through the real store, and compared with a run without them', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'seekwide-observations-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const observed = /** @type {import('../../plugin/server/src/types.js').Observation[]} */ (buildObservations(buildContext(crawl()), ['cro']));
  const older = makeRun({ run_id: 'older' });
  const current = { ...makeRun({ run_id: 'current', created_at: '2026-11-14T10:00:00.000Z' }), modules_requested: ['cro'], observations: observed };
  await saveRun(dir, older);
  await saveRun(dir, current);
  assert.deepEqual((await loadRun(dir, 'current')).observations, observed);
  assert.equal((await loadRun(dir, 'older')).observations, undefined, 'a run saved before the field loads as it is');
  const comparison = compareRuns(await loadRun(dir, 'older'), await loadRun(dir, 'current'));
  assert.equal(comparison.persisting, older.findings.length);
  assert.deepEqual(compareRuns(await loadRun(dir, 'current'), await loadRun(dir, 'older')).resolved, []);
});

test('both report formats show the observations as the user reads them, unknown ones by their value names', () => {
  const observed = /** @type {import('../../plugin/server/src/types.js').Observation[]} */ (buildObservations(buildContext(crawl()), ['cro']));
  const run = {
    ...makeRun(), modules_requested: ['cro'],
    observations: [...observed, { id: 'zzz.later', module: 'zzz', status: 'measured', reason: null, values: { some_count: 3 }, urls: [], source: null },
      { id: 'cro.consent_tool', module: 'cro', status: 'not_available', reason: 'Nothing was read.', values: {}, urls: [], source: null }],
  };
  const md = renderMarkdown(run);
  assert.match(md, /## Observed \(not scored\)\n\n\*These measurements have no pass or fail threshold\. They never change a score and are not findings\.\*/);
  assert.match(md, /- Consent tool scripts: OneTrust \(on 1 of 2 pages read\)\./);
  assert.match(md, /- IAB TCF consent API on 1 of 2 pages read\./);
  assert.match(md, /- Embedded form services: Google Forms, HubSpot \(on 2 of 2 pages read\)\./);
  assert.match(md, /The first button in the main element comes after 42 words and 7 elements of the HTML\./);
  assert.match(md, /Style sheets can show it elsewhere, so its visual position \(above or below the fold\) is not measured\./);
  assert.match(md, /this is not a legal assessment/);
  assert.match(md, /### zzz\.later\n\n- some count: 3/);
  assert.match(md, /- Not available: Nothing was read\./);
  const html = renderHtml(run);
  assert.match(html, /<h2>Observed \(not scored\)<\/h2>/);
  assert.match(html, /Consent tool scripts: OneTrust \(on 1 of 2 pages read\)\./);
  assert.match(html, /comes after 42 words and 7 elements of the HTML\./);
  assert.doesNotMatch(renderMarkdown(makeRun()), /Observed \(not scored\)/, 'a run without observations has no such section');
});

test('the limits of the forms reading are named only when the cro module ran, in plain words', async () => {
  const { limitsNote } = await import('../../plugin/server/src/tools/audit-summary.js');
  const crawled = makeCrawl({ pages: [makePage({ limits_reached: ['forms', 'forms.controls'] })] });
  assert.equal(limitsNote(crawled), null, 'a seo audit of a shop page with sixty add-to-cart forms gets no note');
  const notes = observationNotes(buildContext(crawled), ['cro']);
  assert.ok(notes.some((note) => /^1 page had more than 50 forms; the first 50 were read and the rest were not checked\.$/.test(note)));
  assert.ok(notes.some((note) => /had more form controls than are kept/.test(note)));
  assert.ok(notes.every((note) => !/padded/.test(note)));
  assert.deepEqual(observationNotes(buildContext(crawled), ['seo']), []);
});

test('a malformed forms record in a stored crawl makes the observations not available, never the audit fail', () => {
  for (const forms of [{}, null, { forms: 'x', controls: 3 }]) {
    const ctx = buildContext(makeCrawl({ pages: [makePage({ forms: /** @type {any} */ (forms) })] }));
    const list = /** @type {import('../../plugin/server/src/types.js').Observation[]} */ (buildObservations(ctx, ['cro']));
    assert.equal(list.length, 3, JSON.stringify(forms));
    assert.ok(list.every((o) => o.status === 'measured' || (o.status === 'not_available' && typeof o.reason === 'string' && o.reason.length > 0)));
    if (forms !== null && Object.keys(forms).length === 0) assert.ok(list.some((o) => /could not be measured/.test(String(o.reason))), 'an empty record cannot be read');
    assert.doesNotThrow(() => observationNotes(ctx, ['cro']));
  }
});
