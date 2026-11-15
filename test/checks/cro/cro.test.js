// The cro module's key-free checks (rule set 0.2.1): one passing and one failing case each.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContext, runChecks } from '../../../plugin/server/src/checks/engine.js';
import { isValidAutocomplete } from '../../../plugin/server/src/util/autofill.js';
import { mailtoProblem, telProblem } from '../../../plugin/server/src/checks/cro/forms.js';
import { checks } from '../../../plugin/server/src/checks/cro/index.js';
import { extractHtml } from '../../../plugin/server/src/extract/html.js';
import { SITE, makeCrawl, makeLink, makePage } from '../../helpers/factories.js';

/**
 * A page whose forms are read from `body`, as the extractor reads them.
 * @param {string} path @param {string} body @param {object} [overrides]
 */
function page(path, body, overrides = {}) {
  const url = `${SITE}${path}`;
  const fields = extractHtml(`<html><head><title>T</title></head><body>${body}</body></html>`, { responseUrl: url, siteHost: 'example.test', includeSubdomains: false });
  return makePage({ url, forms: fields.forms, links: fields.links, ...overrides });
}

/** @param {import('../../../plugin/server/src/types.js').PageRecord[]} pages @param {string} id */
function run(pages, id) {
  const result = runChecks(checks, buildContext(makeCrawl({ pages })), { modules: ['cro'], detectedAt: '2026-11-14T00:00:00.000Z' });
  const stat = result.checks.find((check) => check.id === id);
  return { stat, findings: result.findings.filter((finding) => finding.check_id === id) };
}

test('cro.form.control_unnamed fails a page with a control nobody can name, and passes named ones, a placeholder included', () => {
  const { stat, findings } = run([
    page('/good', '<label for="e">Email</label><input id="e" name="email"><input name="q" placeholder="Search"><input type="hidden" name="t">'),
    page('/bad', '<form><input name="email"><select name="topic"></select><input name="ok" aria-label="OK"></form>'),
    page('/none', '<p>No form</p>'),
  ], 'cro.form.control_unnamed');
  assert.deepEqual([stat?.applicable, stat?.failed], [2, 1], 'a page without a visible control is not a unit');
  assert.equal(findings[0].url, `${SITE}/bad`);
  assert.equal(findings[0].selector, 'input[name="email"]');
  assert.equal(findings[0].confidence, 'confirmed');
  assert.deepEqual(/** @type {any} */ (findings[0].evidence.observed).controls, 2);
});

test('cro.form.placeholder_only is info and fails a field named only by its placeholder', () => {
  const { findings, stat } = run([page('/a', '<input name="q" placeholder="Search">'), page('/b', '<label>Name <input name="n" placeholder="Ada"></label>')], 'cro.form.placeholder_only');
  assert.deepEqual([stat?.applicable, findings.length, findings[0].url, findings[0].severity, findings[0].weight], [2, 1, `${SITE}/a`, 'info', 0]);
});

test('cro.form.autocomplete_missing fails a personal field without a purpose, by type or by name in several languages', () => {
  const { stat, findings } = run([
    page('/ok', '<input type="email" name="mail" autocomplete="email"><input name="vorname" autocomplete="given-name"><input name="coupon_code">'),
    page('/en', '<input type="email" name="x">'),
    page('/tr', '<input name="ad_soyad" autocomplete="off">'),
    page('/es', '<input name="codigoPostal" autocomplete="on">'),
    page('/other', '<input name="message"><input type="checkbox" name="email_optin"><input name="product_name">'),
  ], 'cro.form.autocomplete_missing');
  assert.deepEqual([stat?.applicable, stat?.failed], [4, 3], 'a page with no personal field is not a unit');
  assert.deepEqual(findings.map((finding) => /** @type {any} */ (finding.evidence.observed).examples[0].purpose), ['email', 'postal_code', 'name']);
  assert.ok(findings.every((finding) => finding.confidence === 'likely'));
});

test('the autocomplete grammar follows the HTML standard', () => {
  for (const value of ['on', 'OFF', 'email', 'section-blue shipping street-address', 'billing work tel', 'mobile email', 'username webauthn', 'cc-number', '']) {
    assert.equal(isValidAutocomplete(value), true, value);
  }
  for (const value of ['nope', 'false', 'new-field', 'on off', 'home name', 'email shipping', 'shipping', 'tel extra', 'webauthn']) {
    assert.equal(isValidAutocomplete(value), false, value);
  }
});

