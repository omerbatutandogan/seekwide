// What the smo and aso modules read from a page (rule set 0.1.9).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { byteOffset, decodeBody } from '../../plugin/server/src/extract/decode.js';
import { extractHtml } from '../../plugin/server/src/extract/html.js';
import { parseJsonLd } from '../../plugin/server/src/extract/jsonld.js';
import { extractPage } from '../../plugin/server/src/extract/page.js';
import { MAX_APP_BANNERS, MAX_REL_ME } from '../../plugin/server/src/extract/social.js';
import { PAGE_URL, makeFetch, makeInput } from './fetch-result.js';

/** @param {string} html */
const social = (html) => extractHtml(html, { responseUrl: PAGE_URL, siteHost: 'example.test', includeSubdomains: false }).social;

test('Open Graph tags given only outside the head are listed, in a fixed order, with the line of the first', () => {
  const record = social([
    '<html><head><title>T</title><meta property="og:title" content="In head"></head>',
    '<body><meta property="og:title" content="Again in body">',
    '<meta property="og:url" content="https://example.test/page">',
    '<meta property="og:image:secure_url" content="https://example.test/a.png">',
    '<meta property="og:description" content=""></body></html>',
  ].join('\n'));
  assert.deepEqual(record.outside_head, [{ key: 'og:url', line: 3 }, { key: 'og:image', line: 4 }], 'og:title is in the head too; an empty one does not count');
  assert.equal(record.streamed, false);
});

test('metadata a Next.js App Router page streamed into the body is marked streamed', () => {
  const record = social('<html><head></head><body><script>self.__next_f.push([1,"x"])</script><title>T</title><meta property="og:title" content="A"></body></html>');
  assert.deepEqual(record.outside_head.map((entry) => entry.key), ['og:title']);
  assert.equal(record.streamed, true);
  assert.equal(social('<html><head><meta property="og:title" content="A"></head><body><script>self.__next_f.push([1])</script><title>T</title></body></html>').streamed, false, 'nothing outside the head');
});

test('the end of the head is counted in bytes of the response, multi-byte characters and a byte order mark included', () => {
  const head = `<html><head><title>${'é'.repeat(100)}</title></head><body>x</body></html>`;
  const plain = social(head);
  assert.equal(plain.head_end?.by, 'head');
  assert.equal(plain.head_end?.bytes, Buffer.byteLength(head.slice(0, head.indexOf('</head>') + 7), 'utf8'));
  const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(head, 'utf8')]);
  const record = extractPage(makeInput(makeFetch({ body }))).social;
  assert.equal(record?.head_end?.bytes, 3 + /** @type {number} */ (plain.head_end?.bytes));
});

test('a single-byte or legacy multi-byte encoding is counted in its own bytes', () => {
  const html = `<html><head><title>${'ü'.repeat(50)}</title></head><body></body></html>`;
  const latin1 = Buffer.from(html, 'latin1');
  const record = extractPage(makeInput(makeFetch({ body: latin1, headers: { 'content-type': 'text/html; charset=windows-1252' } }))).social;
  assert.equal(record?.head_end?.bytes, html.indexOf('</head>') + 7, 'one byte per character');
  // Shift_JIS: two bytes per kana. Built by hand: 'あ' is 0x82 0xa0.
  const prefix = Buffer.from('<html><head><title>', 'ascii');
  const rest = Buffer.from('</title></head><body></body></html>', 'ascii');
  const sjis = Buffer.concat([prefix, Buffer.from(new Array(20).fill([0x82, 0xa0]).flat()), rest]);
  const decoded = decodeBody(sjis, 'text/html; charset=shift_jis');
  assert.equal(decoded.encoding, 'shift_jis');
  const chars = decoded.text.indexOf('</head>') + 7;
  assert.equal(byteOffset(sjis, decoded.encoding, decoded.text, chars), prefix.length + 40 + '</title></head>'.length);
  assert.equal(byteOffset(sjis, decoded.encoding, decoded.text, 0), 0);
});

