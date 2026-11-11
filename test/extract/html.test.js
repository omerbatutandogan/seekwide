import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractPage } from '../../server/src/extract/page.js';
import { makeFetch, makeInput } from './fetch-result.js';

/**
 * Extract a record from an HTML string served at `url`.
 * @param {string} html
 * @param {{url?: string, siteHost?: string, includeSubdomains?: boolean}} [options]
 */
function page(html, options = {}) {
  const result = makeFetch({ html, url: options.url });
  return extractPage(makeInput(result, options));
}

test('titles: SVG titles are ignored, a title in <body> is still recorded', () => {
  const record = page(`<!doctype html><html><head><title>  Main
    title </title></head><body><svg><title>Icon</title></svg><title>Body title</title><title></title></body></html>`);
  assert.deepEqual(record.titles, ['Main title', 'Body title', '']);
  assert.deepEqual(page('<html><body><svg><title>Only icon</title></svg></body></html>').titles, []);
});

test('meta descriptions, viewport, html lang, Open Graph and Twitter fields', () => {
  const record = page(`<html lang=" tr "><head>
    <meta name="Description" content="  First
      description ">
    <meta name="description" content="Second">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta property="og:title" content="OG one"><meta property="og:title" content="OG two">
    <meta property="OG:Image" content="https://example.test/i.png">
    <meta name="twitter:card" content="summary"></head><body></body></html>`);
  assert.equal(record.html_lang, 'tr');
  assert.deepEqual(record.meta_descriptions, ['First description', 'Second']);
  assert.equal(record.viewport, 'width=device-width, initial-scale=1');
  assert.deepEqual(record.og, { title: 'OG one', image: 'https://example.test/i.png' });
  assert.deepEqual(record.twitter, { card: 'summary' });
  const bare = page('<html lang=""><head></head><body></body></html>');
  assert.equal(bare.html_lang, null);
  assert.equal(bare.viewport, null);
  assert.deepEqual(bare.meta_descriptions, []);
});

test('meta robots and googlebot meta are read in any letter case; other agents are not', () => {
  const record = page(`<head><META NAME="ROBOTS" CONTENT="NoIndex, NoFollow">
    <meta name="GoogleBot" content="noarchive"><meta name="bingbot" content="noimageindex"></head>`);
  assert.deepEqual(record.meta_robots, ['noindex', 'nofollow', 'noarchive']);
  assert.deepEqual(page('<head><meta name="robots" content="index, follow"></head>').meta_robots, ['index', 'follow']);
});

test('<base href> changes how relative links, images and canonicals resolve', () => {
  const html = `<head><base href="https://example.test/docs/"><link rel="canonical" href="intro"></head>
    <body><a href="guide">Guide</a><a href="/root">Root</a><img src="pic.png" alt="p"></body>`;
  const record = page(html);
  assert.equal(record.canonicals[0].url, 'https://example.test/docs/intro');
  assert.deepEqual(record.links.map((l) => l.url), ['https://example.test/docs/guide', 'https://example.test/root']);
  assert.equal(record.images[0].url, 'https://example.test/docs/pic.png');
  const without = page(html.replace('<base href="https://example.test/docs/">', ''));
  assert.equal(without.canonicals[0].url, 'https://example.test/intro');
  assert.equal(without.links[0].url, 'https://example.test/guide');
});

test('a <base> that is relative resolves against the page; a javascript: base is ignored', () => {
  assert.equal(page('<head><base href="/sub/"></head><body><a href="x">x</a></body>').links[0].url, 'https://example.test/sub/x');
  assert.equal(page('<head><base href="javascript:alert(1)"></head><body><a href="x">x</a></body>').links[0].url, 'https://example.test/x');
});