test('cro.form.autocomplete_invalid fails a value outside the grammar and passes valid ones', () => {
  const { stat, findings } = run([page('/ok', '<input name="a" autocomplete="given-name">'), page('/bad', '<input name="a" autocomplete="nope"><input name="b" autocomplete="off">')], 'cro.form.autocomplete_invalid');
  assert.deepEqual([stat?.applicable, findings.length, findings[0].selector], [2, 1, 'input[name="a"]']);
});

test('cro.form.input_type_generic fails an email or phone field typed as text, but not one that takes a user name too', () => {
  const { stat, findings } = run([
    page('/ok', '<input type="email" name="email"><input type="tel" name="phone">'),
    page('/bad', '<input name="telefon">'),
    page('/ac', '<input autocomplete="email" name="x">'),
    page('/either', '<input name="email_or_username"><input name="login_email">'),
  ], 'cro.form.input_type_generic');
  assert.deepEqual([stat?.applicable, stat?.failed], [3, 2]);
  assert.deepEqual(findings.map((finding) => /** @type {any} */ (finding.evidence.observed).examples[0].asks_for), ['email', 'phone'], 'by URL: /ac, then /bad');
});

test('cro.form.paste_blocked fails a password or email field whose inline handler blocks pasting', () => {
  const { stat, findings } = run([
    page('/ok', '<input type="password" name="pw" onpaste="track()">'),
    page('/bad', '<input type="email" name="e" onpaste="return false;">'),
    page('/text', '<input name="note" onpaste="return false">'),
  ], 'cro.form.paste_blocked');
  assert.deepEqual([stat?.applicable, findings.length, findings[0].url], [2, 1, `${SITE}/bad`]);
});

test('cro.form.action_insecure fails an https page whose form sends over http, unless it upgrades insecure requests', () => {
  const upgraded = extractHtml('<html><head><meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests"></head><body><form action="http://forms.example.org/send"><input name="a"></form></body></html>', { responseUrl: `${SITE}/u`, siteHost: 'example.test', includeSubdomains: false });
  const { stat, findings } = run([
    page('/ok', '<form action="/send"><input name="a"></form><form><input name="b"></form>'),
    page('/bad', '<form action="http://forms.example.org/post"><input name="a"></form>'),
    makePage({ url: `${SITE}/u`, forms: upgraded.forms }),
    makePage({ url: 'http://example.test/plain', forms: page('/x', '<form action="http://example.test/send"></form>').forms }),
  ], 'cro.form.action_insecure');
  assert.deepEqual([stat?.applicable, findings.length, findings[0].url, findings[0].severity], [3, 1, `${SITE}/bad`, 'high'], 'an http page is not a unit; an upgraded page passes, its form on another origin included (UIR §4.1)');
  assert.deepEqual(/** @type {any} */ (findings[0].evidence.observed).actions, ['http://forms.example.org/post']);
});

test('cro.form.field_count_high is info, one unit per form that is not a search form', () => {
  const many = Array.from({ length: 9 }, (_, i) => `<input name="f${i}" aria-label="F${i}">`).join('');
  const { stat, findings } = run([page('/a', `<form id="long">${many}</form><form role="search"><input name="q"></form><form><input name="n"></form>`)], 'cro.form.field_count_high');
  assert.deepEqual([stat?.applicable, findings.length, findings[0].selector, findings[0].weight], [2, 1, 'form[id="long"]', 0]);
});

test('tel: and mailto: links are judged by RFC 3966 and RFC 6068', () => {
  for (const href of ['tel:+1-201-555-0123', 'tel:+90 212 000 00 00', 'tel:%2B442071234567', 'tel:7042;phone-context=example.com', 'TEL:0800.123.45']) assert.equal(telProblem(href), null, href);
  for (const href of ['tel:', 'tel:+1-800-FLOWERS', 'tel:call-us', 'tel:0800 CALL NOW']) assert.notEqual(telProblem(href), null, href);
  for (const href of ['mailto:info@example.test', 'mailto:?to=a@example.test&subject=Hi', 'mailto:a@example.test,b@example.test', 'mailto:info%40example.test', 'mailto:?subject=Read%20this&body=x', 'mailto:']) assert.equal(mailtoProblem(href), null, href);
  for (const href of ['mailto:info(at)example.test', 'mailto:@example.test', 'mailto:info@', 'mailto:?to=sales']) assert.notEqual(mailtoProblem(href), null, href);
});

