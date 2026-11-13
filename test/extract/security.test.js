import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractPage } from '../../plugin/server/src/extract/page.js';
import { MAX_EMBEDS, MAX_HIDDEN_HOSTS, MAX_TRACKED_HOSTS, MAX_VISIBLE_HOSTS } from '../../plugin/server/src/extract/security.js';
import { LIMITS } from '../../plugin/server/src/config.js';
import { makeFetch, makeInput } from './fetch-result.js';

/** @import { PageSecurity } from '../../plugin/server/src/types.js' */

/** CPU time this process has used, in milliseconds. */
const cpuMs = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

/**
 * @param {string} html
 * @param {Partial<import('../../plugin/server/src/types.js').FetchResult>} [result]
 */
function page(html, result = {}) {
  return extractPage(makeInput(makeFetch({ html, ...result })));
}

/** @param {string} html */
const security = (html) => /** @type {PageSecurity} */ (page(html).security);
/** @param {string} html */
const hiddenHosts = (html) => security(html).hidden_links.map((link) => link.host);

test('a hidden link to another host is recorded once per host, with its position in links and how it is hidden', () => {
  const html = `<body><a href="/home">Home</a>
<div id="x" style="position:absolute; left:-9999px">
<a href="https://spam.test/pills">pills</a> <a href="/inside">inside</a> <a href="https://spam.test/more">more</a>
</div><a href="https://visible.test/">visible</a></body>`;
  const record = page(html);
  assert.deepEqual(record.security?.hidden_links, [{
    index: 1, url: 'https://spam.test/pills', host: 'spam.test', text: 'pills', how: 'off-screen',
    element: 'div[style="position:absolute; left:-9999px"]', element_line: 2, line: 3, count: 2,
  }]);
  assert.equal(record.links[1].url, 'https://spam.test/pills', 'the index points at the same link');
  assert.deepEqual(record.security?.visible_hosts, ['visible.test']);
});

test('the link positions agree with links when <a> elements sit in SVG, templates and noscript', () => {
  const record = page(`<body><svg><a href="https://svg.test/">s</a></svg><template><a href="https://tpl.test/">t</a></template>
<noscript><a href="https://ns.test/">n</a></noscript><a href="/a">a</a><div hidden><a href="https://h.test/">h</a></div></body>`);
  const [hidden] = record.security?.hidden_links ?? [];
  assert.equal(record.links[hidden.index].url, 'https://h.test/');
});

test('a link whose whole text is one punctuation character is concealed; icons and labelled links are not', () => {
  const found = security(`<body><p>Read more<a href="https://farm.test/x">-</a></p><a href="https://icons.test/">🐦</a>
<a href="https://labelled.test/" aria-label="Partner">·</a><a href="https://titled.test/" title="Partner">|</a><a href="https://letter.test/">X</a></body>`);
  assert.deepEqual(found.hidden_links.map((link) => [link.host, link.how, link.element]), [['farm.test', 'one-character link', null]]);
  assert.deepEqual(found.visible_hosts, ['icons.test', 'labelled.test', 'titled.test', 'letter.test']);
});

