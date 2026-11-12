// Percent-encoded and literal forms of a character (validation of 2026-11-12,
// bug B3). A wiki page linked with an apostrophe names the `%27` form in its
// canonical; the page was recorded as canonical_elsewhere and left out of
// every check on indexable pages.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { indexabilityOf } from '../../server/src/extract/indexability.js';
import { compileRule, decidingRule, rulePath } from '../../server/src/net/robots-match.js';
import { normalizeUrl, sameCanonicalTarget } from '../../server/src/util/url.js';
import { makePage } from '../helpers/factories.js';

test('escapes of unreserved characters are decoded, other escapes keep their meaning with upper-case hex', () => {
  assert.equal(normalizeUrl('https://example.test/%7Euser'), normalizeUrl('https://example.test/~user'));
  assert.equal(normalizeUrl('https://example.test/%7euser/%41%2D%5F%2E%30'), 'https://example.test/~user/A-_.0');
  assert.equal(normalizeUrl('https://example.test/a%2fb?q=%3d%26'), 'https://example.test/a%2Fb?q=%3D%26', 'reserved characters stay encoded');
  assert.equal(normalizeUrl('https://example.test/%c3%a7'), 'https://example.test/%C3%A7');
  assert.equal(normalizeUrl("https://example.test/Today's"), "https://example.test/Today's");
  assert.equal(normalizeUrl('https://example.test/Today%27s'), 'https://example.test/Today%27s', "RFC 3986 does not make ' and %27 equal");
});

test('a canonical to the %27 form of the page\'s own URL names the page itself; a canonical to another page does not', () => {
  const url = "https://wiki.example/wiki/Project:Today's_article/November";
  const self = { href: 'https://wiki.example/wiki/Project:Today%27s_article/November', url: 'https://wiki.example/wiki/Project:Today%27s_article/November', source: /** @type {const} */ ('html'), in_head: true, line: 29 };
  const page = makePage({ url, canonicals: [self] });
  assert.deepEqual(indexabilityOf(page), { indexable: true, reasons: [] });
  const other = { ...self, href: 'https://wiki.example/wiki/Other%27s', url: 'https://wiki.example/wiki/Other%27s' };
  assert.deepEqual(indexabilityOf(makePage({ url, canonicals: [other] })).reasons, ['canonical_elsewhere']);
  assert.equal(sameCanonicalTarget('https://x.test/a(b)!*', 'https://x.test/a%28b%29%21%2a'), true);
  assert.equal(sameCanonicalTarget('https://x.test/a/b', 'https://x.test/a%2Fb'), false, 'a slash is not one of them');
});

test('robots.txt rules match a path whatever way its unreserved characters are written (RFC 9309, 2.2.2)', () => {
  const rule = compileRule({ pattern: '/%7Eprivate', allow: false });
  assert.equal(decidingRule([rule], rulePath('https://example.test/~private/x')), rule);
  const literal = compileRule({ pattern: '/~private', allow: false });
  assert.equal(decidingRule([literal], rulePath('https://example.test/%7Eprivate/x')), literal);
  assert.equal(compileRule({ pattern: '/a%2A', allow: false }).pieces.length, 1, 'an escaped * is not a wildcard');
});

test('normalizing twice gives what normalizing once gives, and rule precedence keeps the length as written (review of 2026-11-12)', () => {
  for (const raw of ['https://x.test/%%37E', 'https://x.test/%%34%31', 'https://x.test/%25%37E', 'https://x.test/a%2eb?q=%7e']) {
    const once = /** @type {string} */ (normalizeUrl(raw));
    assert.equal(normalizeUrl(once), once, raw);
  }
  assert.equal(normalizeUrl('https://x.test/%%37E'), 'https://x.test/%%37E', 'a lone % keeps every escape as it is');
  const disallow = compileRule({ pattern: '/%61dmin/', allow: false });
  const allow = compileRule({ pattern: '/admin/x', allow: true });
  assert.equal(decidingRule([disallow, allow], rulePath('https://x.test/admin/x')), disallow, 'the longer rule as written wins');
});
