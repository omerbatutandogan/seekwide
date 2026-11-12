import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blocksFraming } from '../../../server/src/checks/security/headers.js';
import { SITE, makePage, makeSecurity, makeSecurityHeaders } from '../../helpers/factories.js';
import { audit, findingsFor, statFor } from './support.js';

/** @import { SecurityHeaders } from '../../../server/src/types.js' */

const IDS = ['security.headers.csp_missing', 'security.headers.framing_missing', 'security.headers.hsts_missing', 'security.headers.nosniff_missing', 'security.headers.referrer_leaky'];

/**
 * Audit a site whose start page sends these headers.
 * @param {Partial<SecurityHeaders>} headers
 * @param {Partial<import('../../../server/src/types.js').CrawlResult>} [crawl]
 */
const withHeaders = (headers, crawl = {}) => audit([
  makePage({ url: `${SITE}/`, security: makeSecurity({ headers: makeSecurityHeaders(headers) }) }),
  // Another page's headers are never read.
  makePage({ url: `${SITE}/other`, security: makeSecurity({ headers: makeSecurityHeaders({ hsts_max_age: null, nosniff: false, csp: null }) }) }),
], crawl);

/** @param {ReturnType<typeof audit>} result */
const failing = (result) => result.findings.map((finding) => finding.check_id);

test('the header checks pass a start page that sends every header, with one unit each on the start page', () => {
  const result = withHeaders({});
  assert.deepEqual(failing(result), []);
  for (const id of IDS) {
    assert.equal(statFor(result, id).applicable, 1, id);
  }
});

test('security.headers.hsts_missing fails without a valid max-age above 0, and has no unit on an http site', () => {
  assert.deepEqual(failing(withHeaders({ hsts_max_age: null })), ['security.headers.hsts_missing']);
  const zero = findingsFor(withHeaders({ hsts_max_age: 0 }), 'security.headers.hsts_missing')[0];
  assert.match(zero.evidence.detail ?? '', /max-age=0/);
  assert.equal(zero.url, `${SITE}/`);
  assert.equal(zero.severity, 'low');
  const http = audit([makePage({ url: 'http://example.test/', security: makeSecurity({ headers: makeSecurityHeaders({ hsts_max_age: null }) }) })], {
    start_url: 'http://example.test/', site_origin: 'http://example.test',
  });
  assert.equal(statFor(http, 'security.headers.hsts_missing').applicable, 0);
});

test('security.headers.nosniff_missing fails without nosniff', () => {
  assert.deepEqual(failing(withHeaders({ nosniff: false })), ['security.headers.nosniff_missing']);
});

test('security.headers.framing_missing follows frame-ancestors first, then X-Frame-Options', () => {
  assert.deepEqual(failing(withHeaders({ frame_ancestors: [], x_frame_options: [] })), ['security.headers.framing_missing']);
  assert.deepEqual(failing(withHeaders({ frame_ancestors: [], x_frame_options: ['sameorigin'] })), []);
  const open = findingsFor(withHeaders({ frame_ancestors: ['*'], x_frame_options: ['deny'] }), 'security.headers.framing_missing');
  assert.match(open[0].evidence.detail ?? '', /frame-ancestors directive \(\*\) lets every site frame it/);
  const headers = makeSecurityHeaders();
  /** @param {Partial<SecurityHeaders>} change */
  const blocks = (change) => blocksFraming({ ...headers, ...change });
  assert.equal(blocks({ frame_ancestors: ["'none'"] }), true);
  assert.equal(blocks({ frame_ancestors: [''] }), true, 'an empty source list allows no one');
  assert.equal(blocks({ frame_ancestors: ['https: http:'] }), false);
  assert.equal(blocks({ frame_ancestors: ["'self' https://partner.test"] }), true);
  assert.equal(blocks({ frame_ancestors: ["'self' *"] }), false, 'any one source that matches every site lets every site in');
  assert.equal(blocks({ frame_ancestors: ["'self' https:"] }), false);
  assert.equal(blocks({ frame_ancestors: ["'none' https:"] }), false, "'none' with other sources is ignored");
  assert.equal(blocks({ frame_ancestors: ['*', "'self'"] }), true, 'a framer must pass every policy');
  assert.equal(blocks({ frame_ancestors: ['https://*:*'] }), false);
  assert.equal(blocks({ frame_ancestors: ['*:*'] }), false);
  const partners = Array.from({ length: 12 }, (_, i) => `https://partner${i}.example.com`).join(' ');
  assert.equal(blocks({ frame_ancestors: [`${partners} *`] }), false, 'a wildcard after a long list still counts');
  assert.equal(blocks({ frame_ancestors: [], x_frame_options: ['deny'] }), true);
  assert.equal(blocks({ frame_ancestors: [], x_frame_options: ['allow-from https://a.test'] }), false);
  assert.equal(blocks({ frame_ancestors: [], x_frame_options: ['allowall'] }), false);
  assert.equal(blocks({ frame_ancestors: [], x_frame_options: ['sameorigin', 'allowall'] }), true, 'conflicting values block');
  assert.equal(blocks({ frame_ancestors: [], x_frame_options: ['x', 'y'] }), false);
});

test('security.headers.csp_missing is info and passes a policy from a <meta> tag', () => {
  const result = withHeaders({ csp: null });
  assert.deepEqual(failing(result), ['security.headers.csp_missing']);
  assert.equal(result.findings[0].weight, 0);
  assert.equal(result.modules.security.score, 100, 'an info check never changes the score');
  assert.deepEqual(failing(withHeaders({ csp: 'meta' })), []);
});

test('security.headers.referrer_leaky fails only the two policies that send full addresses', () => {
  assert.deepEqual(failing(withHeaders({ referrer_policy: 'unsafe-url' })), ['security.headers.referrer_leaky']);
  assert.deepEqual(failing(withHeaders({ referrer_policy: 'no-referrer-when-downgrade' })), ['security.headers.referrer_leaky']);
  assert.deepEqual(failing(withHeaders({ referrer_policy: null })), [], 'browsers then use strict-origin-when-cross-origin');
  assert.deepEqual(failing(withHeaders({ referrer_policy: 'origin' })), []);
});

test('the header checks are skipped, with the reason, for a site on this machine', () => {
  const result = withHeaders({ hsts_max_age: null, nosniff: false, csp: null }, { options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true } });
  assert.deepEqual(failing(result), []);
  for (const id of IDS) {
    const stat = statFor(result, id);
    assert.equal(stat.status, 'skipped', id);
    assert.match(stat.skip_reason ?? '', /server on this machine/);
  }
});

test('the header checks have no unit when the start page is not an html page', () => {
  const result = audit([makePage({ url: `${SITE}/`, status: 500, security: makeSecurity({ headers: makeSecurityHeaders({ nosniff: false }) }) })]);
  for (const id of IDS) assert.equal(statFor(result, id).applicable, 0, id);
});
