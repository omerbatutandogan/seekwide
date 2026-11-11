import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  hostKey,
  isInternalUrl,
  looksLikeHtmlUrl,
  normalizeUrl,
  originOf,
  templateSignature,
} from '../../server/src/util/url.js';

test('normalizeUrl resolves relative URLs against a base', () => {
  assert.equal(normalizeUrl('/about', 'https://example.com/blog/post'), 'https://example.com/about');
  assert.equal(normalizeUrl('../x', 'https://example.com/a/b/c'), 'https://example.com/a/x');
});

test('normalizeUrl lower-cases the host, drops default ports, fragments and credentials', () => {
  assert.equal(normalizeUrl('HTTPS://User:Pw@Example.COM:443/Path#section'), 'https://example.com/Path');
  assert.equal(normalizeUrl('http://example.com:80'), 'http://example.com/');
  assert.equal(normalizeUrl('http://example.com:8080/'), 'http://example.com:8080/');
});

test('normalizeUrl keeps path case and trailing slashes, which are real differences', () => {
  assert.equal(normalizeUrl('https://example.com/Page'), 'https://example.com/Page');
  assert.notEqual(normalizeUrl('https://example.com/page'), normalizeUrl('https://example.com/page/'));
});

test('normalizeUrl removes tracking parameters and keeps the others in order', () => {
  assert.equal(
    normalizeUrl('https://example.com/p?b=2&utm_source=x&a=1&gclid=abc&UTM_Campaign=y'),
    'https://example.com/p?b=2&a=1',
  );
  assert.equal(normalizeUrl('https://example.com/p?utm_medium=email'), 'https://example.com/p');
  assert.equal(normalizeUrl('https://example.com/p?'), 'https://example.com/p');
});

test('normalizeUrl leaves the encoding of kept parameters untouched', () => {
  assert.equal(
    normalizeUrl('https://example.com/s?q=a%20b&fbclid=1&x=c+d'),
    'https://example.com/s?q=a%20b&x=c+d',
  );
});

test('normalizeUrl rejects everything that is not an http(s) URL', () => {
  for (const value of ['', '   ', 'mailto:a@example.com', 'javascript:void(0)', 'tel:+123', 'ftp://example.com/x', 'data:text/html,x']) {
    assert.equal(normalizeUrl(value), null, value);
  }
  assert.equal(normalizeUrl('not a url'), null);
  assert.equal(normalizeUrl(/** @type {any} */ (undefined)), null);
  assert.equal(normalizeUrl('#top', 'https://example.com/a'), 'https://example.com/a');
});

test('hostKey ignores case and a leading www, and keeps a port', () => {
  assert.equal(hostKey('WWW.Example.com'), 'example.com');
  assert.equal(hostKey('shop.example.com'), 'shop.example.com');
  assert.equal(hostKey('www.example.com:8080'), 'example.com:8080');
  assert.equal(hostKey('localhost:3000'), 'localhost:3000');
  assert.equal(hostKey('[::1]:8080'), '[::1]:8080');
  assert.equal(hostKey('[::1]'), '[::1]');
});

test('normalizeUrl upper-cases percent escapes so one page has one URL', () => {
  assert.equal(normalizeUrl('https://example.com/%c3%a7ocuk/?q=%e2%82%ac'), 'https://example.com/%C3%A7ocuk/?q=%E2%82%AC');
  assert.equal(normalizeUrl('https://example.com/çocuk/'), normalizeUrl('https://example.com/%c3%a7ocuk/'));
  assert.equal(normalizeUrl('https://example.com/100%25-off'), 'https://example.com/100%25-off');
});

test('isInternalUrl treats another port as another site, and the two schemes as one', () => {
  assert.equal(isInternalUrl('http://example.com/a', 'example.com'), true);
  assert.equal(isInternalUrl('https://example.com/a', 'example.com'), true);
  assert.equal(isInternalUrl('https://example.com:8443/a', 'example.com'), false);
  assert.equal(isInternalUrl('http://localhost:3000/a', 'localhost:3000'), true);
  assert.equal(isInternalUrl('http://localhost:9200/a', 'localhost:3000'), false);
  assert.equal(isInternalUrl('http://localhost/a', 'localhost:3000'), false);
  assert.equal(isInternalUrl('http://127.0.0.1:3000/a', '127.0.0.1:3000'), true);
  assert.equal(isInternalUrl('http://blog.example.com:8080/a', 'example.com:8080', true), true);
  assert.equal(isInternalUrl('http://blog.example.com/a', 'example.com:8080', true), false);
});

test('isInternalUrl treats www and apex as the same site and subdomains as external by default', () => {
  assert.equal(isInternalUrl('https://www.example.com/a', 'example.com'), true);
  assert.equal(isInternalUrl('https://example.com/a', 'www.example.com'), true);
  assert.equal(isInternalUrl('https://blog.example.com/a', 'example.com'), false);
  assert.equal(isInternalUrl('https://blog.example.com/a', 'example.com', true), true);
  assert.equal(isInternalUrl('https://notexample.com/a', 'example.com', true), false);
  assert.equal(isInternalUrl('nonsense', 'example.com'), false);
});

test('templateSignature groups URLs by first segment and depth', () => {
  assert.equal(templateSignature('https://example.com/'), '/#0');
  assert.equal(templateSignature('https://example.com/blog/a-post'), '/blog#2');
  assert.equal(templateSignature('https://example.com/blog/another-post?x=1'), '/blog#2');
  assert.equal(templateSignature('https://example.com/blog'), '/blog#1');
});

test('looksLikeHtmlUrl is false only for known non-HTML extensions', () => {
  assert.equal(looksLikeHtmlUrl('https://example.com/a/b'), true);
  assert.equal(looksLikeHtmlUrl('https://example.com/a/page.html'), true);
  assert.equal(looksLikeHtmlUrl('https://example.com/a/page.php?id=1'), true);
  assert.equal(looksLikeHtmlUrl('https://example.com/v1.2/docs'), true);
  assert.equal(looksLikeHtmlUrl('https://example.com/img/photo.JPG'), false);
  assert.equal(looksLikeHtmlUrl('https://example.com/files/report.pdf?dl=1'), false);
});

test('originOf returns null for invalid input', () => {
  assert.equal(originOf('https://example.com:8443/a?b#c'), 'https://example.com:8443');
  assert.equal(originOf('nope'), null);
});