test('canonicals: in <head> versus in <body>, several of them, raw href kept', () => {
  const record = page(`<html><head><link rel="canonical" href="/a"><link rel="Canonical Alternate" href="https://example.test/b">
    </head><body><link rel="canonical" href="/c"><link rel="canonical" href="javascript:void(0)"></body></html>`);
  assert.deepEqual(record.canonicals.map((c) => [c.href, c.url, c.in_head, c.source]), [
    ['/a', 'https://example.test/a', true, 'html'],
    ['https://example.test/b', 'https://example.test/b', true, 'html'],
    ['/c', 'https://example.test/c', false, 'html'],
    ['javascript:void(0)', null, false, 'html'],
  ]);
  assert.deepEqual(page('<head><link rel="stylesheet" href="/s.css"></head>').canonicals, []);
});

test('a canonical after an element that closes <head> is outside <head>', () => {
  const record = page('<html><head><title>x</title><div>oops</div><link rel="canonical" href="/a"></head><body></body></html>');
  assert.equal(record.canonicals[0].in_head, false);
});

test('hreflang alternates from link elements', () => {
  const record = page('<head><link rel="alternate" hreflang="tr" href="/tr/"><link rel="alternate" href="/feed"></head>');
  assert.deepEqual(record.hreflang, [{ hreflang: 'tr', href: '/tr/', url: 'https://example.test/tr/', source: 'html' }]);
});

test('anchors: missing, empty, javascript:, mailto: and fragment-only hrefs', () => {
  const record = page(`<body>
<a>No href</a>
<a href="">Empty</a>
<a href="JavaScript:void(0)" onclick="go()">JS</a>
<a href="mailto:a@example.test">Mail</a>
<a href="#top">Top</a>
</body>`);
  assert.deepEqual(record.links.map((l) => [l.href, l.url, l.internal, l.has_onclick]), [
    ['', null, false, false],
    ['', null, false, false],
    ['JavaScript:void(0)', null, false, true],
    ['mailto:a@example.test', null, false, false],
    ['#top', 'https://example.test/page', true, false],
  ]);
});

test('anchors: image alt becomes text, aria-label and rel tokens are recorded', () => {
  const record = page(`<body><a href="/home"><img src="logo.png" alt="Home page"></a>
    <a href="/x" aria-label="  Close dialog "><svg></svg></a>
    <a href="/y" rel="NoFollow  UGC">Read <b>more</b>
      now</a><a href="/z" aria-label="   "><img src="i.png"></a></body>`);
  assert.deepEqual(record.links.map((l) => [l.text, l.aria_label, l.rel]), [
    ['Home page', null, []],
    ['', 'Close dialog', []],
    ['Read more now', null, ['nofollow', 'ugc']],
    ['', null, []],
  ]);
});

test('anchors: the aria-label of a contained element is the link text; an unlabelled icon leaves it empty', () => {
  const record = page(`<body><a href="/"><svg role="img" aria-label="Brand Name" viewBox="0 0 1 1"><path d="M0 0"></path></svg></a>
    <a href="/menu"><i class="icon" aria-label=" Menu "></i></a>
    <a href="/t"><svg><title>Pricing</title><path d="M0 0"></path></svg></a>
    <a href="/both"><span aria-label="Docs">hidden words</span> for you</a>
    <a href="/none"><svg viewBox="0 0 1 1"><path d="M0 0"></path></svg></a>
    <a href="/blank"><svg aria-label="   "></svg></a></body>`);
  assert.deepEqual(record.links.map((l) => [l.text, l.aria_label]), [
    ['Brand Name', null],
    ['Menu', null],
    ['Pricing', null],
    ['Docs for you', null],
    ['', null],
    ['', null],
  ]);
});

