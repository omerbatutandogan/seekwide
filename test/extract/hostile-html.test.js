// Pages built to be expensive: each limit has a case it stops and a case it leaves alone.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_PARSED_TAGS } from '../../plugin/server/src/extract/dom.js';
import { extractHtml } from '../../plugin/server/src/extract/html.js';
import { MAX_URL_LENGTH, normalizeUrl } from '../../plugin/server/src/util/url.js';

const CONTEXT = { responseUrl: 'https://example.test/', siteHost: 'example.test', includeSubdomains: false };

/** CPU time of this process in milliseconds; a busy machine does not change it. */
const cpuMs = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

test('a script of spaces does not make the Next.js data test slow', () => {
  // 200 KB of spaces took about 25 s of CPU with the old pattern.
  const streamed = '<title>T</title><meta name="description" content="D"><link rel="canonical" href="/x">';
  const html = `<html><head></head><body><h1>A</h1><script>${' '.repeat(200_000)}x</script>${streamed}</body></html>`;
  const started = cpuMs();
  const fields = extractHtml(html, CONTEXT);
  assert.ok(cpuMs() - started < 3000, `took ${cpuMs() - started} ms`);
  assert.equal(fields.canonicals[0].streamed, undefined, 'spaces are not a Next.js data script');
});

test('a Next.js data script is still recognized, with or without leading spaces or a parenthesis', () => {
  for (const script of ['self.__next_f.push([1,"a"])', '  (self.__next_f=self.__next_f||[]).push([0])', '\n ( self.__next_f = [])']) {
    const streamed = '<title>T</title><meta name="description" content="D"><link rel="canonical" href="/x">';
    const fields = extractHtml(`<html><head></head><body><h1>A</h1><script>${script}</script>${streamed}</body></html>`, CONTEXT);
    assert.equal(fields.canonicals[0].streamed, true, script);
  }
});

test('deeply nested formatting tags are parsed only up to the tag limit', () => {
  // 5 MiB of nested <b><p> took about 8 s of CPU and 2.3 GB of memory to parse whole.
  const unit = '<b><p>';
  const html = `<html><body>${unit.repeat(Math.ceil((5 * 1024 * 1024) / unit.length))}<a href="/late">late</a></body></html>`;
  const started = cpuMs();
  const fields = extractHtml(html, CONTEXT);
  assert.ok(cpuMs() - started < 6000, `took ${cpuMs() - started} ms`);
  assert.deepEqual(fields.links, [], 'a link after the limit is not read');
});

test('a page below the tag limit is read to its end', () => {
  const count = Math.floor(MAX_PARSED_TAGS / 2) - 10;
  const html = `<html><body>${'<i>x</i>'.repeat(count / 2)}<a href="/late">late</a></body></html>`;
  assert.deepEqual(extractHtml(html, CONTEXT).links.map((link) => link.url), ['https://example.test/late']);
});

test('a URL longer than the limit is unusable, one at the limit is kept', () => {
  const longest = `https://example.test/${'a'.repeat(MAX_URL_LENGTH - 'https://example.test/'.length)}`;
  assert.equal(normalizeUrl(longest), longest);
  assert.equal(normalizeUrl(`${longest}b`), null);
  assert.equal(normalizeUrl(`/${'a'.repeat(5 * 1024 * 1024)}`, 'https://example.test/'), null);
});

test('links, canonicals and hreflang with huge URLs are kept without the URL', () => {
  const huge = `/${'x'.repeat(1024 * 1024)}`;
  const html = `<html><head><link rel="canonical" href="${huge}"><link rel="alternate" hreflang="de" href="${huge}"></head>
    <body><a href="${huge}">huge</a><a href="/ok">ok</a><img src="${huge}"></body></html>`;
  const fields = extractHtml(html, CONTEXT);
  assert.equal(fields.canonicals[0].url, null);
  assert.equal(fields.hreflang[0].url, null);
  assert.deepEqual(fields.links.map((link) => link.url), [null, 'https://example.test/ok']);
  assert.equal(fields.images[0].url, null);
  assert.ok(JSON.stringify(fields).length < 10_000, 'nothing of the huge URL is stored beyond the clipped href');
});

test('the link, image and hreflang lists of one page hold at most a million characters in all', async () => {
  const { MAX_LIST_CHARS } = await import('../../plugin/server/src/extract/dom.js');
  // 5000 links with 2000-character URLs made one page record of 6 MB.
  const long = `/${'p'.repeat(2000)}`;
  const html = `<html><body>${Array.from({ length: 5000 }, (_, i) => `<a href="${long}${i}">x</a>`).join('')}</body></html>`;
  const fields = extractHtml(html, CONTEXT);
  assert.ok(fields.links.length < 5000);
  assert.ok(JSON.stringify(fields).length < MAX_LIST_CHARS * 1.6, `${JSON.stringify(fields).length} characters`);
  const ordinary = `<html><body>${Array.from({ length: 3000 }, (_, i) => `<a href="/p${i}">Page ${i}</a>`).join('')}</body></html>`;
  assert.equal(extractHtml(ordinary, CONTEXT).links.length, 3000);
});

test('a link keeps at most 20 rel tokens, which count toward the list budget', () => {
  const fields = extractHtml(`<html><body><a href="/a" rel="${'nofollow '.repeat(100_000)}">a</a><a href="/b" rel="nofollow noopener">b</a></body></html>`, CONTEXT);
  assert.equal(fields.links[0].rel.length, 20);
  assert.deepEqual(fields.links[1].rel, ['nofollow', 'noopener']);
});