test('without a place for the head, the end of the last og: tag is used; with neither, nothing', () => {
  const ogOnly = extractHtml('<meta property="og:title" content="A"><p>x</p>', { responseUrl: PAGE_URL, siteHost: 'example.test', includeSubdomains: false, byteOffset: (chars) => chars * 2 });
  // parse5 records a place for an implied head only when a tag opened it; here the meta opened the head itself.
  assert.ok(ogOnly.social.head_end !== null);
  const none = extractHtml('', { responseUrl: PAGE_URL, siteHost: 'example.test', includeSubdomains: false });
  assert.equal(none.social.head_end, null);
});

test('Smart App Banner tags are kept with their place, at most five', () => {
  const record = social([
    '<html><head><meta name="apple-itunes-app" content="app-id=123456789, app-argument=https://example.test/x"></head>',
    `<body>${'<meta name="apple-itunes-app" content="app-id=1">'.repeat(6)}</body></html>`,
  ].join('\n'));
  assert.equal(record.app_banners.length, MAX_APP_BANNERS);
  assert.deepEqual(record.app_banners[0], { content: 'app-id=123456789, app-argument=https://example.test/x', in_head: true, line: 1 });
  assert.equal(record.app_banners[1].in_head, false);
  assert.deepEqual(record.outside_head, [], 'the banner is in the head as well');
  assert.deepEqual(social('<html><head></head><body><meta name="apple-itunes-app" content="app-id=1"></body></html>').outside_head.map((e) => e.key), ['apple-itunes-app']);
});

test('rel="me" links of <a> and <link> are kept once each, resolved, at most fifty', () => {
  const record = social([
    '<html><head><link rel="me" href="https://mastodon.social/@acme"><link rel="stylesheet me" href="/x.css"></head><body>',
    '<a rel="me noopener" href="https://mastodon.social/@acme">M</a><a rel="ME" href="https://fosstodon.org/@acme">F</a><a rel="nofollow" href="https://x.example/@no">N</a>',
    ...Array.from({ length: 60 }, (_, i) => `<a rel="me" href="https://h${i}.example/@a">x</a>`),
    '</body></html>',
  ].join(''));
  assert.equal(record.rel_me.length, MAX_REL_ME);
  assert.deepEqual(record.rel_me.slice(0, 3), ['https://mastodon.social/@acme', 'https://example.test/x.css', 'https://fosstodon.org/@acme']);
});

test('a page without these tags has an empty record, and a non-HTML response has one too', () => {
  const record = social('<html><head><title>T</title></head><body>x</body></html>');
  assert.deepEqual({ ...record, head_end: null }, { outside_head: [], streamed: false, head_end: null, app_banners: [], rel_me: [] });
  const pdf = extractPage(makeInput(makeFetch({ body: Buffer.from('%PDF'), headers: { 'content-type': 'application/pdf' } })));
  assert.deepEqual(pdf.social, { outside_head: [], streamed: false, head_end: null, app_banners: [], rel_me: [] });
});

test('JSON-LD: Organization, business and Person entities at the top level and in @graph, with their sameAs count', () => {
  const block = parseJsonLd(JSON.stringify({
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', name: 'Acme', sameAs: ['https://x.com/acme', '', 'https://www.linkedin.com/company/acme'] },
      { '@type': 'WebSite', publisher: { '@type': 'Organization', sameAs: 'https://nested.example' } },
      { '@type': ['Thing', 'Restaurant'], sameAs: 'https://www.instagram.com/acme' },
      { '@type': 'NewsMediaOrganization' },
      { '@type': 'Article', author: { '@type': 'Person', name: 'Writer' } },
    ],
  }), 1);
  assert.deepEqual(block.profiles, [
    { type: 'Organization', same_as: 2 }, { type: 'Restaurant', same_as: 1 }, { type: 'NewsMediaOrganization', same_as: 0 },
  ], 'a nested publisher or author is someone else and is not read');
  assert.deepEqual(parseJsonLd('[{"@type":"Person","sameAs":"https://mastodon.social/@me"},{"@type":"LocalBusiness"}]', 1).profiles, [
    { type: 'Person', same_as: 1 }, { type: 'LocalBusiness', same_as: 0 },
  ]);
  assert.deepEqual(parseJsonLd('{', 1).profiles, []);
});
