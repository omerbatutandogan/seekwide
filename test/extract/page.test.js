import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractPage, redirectRecord, unreadableRecord } from '../../server/src/extract/page.js';
import { makePage } from '../helpers/factories.js';
import { PAGE_URL, makeFetch, makeInput } from './fetch-result.js';

/**
 * CPU time this process has used, in milliseconds. The speed limits below use it
 * instead of the wall clock, so a busy machine does not fail them.
 */
const cpuMs = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

const FINAL_HTML = '<!doctype html><html lang="en"><head><title>Final</title></head><body><p>Final page body</p></body></html>';

const HOPS = [
  { url: 'https://example.test/old', status: 301, location: 'https://example.test/middle' },
  { url: 'https://example.test/middle', status: 302, location: 'https://example.test/new' },
];

/**
 * @param {Partial<Parameters<typeof redirectRecord>[0]>} [overrides]
 */
function redirect(overrides = {}) {
  return redirectRecord({
    url: 'https://example.test/old',
    hops: HOPS,
    finalUrl: 'https://example.test/new',
    finalStatus: 200,
    finalExternal: false,
    fetchError: null,
    depth: 2,
    discoveredVia: ['link'],
    ...overrides,
  });
}

test('extractPage: a plain 200 HTML response gives one complete, indexable record', () => {
  const record = extractPage(makeInput(makeFetch({ html: FINAL_HTML })));
  assert.equal(record.url, PAGE_URL);
  assert.equal(record.final_url, PAGE_URL);
  assert.equal(record.status, 200);
  assert.equal(record.final_status, 200);
  assert.equal(record.final_external, false);
  assert.deepEqual(record.redirect_chain, []);
  assert.equal(record.depth, 1);
  assert.deepEqual(record.discovered_via, ['link']);
  assert.equal(record.content_type, 'text/html');
  assert.deepEqual(record.headers, { 'content-type': 'text/html; charset=utf-8' });
  assert.equal(record.is_html, true);
  assert.equal(record.bytes, Buffer.byteLength(FINAL_HTML));
  assert.equal(record.fetch_ms, 12);
  assert.equal(record.fetch_error, null);
  assert.deepEqual(record.titles, ['Final']);
  assert.deepEqual(record.indexability, { indexable: true, reasons: [] });
});

test('extractPage: the record URL is normalized', () => {
  const record = extractPage(makeInput(makeFetch(), { url: 'HTTPS://Example.test/page?utm_source=x#top' }));
  assert.equal(record.url, PAGE_URL);
});

test('extractPage: relative URLs resolve against the response URL', () => {
  const result = makeFetch({ url: 'https://example.test/dir/new', body: Buffer.from('<a href="next">n</a>') });
  assert.equal(extractPage(makeInput(result)).links[0].url, 'https://example.test/dir/next');
});

test('extractPage: a port in siteHost makes the same host on another port external', () => {
  const result = makeFetch({ url: 'http://example.test:8080/', html: '<a href="/a">a</a><a href="http://example.test/b">b</a>' });
  const record = extractPage(makeInput(result, { siteHost: 'example.test:8080' }));
  assert.deepEqual(record.links.map((l) => l.internal), [true, false]);
});

test('extractPage: a failed request gives status 0, fetch_error and no content', () => {
  const result = makeFetch({ status: 0, body: null, headers: {}, bytes: 0, error: { code: 'dns_error', message: 'ENOTFOUND' } });
  const record = extractPage(makeInput(result));
  assert.equal(record.status, 0);
  assert.equal(record.final_status, 0);
  assert.equal(record.fetch_error, 'dns_error');
  assert.equal(record.is_html, false);
  assert.equal(record.content_type, null);
  assert.deepEqual(record.indexability, { indexable: false, reasons: ['fetch_error'] });
});

test('extractPage: a body that failed part-way is never read as a response', () => {
  // Even if a caller passes the status and partial body of a timed-out response.
  const result = makeFetch({
    status: 200,
    html: '<html><head><title>Partial',
    headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex', link: '<https://example.test/c>; rel="canonical"' },
    headerLines: { 'x-robots-tag': ['noindex'], link: ['<https://example.test/c>; rel="canonical"'] },
    error: { code: 'timeout', message: 'body timed out' },
  });
  const record = extractPage(makeInput(result));
  assert.equal(record.status, 0);
  assert.equal(record.final_status, 0);
  assert.equal(record.fetch_error, 'timeout');
  assert.equal(record.is_html, false);
  assert.equal(record.bytes, 0);
  assert.deepEqual(record.headers, {});
  assert.deepEqual(record.titles, []);
  assert.equal(record.viewport, null);
  assert.equal(record.html_lang, null);
  assert.deepEqual(record.x_robots, []);
  assert.deepEqual(record.canonicals, []);
  assert.deepEqual(record.indexability, { indexable: false, reasons: ['fetch_error'] });
});