test('content a control on the page opens is not hidden: menus, tabs, accordions, pop-ups, dialogs and modals', () => {
  assert.deepEqual(hiddenHosts(`<body>
<button aria-controls="faq other">Q</button><div id="faq" hidden><a href="https://a.test/">a</a></div>
<div id="later" style="display:none"><a href="https://c.test/">c</a></div><span data-bs-target="#later">Show</span>
<ul><li data-tab="map">Map</li></ul><div id="map" style="display:none"><a href="https://maps.test/">m</a></div>
<nav x-data><button @click="open=!open">Resources</button><div x-show="open" style="display: none;"><a href="https://docs.test/">d</a></div></nav>
<div id="app"><a href="#" v-on:click.prevent="menu = true">Menu</a><ul v-show="menu" style="display:none"><li><a href="https://vue.test/">v</a></li></ul></div>
<button aria-expanded="false">More</button><ul style="display:none"><li><a href="https://more.test/">More</a></li></ul>
<a href="/lang" aria-haspopup="true">EN</a><ul style="display:none"><li><a href="https://lang.test/">DE</a></li></ul>
<details><summary>Shipping</summary><div style="display:none"><a href="https://parcel.test/">p</a></div></details>
<button data-bs-toggle="modal" data-bs-target="#modal">Open</button><div id="modal" role="dialog" style="display:none"><a href="https://dialog.test/">x</a></div>
<button popovertarget="pop">Open</button><div id="pop" popover style="display:none"><a href="https://pop.test/">p</a></div>
<div id="nobody" style="display:none"><a href="https://d.test/">d</a></div>
</body>`), ['d.test']);
});

test('a role or an attribute alone does not make hidden content openable (security review F9)', () => {
  const link = '<a href="https://cheap-pills.test/buy">buy</a>';
  const cases = {
    popover: `<div style="display:none" popover>${link}</div>`,
    dialog: `<div style="display:none" role="dialog">${link}</div>`,
    menu: `<div style="display:none" role="menu">${link}</div>`,
    'aria-modal': `<div style="display:none" aria-modal="true">${link}</div>`,
    'x-show outside any Alpine.js component, which Alpine never runs': `<button @click="open = !open">x</button><div style="display:none" x-show="open">${link}</div>`,
    'x-show whose only binding is its own': `<div x-data><div style="display:none" x-show="open" @click="open = true">${link}</div></div>`,
    'v-show on a page whose only binding is inside it': `<div style="display:none" v-show="open"><a href="#" @click="open = true">x</a>${link}</div>`,
    'x-cloak': `<div style="display:none" x-cloak>${link}</div>`,
    'an element with aria-expanded that is no control': `<span aria-expanded="false"></span><div style="position:absolute;left:-9999px">${link}</div>`,
  };
  for (const [name, body] of Object.entries(cases)) assert.deepEqual(hiddenHosts(`<body><p>Article</p>${body}</body>`), ['cheap-pills.test'], name);
});

test('share links are not hidden links to another site; the same name under another ending is left to the check', () => {
  // Anyone can register <name>.<ending>; only a visible link on some crawled page makes it the organisation's, which the
  // check knows and one page does not (hidden.test.js).
  assert.deepEqual(hiddenHosts(`<body><div class="lang"><button class="lang-toggle">EN</button><ul class="lang-menu" style="display:none">
<li><a href="https://example.de/">Deutsch</a></li><li><a href="https://shop.example.co.uk/">UK shop</a></li></ul></div>
<button class="share-btn">Share</button><div class="share-pop" hidden>
<a href="https://www.reddit.com/submit?url=https%3A%2F%2Fexample.test%2Fpost">Reddit</a><a href="https://twitter.com/intent/tweet?url=https://www.example.test/post">X</a>
<a href="https://spam.test/?q=notexample.testing">spam</a></div></body>`), ['example.de', 'shop.example.co.uk', 'spam.test']);
});