test('cro.contact.link_invalid fails a page with a link that cannot be dialled or written to', () => {
  const tel = (/** @type {string} */ href) => ({ ...makeLink({ url: `${SITE}/x` }), href, url: null, internal: false });
  const { stat, findings } = run([
    makePage({ url: `${SITE}/ok`, links: [tel('tel:+44 20 7123 4567'), tel('mailto:hi@example.test')] }),
    makePage({ url: `${SITE}/bad`, links: [tel('tel:+1-800-FLOWERS'), tel('mailto:hi@example.test')] }),
    makePage({ url: `${SITE}/none` }),
  ], 'cro.contact.link_invalid');
  assert.deepEqual([stat?.applicable, findings.length, findings[0].selector], [2, 1, 'a[href="tel:+1-800-FLOWERS"]']);
});

test('a checkbox or radio button outside any form, and a control with neither a name nor a form, is not a form field', () => {
  const { stat, findings } = run([
    page('/menu', '<input type="checkbox" id="toggle"><input class="menu-input" type="checkbox"><input type="radio" name="slider"><input id="widget">'),
    page('/search', '<input name="q">'),
    page('/form', '<form><input type="checkbox"></form>'),
  ], 'cro.form.control_unnamed');
  assert.deepEqual([stat?.applicable, findings.map((finding) => finding.url)], [2, [`${SITE}/form`, `${SITE}/search`]], 'menus, accordions and sliders built with style sheets are not units');
});

test('a label that names its control with aria-label or an icon\'s aria-label gives a name', () => {
  const { findings } = run([page('/a', '<input type="checkbox" id="t" name="t"><label for="t" aria-label="Menu"><svg></svg></label><label><span aria-label="Search"></span><input name="q"></label>')], 'cro.form.control_unnamed');
  assert.deepEqual(findings, []);
});

test('pages without the forms reading are skipped with a reason, and a failed reading is not a unit', () => {
  const old = run([makePage({ forms: undefined })], 'cro.form.control_unnamed');
  assert.equal(old.stat?.status, 'skipped');
  assert.match(String(old.stat?.skip_reason), /before rule set 0\.2\.1/);
  const failed = run([makePage({ forms: { forms: [], controls: [], hidden_controls: 0, tcf_stub: false, first_action: null, failed: true } })], 'cro.form.control_unnamed');
  assert.deepEqual([failed.stat?.status, failed.stat?.applicable], ['run', 0]);
});

test('a finding says what was not judged when the page had more controls than are read, and a long form has at least that many fields', () => {
  const body = `<form id="big">${'<input name="x">'.repeat(2030)}</form>`;
  const { findings } = run([page('/big', body)], 'cro.form.control_unnamed');
  const observed = /** @type {any} */ (findings[0].evidence.observed);
  assert.deepEqual([observed.controls, observed.of, observed.not_judged], [200, 200, 1830]);
  assert.match(String(findings[0].evidence.detail), /1800 visible controls past the first 200 kept; 30 controls past the first 2000 looked at, not read/);
  const count = run([page('/big', body)], 'cro.form.field_count_high').findings[0];
  assert.equal(/** @type {any} */ (count.evidence.observed).at_least, true);
});

test('cro.form.autocomplete_invalid judges the whole value read from the page', () => {
  const { findings } = run([page('/a', `<input name="a" autocomplete="section-${'x'.repeat(110)} email">`)], 'cro.form.autocomplete_invalid');
  assert.deepEqual(findings, []);
});

test('tel: escapes are decoded run by run, and only a missing digit or letters are findings', () => {
  for (const href of ['tel:%E0%A4%A', 'tel:12%ZZdead', 'tel:\u0661\u0662\u0663']) assert.notEqual(telProblem(href), null, href);
  for (const href of ['tel:%2B1%20(555)%20123-4567', 'tel:+1555,,123', 'tel:+49/30/12345', 'tel:+1555_123']) assert.equal(telProblem(href), null, `${href}: only no digit and letters are judged`);
  assert.match(String(telProblem('tel:#')), /no digit, so the link dials nothing/);
  assert.doesNotMatch(String(telProblem('tel:*')), /RFC/);
});

test('the autocomplete checks do not count a name past the kept ids as not judged: the name does not matter to them', async () => {
  const { MAX_IDS } = await import('../../../plugin/server/src/extract/forms.js');
  const ids = Array.from({ length: MAX_IDS + 5 }, (_, i) => `<i id="i${i}"></i>`).join('');
  const { findings } = run([page('/a', `${ids}<form><input type="email" name="mail" aria-labelledby="later"><span id="later">E-mail</span></form>`)], 'cro.form.autocomplete_missing');
  assert.equal(/** @type {any} */ (findings[0].evidence.observed).not_judged, undefined);
  assert.equal(findings[0].evidence.detail, undefined);
});
