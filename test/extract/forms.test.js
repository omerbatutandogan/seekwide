// What the cro module reads from a page's forms (rule set 0.2.1).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractHtml } from '../../plugin/server/src/extract/html.js';
import { MAX_CONTROLS, MAX_FORMS, MAX_IDS, MAX_SEEN_CONTROLS, emptyForms, formsRecord, formsState, visitForms } from '../../plugin/server/src/extract/forms.js';
import { extractPage } from '../../plugin/server/src/extract/page.js';
import { PAGE_URL, makeFetch, makeInput } from './fetch-result.js';

/** @param {string} body */
const read = (body) => /** @type {import('../../plugin/server/src/types.js').FormsRecord} */ (
  extractHtml(`<html><head><title>T</title></head><body>${body}</body></html>`, { responseUrl: 'https://example.test/c', siteHost: 'example.test', includeSubdomains: false }).forms);

/** @param {string} body */
const names = (body) => Object.fromEntries(read(body).controls.map((control) => [control.name, control.named_by]));

test('each visible control records the first source of its name, labels named after the control included', () => {
  assert.deepEqual(names([
    '<input name="a" id="a"><label for="a">Email</label>',
    '<label>Phone <input name="b"></label>',
    '<label><input name="c" placeholder="Only inside"></label>',
    '<input name="d" aria-labelledby="missing other"><span id="other">Country</span>',
    '<input name="e" aria-labelledby="nowhere">',
    '<input name="f" aria-label="Search">',
    '<input name="g" title="City">',
    '<input name="h" :aria-label="t(\'name\')">',
    '<input name="i" placeholder="Your name">',
    '<input name="j" [placeholder]="hint">',
    '<input name="k" aria-label="  ">',
    '<label for="l"></label><input name="l" id="l">',
    '<textarea name="m"></textarea><select name="n"><option>Pick one</option></select>',
  ].join('')), {
    a: 'label', b: 'wrapping_label', c: 'placeholder', d: 'labelledby', e: 'none', f: 'aria_label', g: 'title', h: 'binding',
    i: 'placeholder', j: 'placeholder', k: 'none', l: 'none', m: 'none', n: 'none',
  });
});

test('controls the markup hides, and inputs that are not filled in, are left out and counted', () => {
  const record = read([
    '<input type="hidden" name="token"><input type="submit"><input type="button" value="x"><input type="reset"><input type="image" src="go.png">',
    '<div style="position:absolute; left:-5000px" aria-hidden="true"><input name="mailchimp_trap" tabindex="-1"></div>',
    '<input name="a" hidden><input name="b" style="display: none"><input name="c" style="visibility:hidden">',
    '<div hidden><input name="d"></div><div hidden="until-found"><input name="shown"></div>',
    '<template><input name="inert"></template>',
  ].join(''));
  assert.deepEqual(record.controls.map((control) => control.name), ['shown']);
  assert.equal(record.hidden_controls, 5, 'the trap, three hidden by themselves and one in a hidden block; a template is never read');
});

test('a control belongs to the form around it or to the form its form attribute names, and forms count their fields', () => {
  const record = read([
    '<form id="f1" action="/send" method="POST"><input name="a"><input name="b"></form>',
    '<input name="c" form="f1"><input name="d" form="unknown"><input name="e">',
    '<form role="search" action="https://example.test/search"><input name="q"></form>',
    '<search><form><input name="q2"></form></search>',
    '<form><input type="search" name="q3"></form>',
    '<form action="http://example.test/old"><input name="x"></form><form action=""><input name="y"></form><form action="javascript:void(0)"></form>',
  ].join(''));
  assert.deepEqual(record.controls.map((control) => [control.name, control.form]), [['a', 0], ['b', 0], ['c', 0], ['d', null], ['e', null], ['q', 1], ['q2', 2], ['q3', 3], ['x', 4], ['y', 5]]);
  assert.deepEqual(record.forms.map((form) => [form.fields, form.search, form.method, form.action]), [
    [3, false, 'post', 'https://example.test/send'], [1, true, 'get', 'https://example.test/search'], [1, true, 'get', null], [1, true, 'get', null],
    [1, false, 'get', 'http://example.test/old'], [1, false, 'get', null], [0, false, 'get', null],
  ]);
});

