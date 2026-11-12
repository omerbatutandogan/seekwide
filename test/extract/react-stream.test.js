// React streaming server rendering (validation of 2026-11-12, fix 1). The
// pages below are synthetic and model the markup React's Fizz server writes
// on Next.js App Router sites: a Suspense boundary's placeholder
// `<!--$?--><template id="B:n"></template>…<!--/$-->`, the streamed content
// in `<div hidden id="S:n">` later in the response, and the inline call that
// moves it into place. On a real site the whole footer arrived that way, and
// its links to other sites were reported as hidden links.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractHtml } from '../../server/src/extract/html.js';

/** React's boundary-completion function, abridged to an empty body. */
const RUNTIME = '$RC=function(a,b){}';

/** @param {string} body */
function extract(body) {
  return extractHtml(`<!doctype html><html lang="en"><head><title>Example</title></head><body>${body}</body></html>`, {
    responseUrl: 'https://www.example.test/', siteHost: 'www.example.test', includeSubdomains: false,
  });
}

/** @param {string} body */
const hiddenHosts = (body) => (extract(body).security?.hidden_links ?? []).map((link) => link.host);

/** A streamed footer with a link to another site, the pattern of the real case. */
const footer = '<div hidden id="S:3"><footer><section><a href="https://community.partner.test/" rel="noopener">Community</a></section></footer></div>';
const placeholder = '<main><a href="/learn">Learn</a></main><!--$?--><template id="B:3"></template><!--/$-->';

test('a streamed boundary that the page completes with $RC is not hidden content', () => {
  assert.deepEqual(hiddenHosts(`${placeholder}${footer}<script>${RUNTIME};$RC("B:3","S:3")</script>`), []);
});

test('the other ways React reveals a segment count too: $RR, $RS into a placeholder, and the React 18.2 declaration', () => {
  // $RR waits for a style sheet, then completes the boundary like $RC.
  assert.deepEqual(hiddenHosts(`${placeholder}${footer}<script>$RR=function(a,b,c){};$RR("B:3","S:3",[["/a.css","high"]])</script>`), []);
  // A segment that fills a placeholder template inside other content.
  assert.deepEqual(hiddenHosts(`<div><template id="P:8"></template></div><div hidden id="S:8"><a href="https://docs.partner.test/">Docs</a></div>
<script>$RS=function(a,b){};$RS("S:8","P:8")</script>`), []);
  assert.deepEqual(hiddenHosts(`${placeholder}${footer}<script>function $RC(a,b){};$RC("B:3","S:3")</script>`), []);
  // Ids are hexadecimal, and the call can come many scripts later.
  assert.deepEqual(hiddenHosts(`<!--$?--><template id="B:1f"></template><!--/$--><div hidden id="S:1f"><a href="https://x.partner.test/">X</a></div>
<script>${RUNTIME}</script><script>var other = 1;</script><script>$RC("B:1f","S:1f")</script>`), []);
});

test('a hidden element without every part of the React pattern still hides its links', () => {
  // No template and no call: a plain hidden block, the negative case the validation asked to keep.
  assert.deepEqual(hiddenHosts(`<main>Text</main><div hidden><a href="https://spam.test/">pills</a></div>`), ['spam.test']);
  assert.deepEqual(hiddenHosts(`<main>Text</main>${footer}`), ['community.partner.test'], 'no template, no call');
  assert.deepEqual(hiddenHosts(`${placeholder}${footer}`), ['community.partner.test'], 'no call');
  assert.deepEqual(hiddenHosts(`<main>Text</main>${footer}<script>${RUNTIME};$RC("B:3","S:3")</script>`), ['community.partner.test'], 'no template');
  assert.deepEqual(hiddenHosts(`${placeholder}${footer}<script>$RC("B:3","S:3")</script>`), ['community.partner.test'], 'the function is never defined');
  assert.deepEqual(hiddenHosts(`${placeholder}${footer}<script>$RC("B:3","S:3");${RUNTIME}</script>`), ['community.partner.test'], 'defined after the call');
  assert.deepEqual(hiddenHosts(`${placeholder}<script>${RUNTIME};$RC("B:3","S:3")</script>${footer}`), ['community.partner.test'], 'the call comes before the element');
  assert.deepEqual(hiddenHosts(`<main>Text</main>${footer}<!--$?--><template id="B:3"></template><!--/$--><script>${RUNTIME};$RC("B:3","S:3")</script>`),
    ['community.partner.test'], 'the template comes after the element');
  assert.deepEqual(hiddenHosts(`<template id="B:3"></template>${footer}<script>${RUNTIME};$RC("B:3","S:3")</script>`),
    ['community.partner.test'], 'the template is not inside a pending boundary');
  assert.deepEqual(hiddenHosts(`${placeholder}${footer}<script src="/react.js"></script><script type="text/plain">${RUNTIME};$RC("B:3","S:3")</script>`),
    ['community.partner.test'], 'a script that does not run');
  assert.deepEqual(hiddenHosts(`${placeholder}${footer}<script>${RUNTIME};$RC("B:4","S:3")</script>`), ['community.partner.test'], 'the call names another boundary');
  assert.deepEqual(hiddenHosts(`<!--$?--><template id="B:3"><b>not empty</b></template><!--/$-->${footer}<script>${RUNTIME};$RC("B:3","S:3")</script>`),
    ['community.partner.test'], 'the template holds content');
});