test('anchors: labels on images, hidden elements and non-text elements; headings do not read labels', () => {
  const record = page(`<body><a href="/a"><img src="l.png" aria-label="Brand"></a>
    <a href="/b"><img src="l.png" alt="Logo" aria-label="Brand"></a>
    <a href="/c"><svg aria-hidden="true" aria-label="Ghost"></svg></a>
    <a href="/d"><script aria-label="No">x()</script><style aria-label="No">a{}</style></a>
    <a href="/e"><span aria-label="   ">words</span></a>
    <a href="/f"><img src="l.png" alt="Logo"></a>
    <h1><a href="/" aria-label="Go to homepage">Acme</a></h1><h2><div aria-label="Welcome"></div></h2></body>`);
  assert.deepEqual(record.links.slice(0, 6).map((l) => l.text), ['Brand', 'Brand', '', '', 'words', 'Logo']);
  assert.deepEqual(record.headings.map((h) => h.text), ['Acme', '']);
});

test('anchors: internal versus external, subdomains with and without includeSubdomains', () => {
  const html = `<body><a href="https://www.example.test/a">www</a><a href="https://blog.example.test/b">sub</a>
    <a href="https://other.test/c">other</a><a href="https://notexample.test/d">lookalike</a></body>`;
  assert.deepEqual(page(html).links.map((l) => l.internal), [true, false, false, false]);
  assert.deepEqual(page(html, { includeSubdomains: true }).links.map((l) => l.internal), [true, true, false, false]);
});

test('anchors: title attribute is trimmed and clipped; null when missing, empty or blank', () => {
  const long = 'b'.repeat(400);
  const record = page(`<body><a href="/a" title="  Pricing plans  "><svg></svg></a><a href="/b" title="">b</a>
    <a href="/c" title="   ">c</a><a href="/d">d</a><a href="/e" title="${long}">e</a></body>`);
  assert.deepEqual(record.links.slice(0, 4).map((l) => l.title_attr), ['Pricing plans', null, null, null]);
  assert.equal(record.links[4].title_attr?.length, 300);
  assert.equal(record.links[4].title_attr?.endsWith('…'), true);
});

test('anchors: tracking parameters are removed from the normalized URL, raw href is kept', () => {
  const [link] = page('<body><a href="/p?utm_source=x&id=2#frag">p</a></body>').links;
  assert.equal(link.href, '/p?utm_source=x&id=2#frag');
  assert.equal(link.url, 'https://example.test/p?id=2');
});

test('images: missing alt is null, empty alt is kept, srcset on img and on <picture> source', () => {
  const record = page(`<body><img src="/a.png"><img src="/b.png" alt="" width="10" height="20" loading="lazy">
    <img src="/c.png" alt="C" srcset="/c2.png 2x"><picture><source srcset="/d.webp" type="image/webp"><img src="/d.png" alt="D"></picture>
    <picture><source media="(min-width: 1px)"><img alt="E"></picture></body>`);
  assert.deepEqual(record.images.map((i) => [i.src, i.alt, i.has_srcset]), [
    ['/a.png', null, false],
    ['/b.png', '', false],
    ['/c.png', 'C', true],
    ['/d.png', 'D', true],
    ['', 'E', false],
  ]);
  assert.deepEqual([record.images[1].width, record.images[1].height, record.images[1].loading], ['10', '20', 'lazy']);
  assert.equal(record.images[4].url, null);
});

const MIXED_HTML = `<head><link rel="stylesheet" href="http://cdn.test/s.css"><link rel="icon" href="http://cdn.test/i.ico">
  <script src="http://cdn.test/s.js"></script></head><body>
  <img src="http://cdn.test/i.png"><img src="https://cdn.test/ok.png"><iframe src="http://cdn.test/f"></iframe>
  <video src="http://cdn.test/v.mp4"><source src="http://cdn.test/v.webm"></video><audio src="http://cdn.test/a.mp3"></audio>
  <embed src="http://cdn.test/e.swf"><object data="http://cdn.test/o.pdf"></object><img src="http://cdn.test/i.png">
  <a href="http://cdn.test/link">not a subresource</a></body>`;

