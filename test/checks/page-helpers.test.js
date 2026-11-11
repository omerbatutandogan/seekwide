import assert from 'node:assert/strict';
import { test } from 'node:test';

import { effectiveCanonicalUrls, firstNonEmpty, isNoindex, isRedirectRecord, isUnverifiable } from '../../server/src/checks/page-helpers.js';
import { SITE, makePage, makeRedirect } from '../helpers/factories.js';

test('isNoindex reads both the meta and the header reason', () => {
  assert.equal(isNoindex(makePage()), false);
  assert.equal(isNoindex(makePage({ indexability: { indexable: false, reasons: ['noindex_meta'] } })), true);
  assert.equal(isNoindex(makePage({ indexability: { indexable: false, reasons: ['noindex_header'] } })), true);
  assert.equal(isNoindex(makePage({ indexability: { indexable: false, reasons: ['canonical_elsewhere'] } })), false);
});

test('effectiveCanonicalUrls keeps head and header canonicals with valid URLs, once each', () => {
  const page = makePage({
    canonicals: [
      { href: '/a', url: `${SITE}/a`, source: 'html', in_head: true, line: 4 },
      { href: `${SITE}/a`, url: `${SITE}/a`, source: 'header', in_head: true, line: null },
      { href: '/b', url: `${SITE}/b`, source: 'html', in_head: false, line: 40 },
      { href: 'javascript:void(0)', url: null, source: 'html', in_head: true, line: 5 },
      { href: '/c', url: `${SITE}/c`, source: 'html', in_head: true, line: 6 },
    ],
  });
  assert.deepEqual(effectiveCanonicalUrls(page), [`${SITE}/a`, `${SITE}/c`]);
  assert.deepEqual(effectiveCanonicalUrls(makePage({ canonicals: [] })), []);
});

test('firstNonEmpty skips blank entries and trims', () => {
  assert.equal(firstNonEmpty(['', '   ', '  Title  ', 'Other']), 'Title');
  assert.equal(firstNonEmpty(['', ' ']), null);
  assert.equal(firstNonEmpty([]), null);
});

test('isUnverifiable is true only when the crawler was refused, not when the site is broken', () => {
  for (const reason of ['bot_challenge', 'rate_limited', 'robots_disallowed']) {
    assert.equal(isUnverifiable(makePage({ status: 503, fetch_error: reason })), true, reason);
  }
  for (const reason of ['timeout', 'dns_error', 'connection_error', 'too_many_redirects']) {
    assert.equal(isUnverifiable(makePage({ status: 0, fetch_error: reason })), false, reason);
  }
  assert.equal(isUnverifiable(makePage({ status: 503 })), false, 'a plain 503 is a site problem');
  assert.equal(isUnverifiable(makePage()), false);
});

test('isRedirectRecord is true only for 3xx records', () => {
  assert.equal(isRedirectRecord(makeRedirect(`${SITE}/old`, `${SITE}/new`)), true);
  assert.equal(isRedirectRecord(makePage()), false);
  assert.equal(isRedirectRecord(makePage({ status: 404 })), false);
});