test('on a shared hosting domain only the site\'s own host is its own: another customer, or the service, is another site', () => {
  /** @param {string} site @param {string} href */
  const hiddenOn = (site, href) => /** @type {PageSecurity} */ (extractPage(makeInput(
    makeFetch({ url: `https://${site}/`, html: `<body><p>Hi</p><div style="display:none"><a href="${href}">cheap pills</a></div></body>` }),
    { siteHost: site },
  )).security).hidden_links.map((link) => link.host);
  assert.deepEqual(hiddenOn('acme.vercel.app', 'https://spam-pills.vercel.app/buy'), ['spam-pills.vercel.app']);
  assert.deepEqual(hiddenOn('acme.github.io', 'https://casino.github.io/'), ['casino.github.io']);
  assert.deepEqual(hiddenOn('vercel.com', 'https://spam-pills.vercel.app/'), ['spam-pills.vercel.app'], 'the service\'s own site does not own its customers');
  assert.deepEqual(hiddenOn('acme.vercel.app', 'https://vercel.com/'), ['vercel.com']);
  assert.deepEqual(hiddenOn('acme.vercel.app', 'https://preview.acme.vercel.app/'), [], 'a subdomain of the customer\'s host is its own');
  assert.deepEqual(hiddenOn('acme.test', 'https://shop.acme.test/'), [], 'a host under the site\'s registered domain is its own');
  assert.deepEqual(hiddenOn('acme.test', 'https://acme.ru/'), ['acme.ru'], 'the same name under another ending is recorded; the check decides');
  assert.deepEqual(hiddenOn('acme.wordpress.com', 'https://spam.wordpress.com/'), ['spam.wordpress.com'], 'wordpress.com is treated as a public suffix');
});

test('a plain button, link or id that only happens to match does not open what follows', () => {
  assert.deepEqual(hiddenHosts(`<body><footer><p>(c) Acme</p><a href="#" class="top">Top</a><div style="display:none">
<a href="https://payday.test/">payday loans</a></div><button class="top">Up</button><div style="display:none"><a href="https://followers.test/">buy followers</a></div>
<a href="javascript:void(0)">x</a><div style="display:none"><a href="https://js.test/">x</a></div></footer>
<div id="dark" style="display:none"><a href="https://theme.test/">t</a></div><html data-theme="dark"></html>
<div id="collapse" style="display:none"><a href="https://toggle.test/">t</a></div><a data-toggle="collapse">x</a></body>`),
  ['payday.test', 'followers.test', 'js.test', 'theme.test', 'toggle.test']);
});

test('an element built to be opened does not exempt a hiding element inside it of the same kind', () => {
  assert.deepEqual(hiddenHosts(`<body><div role="dialog" style="display:none"><div style="display:none"><a href="https://inner.test/">x</a></div></div>
<div role="dialog" hidden><div hidden><a href="https://inner2.test/">x</a></div></div></body>`), ['inner.test', 'inner2.test']);
});

test('ids named by aria-controls are always collected, however many data values come first', () => {
  const rows = Array.from({ length: 20_100 }, (_, i) => `<i data-target="row${i}"></i>`).join('');
  assert.deepEqual(hiddenHosts(`<body>${rows}<button aria-controls="late-panel">Open</button><div id="late-panel" hidden><a href="https://partner.test/">Partner</a></div></body>`), []);
});

test('every element that hides a link must be one built to be opened', () => {
  assert.deepEqual(hiddenHosts(`<body><button data-bs-target="#modal">Open</button><div id="modal" style="display:none">
<p>Welcome</p><div style="position:absolute;left:-9999px"><a href="https://spam.test/">spam</a></div></div></body>`), ['spam.test']);
});

test('ordinary hiding patterns of real sites are not hidden links or frames', () => {
  const found = security(`<body>
<div style="opacity:0;transform:translateY(20px)"><a href="https://calendly.com/acme/intro">Book a call</a></div>
<a href="https://wordpress.org/" style="display:block;width:120px;height:30px;background:url(/wp.png);text-indent:-9999px">Powered by WordPress</a>
<div style="position: relative; width: 100%; height: 0; padding-top: 56.25%; overflow: hidden;"><iframe style="position: absolute; width: 100%; height: 100%; top: 0; left: 0;" src="https://www.canva.com/design/x/view?embed"></iframe></div>
<div style="overflow:hidden;padding-bottom:56.25%;position:relative;height:0;"><iframe src="https://www.google.com/maps/embed?pb=1" style="height:100%;width:100%;position:absolute;"></iframe><a href="https://goo.gl/maps/xyz">Open in Maps</a></div>
<ul style="font-size:0"><li class="logo"><a href="https://partner-one.test/">One</a></li><li class="logo"><a href="https://partner-two.test/">Two</a></li></ul>
<a class="js-open-video" href="javascript:void(0)">Watch our story</a><div class="video-lightbox" style="display:none"><iframe width="560" height="315" src="https://www.youtube.com/embed/abc"></iframe></div>
<div style="transform:translateX(-100%)"><a href="https://drawer.test/">Off-canvas menu</a></div><div style="position:absolute;left:-100vw"><a href="https://vw.test/">x</a></div>
</body>`);
  assert.deepEqual(found.hidden_links, []);
  assert.deepEqual(found.embeds.filter((embed) => embed.hidden !== null), []);
});