test('extractPage: a 3xx answer read on its own is a response with that status', () => {
  const result = makeFetch({ status: 301, body: Buffer.from(''), headers: { location: '/new' } });
  const record = extractPage(makeInput(result));
  assert.equal(record.status, 301);
  assert.deepEqual(record.redirect_chain, []);
  assert.deepEqual(record.headers, { location: '/new' });
  assert.deepEqual(record.indexability.reasons, ['status_301', 'not_html']);
});

test('redirectRecord: chain, final URL and status, no content', () => {
  const record = redirect();
  assert.equal(record.url, 'https://example.test/old');
  assert.equal(record.status, 301);
  assert.equal(record.final_url, 'https://example.test/new');
  assert.equal(record.final_status, 200);
  assert.equal(record.final_external, false);
  assert.deepEqual(record.redirect_chain, HOPS);
  assert.notEqual(record.redirect_chain, HOPS);
  assert.equal(record.depth, 2);
  assert.deepEqual(record.discovered_via, ['link']);
  assert.equal(record.content_type, null);
  assert.deepEqual(record.headers, {});
  assert.equal(record.is_html, false);
  assert.equal(record.fetch_error, null);
  assert.deepEqual(record.titles, []);
  assert.deepEqual(record.links, []);
  assert.equal(record.text_hash, '');
  assert.deepEqual(record.indexability, { indexable: false, reasons: ['redirect'] });
});

test('redirectRecord: a chain that leaves the site', () => {
  const record = redirect({ finalUrl: 'https://other.test/x?utm_source=a', finalStatus: 0, finalExternal: true });
  assert.equal(record.final_url, 'https://other.test/x');
  assert.equal(record.final_status, 0);
  assert.equal(record.final_external, true);
  assert.equal(record.fetch_error, null);
  assert.deepEqual(record.indexability.reasons, ['redirect']);
});

test('redirectRecord: a chain that did not end in a response carries the error first', () => {
  for (const fetchError of ['robots_disallowed', 'redirect_loop', 'too_many_redirects', 'invalid_url', 'timeout', 'bot_challenge']) {
    const record = redirect({ finalStatus: 0, fetchError });
    assert.equal(record.fetch_error, fetchError);
    assert.equal(record.final_status, 0);
    assert.deepEqual(record.indexability, { indexable: false, reasons: ['fetch_error', 'redirect'] });
  }
});

test('redirectRecord: an invalid final URL is kept as given; no hops is a TypeError', () => {
  assert.equal(redirect({ finalUrl: 'ftp://example.test/f', finalStatus: 0, fetchError: 'invalid_url' }).final_url, 'ftp://example.test/f');
  assert.throws(() => redirect({ hops: [] }), TypeError);
});

test('unreadableRecord: status kept, no content, only the fetch_error reason', () => {
  const record = unreadableRecord({ url: PAGE_URL, status: 403, fetchError: 'bot_challenge', depth: 0, discoveredVia: ['start'] });
  assert.equal(record.url, PAGE_URL);
  assert.equal(record.status, 403);
  assert.equal(record.final_url, PAGE_URL);
  assert.equal(record.final_status, 403);
  assert.equal(record.final_external, false);
  assert.equal(record.fetch_error, 'bot_challenge');
  assert.equal(record.is_html, false);
  assert.deepEqual(record.titles, []);
  assert.deepEqual(record.discovered_via, ['start']);
  assert.deepEqual(record.indexability, { indexable: false, reasons: ['fetch_error'] });
  const limited = unreadableRecord({ url: PAGE_URL, status: 429, fetchError: 'rate_limited', depth: null, discoveredVia: ['sitemap'] });
  assert.deepEqual(limited.indexability.reasons, ['fetch_error']);
  assert.equal(limited.depth, null);
});

test('every builder gives every PageRecord field', () => {
  const keys = Object.keys(extractPage(makeInput(makeFetch()))).sort();
  assert.deepEqual(Object.keys(redirect()).sort(), keys);
  assert.deepEqual(Object.keys(unreadableRecord({ url: PAGE_URL, status: 403, fetchError: 'bot_challenge', depth: 0, discoveredVia: ['link'] })).sort(), keys);
  assert.deepEqual(Object.keys(makePage()).sort(), keys);
});

test('a non-HTML response has empty content fields but keeps header directives', () => {
  const result = makeFetch({
    url: 'https://example.test/file.pdf',
    body: Buffer.from('%PDF-1.7 <title>Not a title</title>'),
    headers: { 'content-type': 'application/pdf', 'x-robots-tag': 'noindex' },
    headerLines: { 'x-robots-tag': ['noindex'] },
  });
  const record = extractPage(makeInput(result));
  assert.equal(record.is_html, false);
  assert.equal(record.content_type, 'application/pdf');
  assert.deepEqual(record.titles, []);
  assert.deepEqual(record.links, []);
  assert.equal(record.word_count, 0);
  assert.equal(record.text_hash, '');
  assert.equal(record.text_excerpt, '');
  assert.equal(record.html_lang, null);
  assert.deepEqual(record.x_robots, ['noindex']);
  assert.deepEqual(record.indexability.reasons, ['not_html', 'noindex_header']);
});

