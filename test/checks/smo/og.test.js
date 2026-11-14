import assert from 'node:assert/strict';
import { test } from 'node:test';

import { FACEBOOK_HEAD_BYTES, HEAD_LIMIT_BYTES } from '../../../plugin/server/src/checks/smo/helpers.js';
import { SITE, makePage } from '../../helpers/factories.js';
import { FULL_OG, audit, counts, findingsFor, sharedPage } from './support.js';

const social = (/** @type {object} */ overrides = {}) => ({ outside_head: [], streamed: false, head_end: { bytes: 2048, by: 'head' }, app_banners: [], rel_me: [], ...overrides });

test('a page with every tag passes every page check of the module', () => {
  const result = audit([sharedPage('/')]);
  for (const id of ['smo.og.image_missing', 'smo.og.required_missing', 'smo.og.outside_head', 'smo.og.head_too_late', 'smo.og.image_not_absolute', 'smo.og.url_mismatch', 'smo.og.image_size_undeclared', 'smo.og.image_alt_missing']) {
    assert.deepEqual(counts(result, id), [1, 0], id);
  }
  assert.equal(result.findings.length, 0);
});

test('smo.og.image_missing fails an indexable page with neither og:image nor twitter:image; twitter:image alone passes', () => {
  const result = audit([
    sharedPage('/none', { og: { ...FULL_OG, image: ' ' } }),
    sharedPage('/twitter', { og: { title: 'T' }, twitter: { image: `${SITE}/t.png` } }),
    sharedPage('/noindex', { og: {}, indexability: { indexable: false, reasons: ['noindex_meta'] } }),
  ]);
  assert.deepEqual(counts(result, 'smo.og.image_missing'), [2, 1], 'a noindex page is not a unit');
  const [finding] = findingsFor(result, 'smo.og.image_missing');
  assert.deepEqual([finding.url, finding.selector, finding.severity, finding.weight], [`${SITE}/none`, 'meta[property="og:image"]', 'medium', 3]);
});

test('smo.og.required_missing names each of og:title, og:type, og:url and og:description that is missing or empty', () => {
  const result = audit([sharedPage('/a', { og: { image: `${SITE}/i.png`, title: 'T', type: '' } }), sharedPage('/b')]);
  assert.deepEqual(counts(result, 'smo.og.required_missing'), [2, 1]);
  assert.deepEqual(findingsFor(result, 'smo.og.required_missing')[0].evidence.observed, { missing: ['og:type', 'og:url', 'og:description'] });
});

test('smo.og.outside_head fails Open Graph tags given only outside the head, says when Next.js streamed them, and is likely', () => {
  const result = audit([
    sharedPage('/body', { social: social({ outside_head: [{ key: 'og:image', line: 40 }, { key: 'apple-itunes-app', line: 41 }] }) }),
    sharedPage('/streamed', { social: social({ outside_head: [{ key: 'og:title', line: 9 }], streamed: true }) }),
    sharedPage('/banner-only', { social: social({ outside_head: [{ key: 'apple-itunes-app', line: 3 }] }) }),
    sharedPage('/old', { social: undefined }),
    makePage({ url: `${SITE}/no-og` }),
  ]);
  assert.deepEqual(counts(result, 'smo.og.outside_head'), [3, 2], 'a record made before 0.1.9 and a page without Open Graph tags are not units');
  const [body, streamed] = findingsFor(result, 'smo.og.outside_head');
  assert.deepEqual(body.evidence.observed, { outside_head: ['og:image'], streamed: false });
  assert.equal(body.line, 40);
  assert.equal(body.confidence, 'likely');
  assert.match(streamed.evidence.detail ?? '', /streaming metadata/);
});

test('smo.og.head_too_late fails a head that ends after 300 KiB, and names Facebook past 1 MiB', () => {
  const result = audit([
    sharedPage('/ok', { social: social({ head_end: { bytes: HEAD_LIMIT_BYTES, by: 'head' } }) }),
    sharedPage('/late', { social: social({ head_end: { bytes: HEAD_LIMIT_BYTES + 1, by: 'head' } }) }),
    sharedPage('/very-late', { social: social({ head_end: { bytes: FACEBOOK_HEAD_BYTES + 1, by: 'og' } }) }),
    sharedPage('/unknown', { social: social({ head_end: null }) }),
    makePage({ url: `${SITE}/no-og`, social: social({ head_end: { bytes: FACEBOOK_HEAD_BYTES * 2, by: 'head' } }) }),
  ]);
  assert.deepEqual(counts(result, 'smo.og.head_too_late'), [3, 2], 'a page that gives no Open Graph tag is not a unit');
  const [late, veryLate] = findingsFor(result, 'smo.og.head_too_late');
  assert.doesNotMatch(late.evidence.detail ?? '', /Facebook/);
  assert.match(veryLate.evidence.detail ?? '', /The last og: tag ends after .*Facebook/);
  assert.deepEqual(veryLate.evidence.observed, { bytes: FACEBOOK_HEAD_BYTES + 1, measured_at: 'end of the last og: tag' });
});