test('only the segment\'s own hidden attribute is excused: any other hiding inside or on it still counts', () => {
  // display:none inside a streamed boundary is hidden as on any page.
  assert.deepEqual(hiddenHosts(`${placeholder}<div hidden id="S:3"><a href="/x">x</a><div style="display:none"><a href="https://spam.test/">pills</a></div></div>
<script>${RUNTIME};$RC("B:3","S:3")</script>`), ['spam.test']);
  assert.deepEqual(hiddenHosts(`${placeholder}<div hidden id="S:3"><p style="position:absolute;left:-9999px"><a href="https://spam.test/">pills</a></p></div>
<script>${RUNTIME};$RC("B:3","S:3")</script>`), ['spam.test']);
  // React never puts a style on the segment; one that does is not excused.
  assert.deepEqual(hiddenHosts(`${placeholder}<div hidden id="S:3" style="display:none"><a href="https://spam.test/">pills</a></div>
<script>${RUNTIME};$RC("B:3","S:3")</script>`), ['spam.test']);
  // A hidden element above the segment still hides it.
  assert.deepEqual(hiddenHosts(`${placeholder}<div style="display:none">${footer}</div><script>${RUNTIME};$RC("B:3","S:3")</script>`), ['community.partner.test']);
  // When ids repeat, only the first element with the id is the segment, as for getElementById.
  assert.deepEqual(hiddenHosts(`${placeholder}${footer}<div hidden id="S:3"><a href="https://spam.test/">pills</a></div><script>${RUNTIME};$RC("B:3","S:3")</script>`),
    ['spam.test']);
});

test('the fallback a completed boundary replaces adds no heading and no text, but keeps its links and counts for spam terms', () => {
  // Modeled on a login page whose loading fallback repeats the heading of the streamed form.
  const page = extract(`<main><!--$?--><template id="B:b"></template><div class="skeleton"><h1>Log in to Example</h1><p>Loading account</p>
<a href="/help">Help</a></div><!--/$--></main><div hidden id="S:b"><h1>Log in to Example</h1><form>Email</form></div><script>${RUNTIME};$RC("B:b","S:b")</script>`);
  assert.deepEqual(page.headings.map((heading) => heading.text), ['Log in to Example']);
  assert.equal(page.text_excerpt.includes('Loading account'), false);
  assert.equal(page.word_count, 5, 'Log in to Example Email');
  assert.deepEqual(page.links.map((link) => link.href), ['/help'], 'links of the fallback stay: a crawler that runs no script sees them');

  const spam = extract(`<!--$?--><template id="B:1"></template><p>buy viagra and cialis online</p><!--/$--><div hidden id="S:1">Welcome</div>
<script>${RUNTIME};$RC("B:1","S:1")</script>`);
  assert.equal(spam.text_excerpt.includes('viagra'), false);
  assert.equal(spam.security?.spam_terms.pharma?.count, 2, 'the security signals read the fallback too');
});