test('a missing Content-Type with an HTML body is sniffed as HTML', () => {
  const sniffed = extractPage(makeInput(makeFetch({ headers: {}, html: '<!DOCTYPE html><title>Sniffed</title>' })));
  assert.equal(sniffed.is_html, true);
  assert.equal(sniffed.content_type, null);
  assert.deepEqual(sniffed.titles, ['Sniffed']);
  const plain = extractPage(makeInput(makeFetch({ headers: {}, body: Buffer.from('just text <title>x</title>') })));
  assert.equal(plain.is_html, false);
  assert.deepEqual(plain.indexability.reasons, ['not_html']);
});

test('a 404 HTML page is extracted and not indexable with status_404', () => {
  const record = extractPage(makeInput(makeFetch({ status: 404, html: '<title>Not found</title><a href="/">Home</a>' })));
  assert.deepEqual(record.titles, ['Not found']);
  assert.equal(record.links.length, 1);
  assert.deepEqual(record.indexability, { indexable: false, reasons: ['status_404'] });
});

test('a 5xx HTML page is extracted too', () => {
  const record = extractPage(makeInput(makeFetch({ status: 503, html: '<title>Down</title>' })));
  assert.deepEqual(record.titles, ['Down']);
  assert.deepEqual(record.indexability.reasons, ['status_503']);
});

test('noindex in meta and in the header, including none', () => {
  const meta = extractPage(makeInput(makeFetch({ html: '<meta name="robots" content="none">' })));
  assert.deepEqual(meta.indexability.reasons, ['noindex_meta']);
  const header = extractPage(makeInput(makeFetch({ headerLines: { 'x-robots-tag': ['none'] } })));
  assert.deepEqual(header.indexability.reasons, ['noindex_header']);
  const followOnly = extractPage(makeInput(makeFetch({ html: '<meta name="robots" content="nofollow">', headerLines: { 'x-robots-tag': ['otherbot: noindex'] } })));
  assert.deepEqual(followOnly.indexability, { indexable: true, reasons: [] });
});

test('a noindex page with a canonical elsewhere lists the reasons in order', () => {
  const record = extractPage(makeInput(makeFetch({
    status: 410,
    html: '<head><meta name="robots" content="noindex"><link rel="canonical" href="/other"></head>',
    headerLines: { 'x-robots-tag': ['googlebot: noindex'] },
  })));
  assert.deepEqual(record.indexability.reasons, ['status_410', 'noindex_meta', 'noindex_header', 'canonical_elsewhere']);
});

test('canonical_elsewhere: self canonical passes, any self entry passes, header canonicals count', () => {
  const self = extractPage(makeInput(makeFetch({ html: '<head><link rel="canonical" href="https://example.test/page?utm_campaign=x"></head>' })));
  assert.deepEqual(self.indexability.reasons, []);
  const mixed = extractPage(makeInput(makeFetch({ html: '<head><link rel="canonical" href="/page"><link rel="canonical" href="/other"></head>' })));
  assert.deepEqual(mixed.indexability.reasons, []);
  const header = extractPage(makeInput(makeFetch({ headerLines: { link: ['<https://example.test/other>; rel="canonical"'] } })));
  assert.deepEqual(header.indexability.reasons, ['canonical_elsewhere']);
});

test('a canonical only outside <head> or with an invalid URL is not effective', () => {
  const inBody = extractPage(makeInput(makeFetch({ html: '<html><head></head><body><link rel="canonical" href="/other"></body></html>' })));
  assert.equal(inBody.canonicals.length, 1);
  assert.equal(inBody.canonicals[0].in_head, false);
  assert.deepEqual(inBody.indexability, { indexable: true, reasons: [] });
  const invalid = extractPage(makeInput(makeFetch({ html: '<head><link rel="canonical" href="ftp://example.test/x"></head>' })));
  assert.deepEqual(invalid.indexability.reasons, []);
});

test('the same input always gives the same record', () => {
  const input = makeInput(makeFetch({ html: FINAL_HTML }));
  assert.deepEqual(extractPage(input), extractPage(input));
  assert.deepEqual(redirect(), redirect());
});

test('a 1 MB HTML document extracts in well under three seconds', () => {
  const chunk = '<div class="card"><h2>Başlık</h2><p>Some <b>body</b> text with a <a href="/p?i=1">link</a> and <img src="/i.png" alt="x"></p></div>\n';
  const html = `<!doctype html><html><head><title>Big</title></head><body>${chunk.repeat(Math.ceil(1_048_576 / chunk.length))}</body></html>`;
  assert.ok(Buffer.byteLength(html) >= 1_048_576);
  const started = cpuMs();
  const record = extractPage(makeInput(makeFetch({ html })));
  const elapsed = cpuMs() - started;
  assert.equal(record.links.length, 5000);
  assert.equal(record.images.length, 2000);
  assert.ok(elapsed < 3000, `took ${Math.round(elapsed)} ms`);
});