test('types, autocomplete and a paste handler that blocks are recorded', () => {
  const [email, plain, password, area] = read([
    '<input type="EMAIL" name="mail" autocomplete=" shipping\n email ">',
    '<input name="phone" type="">',
    '<input type="password" name="pw" onpaste="event.preventDefault();">',
    '<textarea name="note" onpaste="return  false"></textarea>',
  ].join('')).controls;
  assert.deepEqual([email.type, email.autocomplete, email.paste_blocked], ['email', 'shipping email', false]);
  assert.deepEqual([plain.type, plain.autocomplete], ['text', null]);
  assert.equal(password.paste_blocked, true);
  assert.deepEqual([area.tag, area.type, area.paste_blocked], ['textarea', 'textarea', true]);
});

test('the IAB TCF consent API is seen in an inline script or a frame named for it', () => {
  assert.equal(read('<script>window.__tcfapi = function () {};</script>').tcf_stub, true);
  assert.equal(read('<iframe name="__tcfapiLocator" style="display:none"></iframe>').tcf_stub, true);
  assert.equal(read('<script src="https://cdn.example/__tcfapi.js"></script><p>__tcfapi</p>').tcf_stub, false, 'a script file and plain text do not count');
});

test('the first action element is the first button or submit control in the main element, with the words and elements before it', () => {
  const inMain = read('<header><button>Menu</button></header><main><h1>Three little words</h1><p>and two</p><form><input type="submit" value="Go"></form><button>Later</button></main>');
  assert.deepEqual(inMain.first_action, { in_main: true, tag: 'input', words_before: 5, elements_before: 3, line: 1 });
  assert.equal(read('<header><button>Menu</button></header><main><p>No action here</p></main>').first_action, null, 'one in the header does not count when the page has a main element');
  assert.deepEqual(read('<p>Hello there</p><button>Buy</button>').first_action, { in_main: false, tag: 'button', words_before: 2, elements_before: 1, line: 1 });
  assert.deepEqual(read('<div role="main"><button>Go</button></div>').first_action?.in_main, true);
});

test('names a page gives as ids and form names are kept apart from object properties', () => {
  const record = read('<form id="constructor"><label for="__proto__">Name</label><input id="__proto__" name="toString" form="constructor"></form><input form="hasOwnProperty" name="x">');
  assert.deepEqual(record.controls.map((control) => [control.name, control.form, control.named_by]), [['toString', 0, 'label'], ['x', null, 'none']]);
});

test('more forms than the cap are counted in limits_reached, and a page without HTML has an empty reading', () => {
  const html = `<html><body>${'<form><input name="a"></form>'.repeat(MAX_FORMS + 1)}</body></html>`;
  const fields = extractHtml(html, { responseUrl: 'https://example.test/', siteHost: 'example.test', includeSubdomains: false });
  assert.equal(fields.forms?.forms.length, MAX_FORMS);
  assert.ok(fields.limits_reached?.includes('forms'));
  assert.equal(fields.forms?.controls.at(-1)?.form, null, 'a control of a form past the cap belongs to none');
  const pdf = extractPage(makeInput(makeFetch({ body: Buffer.from('%PDF-1.7'), headers: { 'content-type': 'application/pdf' } })));
  assert.deepEqual(pdf.forms, emptyForms());
  assert.equal(extractPage(makeInput(makeFetch({ url: PAGE_URL }))).forms?.failed, undefined);
});

test('an error while reading forms marks the reading failed and never stops the extraction', () => {
  const state = formsState('https://example.test/');
  const hostile = { nodeName: 'input', tagName: 'input', get attrs() { throw new Error('boom'); } };
  visitForms(/** @type {any} */ (hostile), /** @type {any} */ ({ body: true }), state, 0);
  assert.equal(state.failed, true);
  assert.deepEqual(formsRecord(state, [], /\w+/g), { ...emptyForms(), failed: true });
});

test('ids, for and form match exactly as written, and only the first element with an id is the target', () => {
  const long = 'a'.repeat(150);
  assert.deepEqual(names(`<label for="${long}">Name</label><input id="${long}" name="long">`), { long: 'label' }, 'an id longer than the kept 100 characters still matches');
  const record = read('<form id="F"><input name="a"></form><input name="b" form=" F "><input name="c" form="F">');
  assert.deepEqual(record.controls.map((control) => [control.name, control.form]), [['a', 0], ['b', null], ['c', 0]], 'a form attribute with spaces names no form');
  assert.deepEqual(names('<label for="dup">Email</label><input id="dup" name="first"><input id="dup" name="second">'), { first: 'label', second: 'none' });
  assert.deepEqual(names('<label for="zz">Foo <input name="w"></label><input id="zz" name="z">'), { w: 'none', z: 'label' }, 'a label whose for points elsewhere does not name what it wraps');
  assert.deepEqual(names('<label>Both <input name="one"><input name="two"></label>'), { one: 'wrapping_label', two: 'none' }, 'a label names its first labelable element only');
  assert.deepEqual(names('<label>Go <button>B</button><input name="after"></label>'), { after: 'none' }, 'a button is labelable too');
});