test('the fallback is read as React does: nested boundaries counted, and only for a completed boundary', () => {
  const nested = extract(`<!--$?--><template id="B:1"></template><h2>Outer fallback</h2><!--$--><h2>Inner done</h2><!--/$--><h2>Still fallback</h2><!--/$-->
<h2>After</h2><div hidden id="S:1"><h2>Content</h2></div><script>${RUNTIME};$RC("B:1","S:1")</script>`);
  assert.deepEqual(nested.headings.map((heading) => heading.text), ['After', 'Content']);
  // A boundary still pending (no call) or rendered on the client ($RX) keeps its fallback.
  const pending = extract(`<!--$?--><template id="B:1"></template><h2>Loading</h2><!--/$--><script>${RUNTIME};$RX=function(){};$RX("B:1","")</script>`);
  assert.deepEqual(pending.headings.map((heading) => heading.text), ['Loading']);
});

test('the positions of hidden links still point at the right entry of links on a streamed page', () => {
  const page = extract(`<!--$?--><template id="B:1"></template><a href="/a">a</a><!--/$--><div hidden id="S:1"><a href="/b">b</a></div>
<script>${RUNTIME};$RC("B:1","S:1")</script><div style="display:none"><a href="https://spam.test/">pills</a></div>`);
  const [hidden] = page.security?.hidden_links ?? [];
  assert.equal(page.links[hidden.index].url, 'https://spam.test/');
});

// Review of 2026-11-12: ways to switch the exemption on without React's script running, and content moved into a hidden place.

test('a definition or call that does not run as a top-level statement does not count', () => {
  const tail = `${placeholder}${footer}`;
  for (const script of [
    '/*$RC=function*/ /*$RC("B:3","S:3")*/',
    'var a = \'$RC=function(){};$RC("B:3","S:3")\';',
    'if (false) { $RC=function(a,b){}; $RC("B:3","S:3") }',
    `${RUNTIME}; false && $RC("B:3","S:3")`,
    `// ${RUNTIME};$RC("B:3","S:3")`,
  ]) {
    assert.deepEqual(hiddenHosts(`${tail}<script>${script}</script>`), ['community.partner.test'], script);
  }
  assert.deepEqual(hiddenHosts(`${tail}<script nomodule>${RUNTIME};$RC("B:3","S:3")</script>`), ['community.partner.test'], 'a nomodule script does not run');
});

test('content moved into a hidden place, or served inside one, stays hidden', () => {
  assert.deepEqual(hiddenHosts(`<div style="display:none">${placeholder}</div>${footer}<script>${RUNTIME};$RC("B:3","S:3")</script>`), ['community.partner.test']);
  assert.equal(extract(`<div style="display:none"><template id="P:1"></template></div><div hidden id="S:1"><a href="https://spam.test/">p</a></div>
<script>$RS=function(a,b){};$RS("S:1","P:1")</script>`).security?.hidden_links[0]?.how, 'display:none');
  assert.deepEqual(hiddenHosts(`${placeholder}<div style="display:none">${footer}</div><script>${RUNTIME};$RC("B:3","S:3")</script>`), ['community.partner.test']);
});

test('a page with thousands of ids still has its streamed footer read as revealed', () => {
  const headings = Array.from({ length: 6000 }, (_, i) => `<h2 id="s${i}">Section ${i}</h2>`).join('');
  assert.deepEqual(hiddenHosts(`${headings}${placeholder}${footer}<script>${RUNTIME};$RC("B:3","S:3")</script>`), []);
});

test('nested boundaries with a long fallback are read in a bounded time', () => {
  const n = 2400;
  const html = Array.from({ length: n }, (_, i) => `<!--$?--><template id="B:${i}"></template>`).join('') + '<!--x-->'.repeat(180_000) + '<!--/$-->'.repeat(n)
    + Array.from({ length: n }, (_, i) => `<div hidden id="S:${i}"></div>`).join('') + `<script>${RUNTIME};${Array.from({ length: n }, (_, i) => `$RC("B:${i}","S:${i}")`).join(';')}</script>`;
  const start = process.cpuUsage();
  extract(html);
  const used = process.cpuUsage(start);
  // The first version took about 13 seconds of CPU here.
  assert.ok((used.user + used.system) / 1000 < 3000, `took ${(used.user + used.system) / 1000} ms of CPU time`);
});
