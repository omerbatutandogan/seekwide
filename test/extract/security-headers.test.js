import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hstsMaxAge, metaReferrerPolicy, securityHeaders } from '../../plugin/server/src/extract/security-headers.js';
import { makeFetch } from './fetch-result.js';

/**
 * @param {Record<string, string[]>} lines  Header lines by lower-case name.
 * @param {{metaCsp?: boolean, metaReferrer?: string|null}} [documentSays]
 */
function read(lines, documentSays = {}) {
  const headers = Object.fromEntries(Object.entries(lines).map(([name, values]) => [name, values.join(', ')]));
  return securityHeaders(makeFetch({ headers, headerLines: lines }), { metaCsp: false, metaReferrer: null, ...documentSays });
}

test('Strict-Transport-Security: max-age is read as RFC 6797 says, or the header is invalid', () => {
  assert.equal(hstsMaxAge('max-age=31536000; includeSubDomains; preload'), 31536000);
  assert.equal(hstsMaxAge('MAX-AGE="600"'), 600);
  assert.equal(hstsMaxAge('max-age=0'), 0);
  assert.equal(hstsMaxAge('includeSubDomains'), null, 'max-age is required');
  assert.equal(hstsMaxAge('max-age=10; max-age=20'), null, 'a directive twice makes it invalid');
  assert.equal(hstsMaxAge('max-age=-5'), null);
  assert.equal(hstsMaxAge('max-age=1 year'), null);
  assert.equal(hstsMaxAge('max-age=300; unknown-directive=x'), 300, 'unknown directives are ignored');
  assert.equal(read({ 'strict-transport-security': ['max-age=0', 'max-age=300'] }).hsts_max_age, 0, 'only the first header counts');
  assert.equal(read({}).hsts_max_age, null);
});

test('X-Content-Type-Options: only the first value counts, in any letter case', () => {
  assert.equal(read({ 'x-content-type-options': ['NoSniff'] }).nosniff, true);
  assert.equal(read({ 'x-content-type-options': ['nosniff, other'] }).nosniff, true);
  assert.equal(read({ 'x-content-type-options': ['other', 'nosniff'] }).nosniff, false);
  assert.equal(read({}).nosniff, false);
});

test('Content-Security-Policy: an enforced header, else a <meta> policy; Report-Only counts for nothing', () => {
  assert.equal(read({ 'content-security-policy': ["default-src 'self'"] }).csp, 'header');
  assert.equal(read({}, { metaCsp: true }).csp, 'meta');
  assert.equal(read({ 'content-security-policy-report-only': ["default-src 'self'; frame-ancestors 'none'"] }).csp, null);
  assert.deepEqual(read({ 'content-security-policy-report-only': ["frame-ancestors 'none'"] }).frame_ancestors, []);
});

test('frame-ancestors is kept for every header policy that has it, the first directive of each, in any letter case', () => {
  assert.deepEqual(read({ 'content-security-policy': ["default-src 'self'", "FRAME-ANCESTORS 'self' https://a.test; frame-ancestors *"] }).frame_ancestors, ["'self' https://a.test"]);
  assert.deepEqual(read({ 'content-security-policy': ['frame-ancestors *', "frame-ancestors 'self'"] }).frame_ancestors, ['*', "'self'"]);
  assert.deepEqual(read({ 'content-security-policy': ["script-src 'self', frame-ancestors 'none'"] }).frame_ancestors, ["'none'"], 'two policies in one line');
  assert.deepEqual(read({ 'content-security-policy': ['frame-ancestors'] }).frame_ancestors, ['']);
  const long = `frame-ancestors ${'https://p.example.com '.repeat(20)}https://real.example`;
  assert.ok(read({ 'content-security-policy': [long] }).frame_ancestors[0].endsWith('https://real.example'), 'the whole source list is kept');
  assert.deepEqual(read({}, { metaCsp: true }).frame_ancestors, [], 'a <meta> policy cannot set it');
});

test('X-Frame-Options values are kept distinct and lower-cased', () => {
  assert.deepEqual(read({ 'x-frame-options': ['SAMEORIGIN', 'sameorigin, DENY'] }).x_frame_options, ['sameorigin', 'deny']);
  assert.ok(read({ 'x-frame-options': ['a, b, c, d, e, deny'] }).x_frame_options.includes('deny'), 'a sixth value is kept');
  assert.deepEqual(read({}).x_frame_options, []);
});

test('referrer policy: a valid <meta> wins, legacy names are mapped, else the last valid token of the header', () => {
  assert.equal(read({ 'referrer-policy': ['no-referrer, unsafe-url, made-up'] }).referrer_policy, 'unsafe-url');
  assert.equal(read({ 'referrer-policy': ['origin'] }, { metaReferrer: 'always' }).referrer_policy, 'unsafe-url');
  assert.equal(read({ 'referrer-policy': ['origin'] }, { metaReferrer: 'never' }).referrer_policy, 'no-referrer');
  assert.equal(read({ 'referrer-policy': ['origin'] }, { metaReferrer: 'nonsense' }).referrer_policy, 'origin');
  assert.equal(read({}).referrer_policy, null);
  assert.equal(metaReferrerPolicy(' Origin-When-CrossOrigin '), 'origin-when-cross-origin');
  assert.equal(metaReferrerPolicy('default'), 'strict-origin-when-cross-origin');
  assert.equal(metaReferrerPolicy(''), null);
  assert.equal(metaReferrerPolicy(null), null);
});