test('smo.og.image_not_absolute fails a relative og:image and passes http, https and protocol-relative URLs', () => {
  const result = audit([
    sharedPage('/rel', { og: { ...FULL_OG, image: '/images/share.png' } }),
    sharedPage('/proto', { og: { ...FULL_OG, image: '//cdn.example.test/a.png' } }),
    sharedPage('/http', { og: { ...FULL_OG, image: 'HTTP://example.test/a.png' } }),
    sharedPage('/none', { og: { title: 'T' } }),
  ]);
  assert.deepEqual(counts(result, 'smo.og.image_not_absolute'), [3, 1]);
  assert.deepEqual(findingsFor(result, 'smo.og.image_not_absolute')[0].evidence.observed, { og_image: '/images/share.png' });
});

test('smo.og.url_mismatch fails a decorated og:url or one that differs from the canonical, and is likely', () => {
  const result = audit([
    sharedPage('/a', { og: { ...FULL_OG, url: `${SITE}/a?utm_source=x&id=2` } }),
    sharedPage('/b', { og: { ...FULL_OG, url: `${SITE}/b;jsessionid=ABC` } }),
    sharedPage('/c', { og: { ...FULL_OG, url: `${SITE}/other` } }),
    sharedPage('/d', { og: { ...FULL_OG, url: '/d' } }),
    sharedPage('/e', { og: { ...FULL_OG, url: `${SITE}/e?page=2` }, canonicals: [] }),
    sharedPage("/f'", { og: { ...FULL_OG, url: `${SITE}/f%27` } }),
    sharedPage('/g', { og: { ...FULL_OG, url: '' } }),
  ]);
  assert.deepEqual(counts(result, 'smo.og.url_mismatch'), [6, 3]);
  const findings = findingsFor(result, 'smo.og.url_mismatch');
  assert.deepEqual(findings.map((finding) => finding.url), [`${SITE}/a`, `${SITE}/b`, `${SITE}/c`]);
  assert.deepEqual(findings[0].evidence.observed, { og_url: `${SITE}/a?utm_source=x&id=2`, parameters: ['utm_source'] });
  assert.deepEqual(findings[2].evidence.observed, { og_url: `${SITE}/other`, canonical: `${SITE}/c` });
  assert.equal(findings[0].confidence, 'likely');
});

test('the declared size and the text alternative of the sharing image are info checks', () => {
  const result = audit([
    sharedPage('/a', { og: { ...FULL_OG, 'image:width': '', 'image:alt': '' }, twitter: { 'image:alt': 'A photo' } }),
    sharedPage('/b', { og: { ...FULL_OG, 'image:alt': '' } }),
  ]);
  assert.deepEqual(counts(result, 'smo.og.image_size_undeclared'), [2, 1]);
  assert.deepEqual(findingsFor(result, 'smo.og.image_size_undeclared')[0].evidence.observed, { missing: ['og:image:width'] });
  assert.deepEqual(counts(result, 'smo.og.image_alt_missing'), [2, 1], 'twitter:image:alt counts');
  assert.equal(findingsFor(result, 'smo.og.image_alt_missing')[0].url, `${SITE}/b`);
  const info = result.findings.filter((finding) => ['smo.og.image_size_undeclared', 'smo.og.image_alt_missing'].includes(finding.check_id));
  assert.ok(info.length === 2 && info.every((finding) => finding.weight === 0 && finding.severity === 'info'));
});

test('smo.twitter.card_invalid flags an unknown card type and passes the four X listed', () => {
  const result = audit(['summary', 'summary_large_image', 'app', 'player', 'large_image', 'Summary'].map((card, i) => sharedPage(`/${i}`, { twitter: { card } })));
  assert.deepEqual(counts(result, 'smo.twitter.card_invalid'), [6, 2]);
  assert.deepEqual(findingsFor(result, 'smo.twitter.card_invalid').map((finding) => finding.evidence.observed), [{ twitter_card: 'large_image' }, { twitter_card: 'Summary' }]);
});
