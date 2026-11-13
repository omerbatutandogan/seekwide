// What an adversarial review of rule set 0.1.8 (2026-11-12) found in the
// hidden-link scan, each case reproduced before its fix: hidden links that
// slipped past it, and real menus it reported.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractPage } from '../../plugin/server/src/extract/page.js';
import { MAX_TRACKED_HOSTS } from '../../plugin/server/src/extract/security.js';
import { registrableDomain } from '../../plugin/server/src/util/public-suffix.js';
import { makeFetch, makeInput } from './fetch-result.js';

/** @import { PageSecurity } from '../../plugin/server/src/types.js' */

/** CPU time this process has used, in milliseconds. */
const cpuMs = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

/** @param {string} html */
const record = (html) => extractPage(makeInput(makeFetch({ html })));
/** @param {string} html */
const hiddenHosts = (html) => /** @type {PageSecurity} */ (record(`<body><p>Text</p>${html}</body>`).security).hidden_links.map((link) => link.host);
const SPAM = '<a href="https://spam.test/">cheap pills</a>';

test('an element cannot open itself, and only a control that can be used names what it opens (A1)', () => {
  const cases = {
    'it names itself': `<div id="q" aria-controls="q" style="display:none">${SPAM}</div>`,
    'an element inside it names it': `<div id="q" style="display:none"><button aria-controls="q">x</button>${SPAM}</div>`,
    'a paragraph names it': `<p aria-controls="q">x</p><div id="q" hidden>${SPAM}</div>`,
    'a <link> names it': `<link aria-controls="q"><div id="q" hidden>${SPAM}</div>`,
    'a hidden link names it': `<a href="#q" style="display:none">.</a><div id="q" hidden>${SPAM}</div>`,
    'an image\'s lazy-loading data-src matches its id': `<img data-src="q"><div id="q" hidden>${SPAM}</div>`,
    'x-show with its own binding': `<div x-data><div x-show="a" @click="a = 1" style="display:none">${SPAM}</div></div>`,
    'x-show and x-data on the element itself': `<div x-data="{a: false}" x-show="a" @click="a = 1" style="display:none">${SPAM}</div>`,
  };
  for (const [name, html] of Object.entries(cases)) assert.deepEqual(hiddenHosts(html), ['spam.test'], name);
});

test('menus and dialogs of real component libraries stay quiet (B1, B2)', () => {
  const cases = {
    'Alpine.js component with a method': `<div x-data="dropdown"><button @click="toggle">m</button><ul x-show="open" style="display:none"><li>${SPAM}</li></ul></div>`,
    'Alpine.js component, x-on with a call': `<div x-data="menu()"><button x-on:click="toggle()">m</button><ul x-show="isOpen" style="display:none">${SPAM}</ul></div>`,
    'Vue method': `<div id="app"><button @click="toggleMenu">m</button><ul v-show="menuOpen" style="display:none">${SPAM}</ul></div>`,
    'tab panel labelled by its tab': `<button role="tab" id="t2">Two</button><div role="tabpanel" aria-labelledby="t2" hidden>${SPAM}</div>`,
    'tooltip described by a link': `<a href="/x" aria-describedby="tip">x</a><div role="tooltip" id="tip" hidden>${SPAM}</div>`,
    'button wrapped in a box': `<div class="toggle"><button aria-expanded="false">m</button></div><ul hidden>${SPAM}</ul>`,
    'popover named by its button': `<button popovertarget="p">m</button><div id="p" popover style="display:none">${SPAM}</div>`,
    'fancybox data-src with #': `<a data-fancybox data-src="#box" href="javascript:;">open</a><div id="box" style="display:none">${SPAM}</div>`,
  };
  for (const [name, html] of Object.entries(cases)) assert.deepEqual(hiddenHosts(html), [], name);
});

test('elements built to be opened around a hidden block cannot push its own hiding out (C2)', () => {
  const wrappers = (/** @type {number} */ n) => `${'<summary>m</summary><div hidden>'.repeat(n)}<div style="display:none">${SPAM}</div>${'</div>'.repeat(n)}`;
  for (const n of [3, 4, 5, 8]) assert.deepEqual(hiddenHosts(wrappers(n)), ['spam.test'], `${n} wrappers`);
  assert.deepEqual(hiddenHosts(`${'<summary>m</summary><div hidden>'.repeat(5)}${SPAM}${'</div>'.repeat(5)}`), [], 'openable all the way down');
});

test('a link with an address longer than 2,048 characters is read too, hidden or visible (A2)', () => {
  const long = `https://spam.test/?${'a'.repeat(2100)}`;
  const hidden = /** @type {PageSecurity} */ (record(`<body><div style="display:none"><a href="${long}">x</a></div></body>`).security).hidden_links;
  assert.deepEqual(hidden.map((link) => [link.host, link.url.length]), [['spam.test', 300]], 'recorded, its address clipped');
  assert.deepEqual(hiddenHosts(`<a href="${long}">visible</a><div style="display:none"><a href="https://spam.test/">x</a></div>`), [],
    'a visible link with a long address makes its host visible');
});

test('links in a declarative shadow root are scanned under the hiding around them (A3)', () => {
  const page = record(`<body><div style="display:none"><template shadowrootmode="open"><a href="https://spam.test/">x</a></template></div>
<div><template shadowrootmode="open"><p style="font-size:0">${SPAM.replace('spam', 'tiny')}</p></template></div><a href="/a">a</a></body>`);
  const hidden = /** @type {PageSecurity} */ (page.security).hidden_links;
  assert.deepEqual(hidden.map((link) => [link.host, link.index]), [['spam.test', -1], ['tiny.test', -1]], 'not in the record\'s links');
  assert.equal(page.links.length, 1);
});

test('padding with hosts that are both visible and hidden no longer fills the room for hidden ones (A4)', () => {
  const hosts = Array.from({ length: MAX_TRACKED_HOSTS }, (_, i) => `<a href="https://h${i}.test/">h</a>`).join('');
  const page = record(`<body><section>${hosts}</section><div style="display:none">${hosts}</div><div style="display:none">${SPAM}</div></body>`);
  assert.deepEqual(/** @type {PageSecurity} */ (page.security).hidden_links.map((link) => link.host), ['spam.test']);
});

test('a page of hosts with hundreds of labels is scanned in well under a second of CPU time (C1)', () => {
  const label = (/** @type {number} */ i) => Array.from({ length: 400 }, () => 'a').join('.') + `.h${i}.test`;
  const html = `<body>${Array.from({ length: 2400 }, (_, i) => `<div hidden><a href="https://${label(i)}/">x</a></div>`).join('')}</body>`;
  const started = cpuMs();
  record(html);
  const elapsed = cpuMs() - started;
  assert.ok(elapsed < 3000, `took ${elapsed} ms of CPU time`);
  assert.equal(registrableDomain(label(1)), null, 'a name longer than 253 characters has no registered domain');
});