test('scripts of a JavaScript type and frames on other hosts are embeds; a tiny frame is hidden whatever controls it', () => {
  const found = security(`<head><script src="https://cdn.test/a.js"></script><script type="module" src="https://cdn.test/m.js"></script>
<script type="application/ld+json" src="https://data.test/x.json"></script><script type="text/template" src="https://tpl.test/t"></script>
<script src="/own.js"></script></head><body><a href="#f">f</a><div id="f"><iframe src="https://evil.test/x" width="0" height="0"></iframe></div>
<iframe src="https://www.youtube.test/embed/1" width="560" height="315"></iframe><div id="m" style="display:none"><iframe src="https://form.test/x"></iframe></div>
<div style="display:none"><iframe src="https://hidden.test/x"></iframe></div>
<button>Top</button><iframe style="display:none" src="https://after-button.test/x"></iframe>
<div style="display:none"><iframe src="https://player.vimeo.test/video/1"></iframe><iframe style="display:none" src="https://www.youtube.test/embed/2"></iframe></div>
<iframe height="0" style="height:315px" src="https://styled.test/x"></iframe>
<noscript><iframe src="https://gtm.test/ns" height="0" width="0"></iframe></noscript><a href="#m">Open</a></body>`);
  assert.deepEqual(found.embeds.map((embed) => [embed.tag, embed.url, embed.host, embed.hidden]), [
    ['script', 'https://cdn.test/a.js', 'cdn.test', null],
    ['script', 'https://cdn.test/m.js', 'cdn.test', null],
    ['iframe', 'https://evil.test/x', 'evil.test', 'zero size'],
    ['iframe', 'https://www.youtube.test/embed/1', 'youtube.test', null],
    ['iframe', 'https://form.test/x', 'form.test', null],
    ['iframe', 'https://hidden.test/x', 'hidden.test', 'display:none'],
    ['iframe', 'https://after-button.test/x', 'after-button.test', 'display:none'],
    ['iframe', 'https://player.vimeo.test/video/1', 'player.vimeo.test', null],
    ['iframe', 'https://www.youtube.test/embed/2', 'youtube.test', 'display:none'],
    ['iframe', 'https://styled.test/x', 'styled.test', null],
  ]);
});