test('mixed content: http subresources on an https page, once each', () => {
  assert.deepEqual(page(MIXED_HTML).mixed_content, [
    'http://cdn.test/s.css', 'http://cdn.test/s.js', 'http://cdn.test/i.png', 'http://cdn.test/f',
    'http://cdn.test/v.mp4', 'http://cdn.test/v.webm', 'http://cdn.test/a.mp3', 'http://cdn.test/e.swf', 'http://cdn.test/o.pdf',
  ]);
});

test('mixed content: none on an http page, and a relative URL under an http <base> counts', () => {
  assert.deepEqual(page(MIXED_HTML, { url: 'http://example.test/page' }).mixed_content, []);
  assert.deepEqual(page('<head><base href="http://example.test/"></head><body><img src="x.png"></body>').mixed_content, ['http://example.test/x.png']);
  assert.deepEqual(page('<body><img src="/x.png"></body>').mixed_content, []);
});

test('mixed content is capped at 20 URLs', () => {
  const imgs = Array.from({ length: 30 }, (_, i) => `<img src="http://cdn.test/${i}.png">`).join('');
  assert.equal(page(`<body>${imgs}</body>`).mixed_content.length, 20);
});

test('JSON-LD: object, array, @graph, @type arrays, invalid and empty scripts', () => {
  const record = page(`<head>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization"}</script>
<script type="application/ld+json">[{"@type":"WebSite"},{"@type":["Product","Thing"]}]</script>
<script type="Application/LD+JSON; charset=utf-8">{"@graph":[{"@type":"BreadcrumbList"},{"@type":"Organization"}]}</script>
<script type="application/ld+json">{"@type": "Broken",}</script>
<script type="application/ld+json">   </script>
<script type="text/javascript">var x = {"@type": "NotJsonLd"};</script>
</head>`);
  assert.equal(record.jsonld.length, 5);
  assert.deepEqual(record.jsonld.map((b) => [b.valid, b.types, b.line]), [
    [true, ['Organization'], 2],
    [true, ['WebSite', 'Product', 'Thing'], 3],
    [true, ['BreadcrumbList', 'Organization'], 4],
    [false, [], 5],
    [false, [], 6],
  ]);
  assert.equal(record.jsonld[0].error, null);
  assert.equal(typeof record.jsonld[3].error, 'string');
  assert.equal(record.jsonld[4].error, 'Empty JSON-LD script');
});

test('headings: levels, text with image alt, line numbers', () => {
  const record = page('<body>\n<h1>Main <img alt="logo"></h1>\n<h3>  Sub\n heading </h3>\n<svg><h2>no</h2></svg></body>');
  assert.deepEqual(record.headings.slice(0, 2), [
    { level: 1, text: 'Main logo', line: 2 },
    { level: 3, text: 'Sub heading', line: 3 },
  ]);
});

test('line numbers are 1-based lines of the decoded source', () => {
  const record = page('<!doctype html>\n<html>\n<head>\n<title>T</title>\n<link rel="canonical" href="/c">\n</head>\n<body>\n<a href="/x">x</a>\n<img src="/i.png">\n</body></html>');
  assert.equal(record.canonicals[0].line, 5);
  assert.equal(record.links[0].line, 8);
  assert.equal(record.images[0].line, 9);
});

test('visible text excludes script, style, noscript, template, svg and <head>', () => {
  const record = page(`<html><head><title>Head words</title></head><body>
    <p>Bir iki</p><script>var hidden = 1;</script><style>.x{}</style><noscript>No script</noscript>
    <template><p>Template text</p></template><svg><text>Svg text</text></svg><div>üç</div></body></html>`);
  assert.equal(record.text_excerpt, 'Bir iki üç');
  assert.equal(record.word_count, 3);
});

test('word count is right for Turkish text and block elements separate words', () => {
  const record = page("<body><p>Çağrı İstanbul'da yaşıyor; ışık, öğün 2026.</p><p>Son</p><div>söz</div>Ad<b>ım</b></body>");
  assert.equal(record.word_count, 10);
  assert.equal(record.text_excerpt, "Çağrı İstanbul'da yaşıyor; ışık, öğün 2026. Son söz Adım");
  assert.equal(page('<body>नमस्ते दुनिया</body>').word_count, 2);
});