test('aria-labelledby naming the control itself or an empty element gives no name, and hidden label text is no name', () => {
  assert.deepEqual(names('<input name="self" id="me" aria-labelledby="me"><div id="e"></div><input name="empty" aria-labelledby="e"><span id="t">Topic</span><input name="ok" aria-labelledby="e t">'), { self: 'none', empty: 'none', ok: 'labelledby' });
  assert.deepEqual(names('<label for="q"><span hidden>Email</span></label><input id="q" name="q"><label for="r"><span style="position:absolute;left:-10000px">Phone</span></label><input id="r" name="r">'), { q: 'none', r: 'label' }, 'text moved off-screen is read by screen readers');
});

test('past the ids the reading keeps, a name such an id could give is unknown and the limit is recorded', () => {
  const ids = Array.from({ length: MAX_IDS + 5 }, (_, i) => `<i id="i${i}"></i>`).join('');
  const fields = extractHtml(`<html><body>${ids}<form><span id="late">Name</span><input name="q" aria-labelledby="late"></form></body></html>`, { responseUrl: 'https://example.test/', siteHost: 'example.test', includeSubdomains: false });
  assert.equal(fields.forms?.controls[0].named_by, 'unknown');
  assert.ok(fields.limits_reached?.includes('forms.ids'));
});

test('a control nested deeper than the reading looks is not judged, and controls past those looked at are counted', () => {
  const deep = read(`<div hidden>${'<div>'.repeat(250)}<input name="trap">${'</div>'.repeat(250)}</div>`);
  assert.deepEqual([deep.controls.length, deep.hidden_controls, deep.unjudged_controls], [0, 0, 1], 'a honeypot hidden higher up is not taken for a visible field');
  const many = read(`<form>${'<input name="x">'.repeat(MAX_SEEN_CONTROLS + 30)}</form>`);
  assert.deepEqual([many.controls.length, many.visible_controls, many.unread_controls], [MAX_CONTROLS, MAX_SEEN_CONTROLS, 30]);
});

test('the whole autocomplete value is judged before it is clipped, and the grammar compares ASCII only', () => {
  const [long, nbsp, kelvin] = read(`<input name="a" autocomplete="section-${'x'.repeat(110)} email"><input name="b" autocomplete="shipping email"><input name="c" autocomplete="Kanji">`).controls;
  assert.equal(long.autocomplete?.length, 100);
  assert.equal(long.autocomplete_valid, true);
  assert.equal(nbsp.autocomplete_valid, false, 'a non-ASCII space does not split tokens');
  assert.equal(kelvin.autocomplete_valid, false);
});

test('aria-labelledby to an image, an element named by aria-label or title, or an SVG title gives a name; nested labels and an empty for follow HTML', () => {
  assert.deepEqual(names([
    '<img id="i" alt="Email"><input name="img" aria-labelledby="i">',
    '<span id="t" title="Phone"></span><input name="title" aria-labelledby="t">',
    '<span id="a" aria-label="City"></span><input name="aria" aria-labelledby="a">',
    '<svg><title id="s">Country</title></svg><input name="svg" aria-labelledby="s">',
    '<label>Outer <label><input name="nested"></label></label>',
    '<label for="">Name <input id="" name="emptyfor"></label>',
  ].join('')), { img: 'labelledby', title: 'labelledby', aria: 'labelledby', svg: 'labelledby', nested: 'wrapping_label', emptyfor: 'none' });
});

test('naming many controls by one large element, and deeply nested labels, cost about what the page costs without them', () => {
  const time = (/** @type {string} */ body) => {
    const started = performance.now();
    read(body);
    return performance.now() - started;
  };
  const big = `<div id="big">${'<b></b>'.repeat(60000)}</div>`;
  const baseline = time(`${big}<form>${'<input name="x" aria-label="y">'.repeat(2000)}</form>`);
  const referenced = time(`${big}<form>${'<input name="x" aria-labelledby="big big big big big">'.repeat(2000)}</form>`);
  assert.ok(referenced < baseline * 4 + 300, `${Math.round(referenced)} ms against ${Math.round(baseline)} ms`);
  const divs = time('<div>t'.repeat(60000));
  const labels = time('<label>t'.repeat(60000));
  assert.ok(labels < divs * 4 + 300, `${Math.round(labels)} ms against ${Math.round(divs)} ms`);
});