test('a CSP <meta> counts only inside <head>; the last valid referrer <meta> anywhere sets the policy', () => {
  const record = page(`<head><meta http-equiv="content-security-policy" content="default-src 'self'"><meta name="referrer" content="Unsafe-URL"></head>
<body><meta name="referrer" content="strict-origin"><meta name="referrer" content="nonsense"></body>`, {
    headers: { 'content-type': 'text/html', 'strict-transport-security': 'max-age=60', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer' },
  });
  assert.deepEqual(record.security?.headers, {
    hsts_max_age: 60, nosniff: false, csp: 'meta', frame_ancestors: [], x_frame_options: ['deny'], referrer_policy: 'strict-origin',
  });
  assert.equal(security('<body><meta http-equiv="Content-Security-Policy" content="default-src none"></body>').headers.csp, null);
  assert.equal(security('<head><meta name="referrer" content="nonsense"><meta name="referrer" content="always"></head>').headers.referrer_policy, 'unsafe-url');
});

test('spam terms are counted on the text and external link URLs; topic words on the title, description and headings', () => {
  const filler = 'word '.repeat(5000);
  const found = security(`<head><title>Viagra price cut</title><meta name="description" content="Viagra news"></head>
<body><h1>Garden tools</h1><p>${filler}</p><div style="display:none">cheap VIAGRA</div>
<a href="https://shop.test/buy-cialis-now">shop</a><a href="/viagra-guide">internal</a><p>Слава</p></body>`);
  assert.deepEqual(found.spam_terms, { pharma: { count: 2, terms: ['viagra', 'cialis'] } }, 'the title and description are not counted');
  assert.deepEqual(found.topic_terms, { pharma: { count: 2, terms: ['viagra'] } });
  assert.equal(found.scripts.cyrillic, 5);
  assert.ok(found.scripts.latin > 20_000);
});

test('records without a document have empty signals, and a failed request has no headers', () => {
  const pdf = page('', { body: Buffer.from('%PDF-1.7'), headers: { 'content-type': 'application/pdf', 'x-content-type-options': 'nosniff' } });
  assert.deepEqual(pdf.security?.hidden_links, []);
  assert.deepEqual(pdf.security?.visible_hosts, []);
  assert.deepEqual(pdf.security?.spam_terms, {});
  assert.equal(pdf.security?.headers.nosniff, true);
  const failed = page('', { status: 0, error: { code: 'timeout', message: 'timeout' } });
  assert.equal(failed.security?.headers.nosniff, false);
});

test('a host the page also links to visibly is not kept as hidden, so a hidden copy of a menu cannot crowd out spam', () => {
  const brands = Array.from({ length: 250 }, (_, i) => `<a href="https://brand${i}.test/">Brand ${i}</a>`).join('');
  const found = security(`<body><nav class="drawer" style="display:none">${brands}</nav><section>${brands}</section>
<footer><div style="position:absolute;left:-9999px"><a href="https://cheap-pills.test/">pills</a></div></footer></body>`);
  assert.deepEqual(found.hidden_links.map((link) => link.host), ['cheap-pills.test']);
  assert.equal(found.visible_hosts.length, 250);
});

test('hidden hosts and embeds are capped; links to a host already recorded only add to its count', () => {
  const menu = Array.from({ length: 150 }, (_, i) => `<a href="https://menu${i % 3}.test/${i}">m</a>`).join('');
  const many = Array.from({ length: MAX_HIDDEN_HOSTS + 20 }, (_, i) => `<a href="https://h${i}.test/">x</a>`).join('');
  const found = security(`<body><div hidden>${menu}<a href="https://spam.test/">spam</a>${many}</div>${'<script src="https://c.test/a.js"></script>'.repeat(MAX_EMBEDS + 20)}</body>`);
  assert.equal(found.hidden_links.length, MAX_HIDDEN_HOSTS);
  assert.deepEqual(found.hidden_links.slice(0, 4).map((link) => [link.host, link.count]), [['menu0.test', 50], ['menu1.test', 50], ['menu2.test', 50], ['spam.test', 1]]);
  assert.equal(found.embeds.length, MAX_EMBEDS);
  assert.deepEqual(page(`<body><div hidden>${many}</div>${'<script src="https://c.test/a.js"></script>'.repeat(MAX_EMBEDS + 20)}</body>`).limits_reached,
    ['security.embeds', 'security.hidden_hosts'], 'the record says which caps the page reached');
});

test('padding a page past the 5,000 links of its record does not hide a hidden link from the scan (code review A3)', () => {
  const padding = Array.from({ length: 6000 }, (_, i) => `<a href="/p/${i}">p${i}</a>`).join('');
  const record = page(`<body>${padding}<div style="display:none"><a href="https://casino-spam.test/x">cheap pills</a></div>
<a href="https://visible.test/">v</a><a href="https://dot.test/">.</a></body>`);
  assert.equal(record.links.length, 5000);
  const hidden = /** @type {PageSecurity} */ (record.security).hidden_links;
  assert.deepEqual(hidden.map((link) => [link.host, link.index, link.text, link.how]), [
    ['casino-spam.test', 6000, 'cheap pills', 'display:none'], ['dot.test', 6002, '.', 'one-character link'],
  ]);
  assert.deepEqual(/** @type {PageSecurity} */ (record.security).visible_hosts, ['visible.test']);
  assert.deepEqual(record.limits_reached, ['links']);
  assert.equal(page('<body><a href="https://a.test/">a</a></body>').limits_reached, undefined, 'no cap reached, no field');
});

test('the scan caps hosts, not links: padding with other hosts fills the cap and says so', () => {
  const visible = Array.from({ length: MAX_TRACKED_HOSTS + 10 }, (_, i) => `<a href="https://v${i}.test/">v</a>`).join('');
  const spam = '<div style="display:none"><a href="https://casino-spam.test/x">pills</a></div>';
  const afterVisible = page(`<body>${visible}${spam}</body>`);
  assert.deepEqual(/** @type {PageSecurity} */ (afterVisible.security).hidden_links.map((link) => link.host), ['casino-spam.test'],
    'visible hosts use their own room');
  assert.equal(/** @type {PageSecurity} */ (afterVisible.security).visible_hosts.length, MAX_VISIBLE_HOSTS);
  assert.deepEqual(afterVisible.limits_reached, ['links', 'security.hosts', 'security.visible_hosts']);
  const hiddenPadding = Array.from({ length: MAX_TRACKED_HOSTS }, (_, i) => `<a href="https://h${i}.test/">h</a>`).join('');
  const afterHidden = page(`<body><div hidden>${hiddenPadding}</div>${spam}</body>`);
  assert.equal(/** @type {PageSecurity} */ (afterHidden.security).hidden_links.length, MAX_HIDDEN_HOSTS);
  assert.deepEqual(afterHidden.limits_reached, ['links', 'security.hidden_hosts', 'security.hosts'], 'a page padded past the cap is named');
});

test('a 5 MiB page of links to distinct hosts is scanned in seconds of CPU time', () => {
  const anchor = (/** @type {number} */ i) => `<div style="display:none"><a href="https://h${i}.test/">x</a></div>`;
  const parts = [];
  let size = 0;
  for (let i = 0; size < LIMITS.maxBodyBytes - 200; i += 1) {
    const part = anchor(i);
    parts.push(part);
    size += part.length;
  }
  const html = `<body>${parts.join('')}</body>`;
  assert.ok(html.length <= LIMITS.maxBodyBytes, 'within the body limit');
  const started = cpuMs();
  const record = page(html);
  const elapsed = cpuMs() - started;
  assert.ok(elapsed < 10_000, `took ${elapsed} ms of CPU time`);
  assert.ok(record.limits_reached?.includes('security.hosts'));
});

test('a large page full of hidden elements, styles and spam terms extracts in a few seconds of CPU time', () => {
  const chunk = '<button>Menu</button><div style="display:none;opacity:0;font-size:0;transform:translateX(-9999px)"><a href="https://s.test/a">cheap viagra online casino</a></div><p>Слово 日本語 text</p>';
  const html = `<body>${'<div>'.repeat(2000)}${chunk.repeat(Math.ceil(1_048_576 / chunk.length))}<div style="left:${'1'.repeat(40_000)}x; /* ${'/* '.repeat(20_000)}"></div></body>`;
  const started = cpuMs();
  const found = page(html).security;
  const elapsed = cpuMs() - started;
  assert.ok(elapsed < 10_000, `took ${elapsed} ms of CPU time`);
  assert.ok((found?.spam_terms.pharma?.count ?? 0) > 1000);
});