test('text_hash ignores whitespace and letter case but not wording', () => {
  const a = page('<body><p>Hello   World</p>\n\n<p>Şehir</p></body>');
  const b = page('<body>\n<p>  HELLO world </p><p>şehir</p></body>');
  const c = page('<body><p>Hello World</p><p>Köy</p></body>');
  assert.equal(a.text_hash, b.text_hash);
  assert.match(a.text_hash, /^[0-9a-f]{40}$/);
  assert.notEqual(a.text_hash, c.text_hash);
  assert.equal(page('<body>  <script>x</script> </body>').text_hash, '');
});

test('clipping: titles and descriptions at 1000 characters, other strings at 300, excerpt at 2000', () => {
  const long = 'a'.repeat(1500);
  const record = page(`<head><title>${long}</title><meta name="description" content="${long}"></head>
    <body><h1>${long}</h1><a href="/x" aria-label="${long}">${long}</a><img src="/i" alt="${long}"><p>${'word '.repeat(1000)}</p></body>`);
  assert.equal(record.titles[0].length, 1000);
  assert.equal(record.titles[0].endsWith('…'), true);
  assert.equal(record.meta_descriptions[0].length, 1000);
  assert.equal(record.headings[0].text.length, 300);
  assert.equal(record.links[0].text.length, 300);
  assert.equal(record.links[0].aria_label?.length, 300);
  assert.equal(record.images[0].alt?.length, 300);
  assert.equal(record.text_excerpt.length, 2000);
  const short = page('<head><title>Short</title></head>');
  assert.deepEqual(short.titles, ['Short']);
});

test('at most 5000 links and 2000 images are kept', () => {
  const links = '<a href="/l">l</a>'.repeat(5100);
  const images = '<img src="/i.png" alt="i">'.repeat(2100);
  const record = page(`<body>${links}${images}</body>`);
  assert.equal(record.links.length, 5000);
  assert.equal(record.images.length, 2000);
  const small = page(`<body>${'<a href="/l">l</a>'.repeat(10)}</body>`);
  assert.equal(small.links.length, 10);
});

test('nested headings extract in linear time (n = 8000 in well under a second)', () => {
  const html = `<body>${'<h2><div>x'.repeat(8000)}</body>`;
  const started = performance.now();
  const record = page(html);
  const elapsed = performance.now() - started;
  assert.equal(record.headings.length, 500);
  assert.equal(record.headings[0].text.length, 300);
  assert.ok(elapsed < 1000, `took ${Math.round(elapsed)} ms`);
  const empty = `<body>${'<h2><div>'.repeat(8000)}</body>`;
  const startedEmpty = performance.now();
  page(empty);
  assert.ok(performance.now() - startedEmpty < 1000);
});

test('a heading reads a bounded part of a large subtree', () => {
  // 500 nested headings around 60,000 text elements: reading every subtree whole would visit 30 million nodes.
  const html = `<body>${'<h2><div>'.repeat(500)}${'<span>word </span>'.repeat(60000)}</body>`;
  const started = performance.now();
  const record = page(html);
  const elapsed = performance.now() - started;
  assert.equal(record.headings.length, 500);
  assert.equal(record.headings[499].text.length, 300);
  assert.ok(elapsed < 1000, `took ${Math.round(elapsed)} ms`);
});

test('bounded text collection still reads the whole text of an indented card link', () => {
  const indent = `\n${' '.repeat(60)}`;
  const nested = Array.from({ length: 40 }, () => `${indent}<div>`).join('');
  const record = page(`<body><a href="/card">${nested}${indent}<img alt="Photo">${indent}<h3>Card title</h3>${indent}<p>Short summary</p>${'</div>'.repeat(40)}</a></body>`);
  assert.equal(record.links[0].text, 'Photo Card title Short summary');
  const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
  assert.equal(page(`<body><h1>${words}</h1></body>`).headings[0].text.length, 300);
});

test('per-page caps keep the first entries in document order', () => {
  const repeat = (/** @type {string} */ s, /** @type {number} */ n) => Array.from({ length: n }, (_, i) => s.replaceAll('#', String(i))).join('');
  const record = page(`<head>${repeat('<title>T#</title>', 25)}${repeat('<meta name="description" content="D#">', 25)}
    ${repeat('<link rel="canonical" href="/c#">', 25)}${repeat('<link rel="alternate" hreflang="x-#" href="/h#">', 510)}
    <meta name="robots" content="${repeat('t#,', 60)}">
    ${repeat('<script type="application/ld+json">{"@type":"T#"}</script>', 110)}</head>
    <body>${repeat('<h2>H#</h2>', 510)}</body>`);
  assert.equal(record.titles.length, 20);
  assert.equal(record.titles[19], 'T19');
  assert.equal(record.meta_descriptions.length, 20);
  assert.equal(record.meta_descriptions[0], 'D0');
  assert.equal(record.canonicals.length, 20);
  assert.equal(record.canonicals[19].href, '/c19');
  assert.equal(record.hreflang.length, 500);
  assert.equal(record.meta_robots.length, 50);
  assert.equal(record.meta_robots[49], 't49');
  assert.equal(record.jsonld.length, 100);
  assert.equal(record.headings.length, 500);
  assert.equal(record.headings[499].text, 'H499');
  const under = page(`<head>${repeat('<title>T#</title>', 3)}</head><body>${repeat('<h2>H#</h2>', 3)}</body>`);
  assert.equal(under.titles.length, 3);
  assert.equal(under.headings.length, 3);
});

test('canonicals and hreflang from HTML and Link headers share one cap', () => {
  const html = `<head>${Array.from({ length: 19 }, (_, i) => `<link rel="canonical" href="/c${i}">`).join('')}</head>`;
  const lines = ['<https://example.test/h1>; rel="canonical"', '<https://example.test/h2>; rel="canonical"'];
  const record = extractPage(makeInput(makeFetch({ html, headerLines: { link: lines } })));
  assert.equal(record.canonicals.length, 20);
  assert.deepEqual(record.canonicals.slice(-2).map((c) => [c.source, c.href]), [['html', '/c18'], ['header', 'https://example.test/h1']]);
});

test('mixed content is empty when the page upgrades insecure requests', () => {
  const html = '<body><img src="http://cdn.test/i.png"></body>';
  const csp = (/** @type {string[]} */ lines) => extractPage(makeInput(makeFetch({ html, headerLines: { 'content-security-policy': lines } })));
  assert.deepEqual(csp(['upgrade-insecure-requests']).mixed_content, []);
  assert.deepEqual(csp(["default-src 'self'; Upgrade-Insecure-Requests"]).mixed_content, []);
  assert.deepEqual(csp(["default-src 'self'", 'upgrade-insecure-requests']).mixed_content, []);
  assert.deepEqual(csp(["default-src https:; block-all-mixed-content"]).mixed_content, ['http://cdn.test/i.png']);
  const meta = page('<head><meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests"></head><body><img src="http://cdn.test/i.png"></body>');
  assert.deepEqual(meta.mixed_content, []);
  // A CSP meta outside <head> is ignored by browsers.
  const inBody = page('<head></head><body><meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests"><img src="http://cdn.test/i.png"></body>');
  assert.deepEqual(inBody.mixed_content, ['http://cdn.test/i.png']);
  // Report-only policies change nothing.
  const reportOnly = extractPage(makeInput(makeFetch({ html, headerLines: { 'content-security-policy-report-only': ['upgrade-insecure-requests'] } })));
  assert.deepEqual(reportOnly.mixed_content, ['http://cdn.test/i.png']);
});
