import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checks } from '../../../server/src/checks/seo/index.js';
import { prepareChecks } from '../../../server/src/checks/validate.js';

test('every SEO definition passes prepareChecks', () => {
  const prepared = prepareChecks(checks);
  assert.equal(prepared.length, checks.length);
});

test('the SEO module ships exactly the checks in CHECKS-SPEC.md', () => {
  assert.deepEqual(checks.map((check) => check.id).sort(), [
    'seo.canonical.cross_host',
    'seo.canonical.invalid',
    'seo.canonical.missing',
    'seo.canonical.multiple',
    'seo.canonical.outside_head',
    'seo.canonical.relative',
    'seo.canonical.target_not_ok',
    'seo.content.duplicate_body',
    'seo.content.thin',
    'seo.cwv.field_cls',
    'seo.cwv.field_inp',
    'seo.cwv.field_lcp',
    'seo.cwv.lab_cls',
    'seo.cwv.lab_lcp',
    'seo.cwv.lab_tbt',
    'seo.h1.missing',
    'seo.h1.multiple',
    'seo.headings.skipped_level',
    'seo.html.lang_missing',
    'seo.http.fetch_failed',
    'seo.http.server_error',
    'seo.https.mixed_content',
    'seo.https.not_enforced',
    'seo.https.site_not_https',
    'seo.indexing.homepage_noindex',
    'seo.indexing.noindex_in_sitemap',
    'seo.meta_description.duplicate',
    'seo.meta_description.missing',
    'seo.meta_description.multiple',
    'seo.meta_description.too_long',
    'seo.mobile.viewport_missing',
    'seo.redirect.broken',
    'seo.redirect.chain',
    'seo.robots.disallow_all',
    'seo.robots.unreachable',
    'seo.sitemap.file_error',
    'seo.sitemap.missing',
    'seo.sitemap.url_canonicalized',
    'seo.sitemap.url_not_ok',
    'seo.social.og_incomplete',
    'seo.structured_data.invalid_json',
    'seo.title.duplicate',
    'seo.title.missing',
    'seo.title.multiple',
    'seo.title.too_long',
    'seo.title.too_short',
  ]);
});

test('severity, weight, confidence, scope and requirements match the spec', () => {
  /** @type {Record<string, [string, number, string, string, string[]]>} */
  const spec = {
    'seo.robots.unreachable': ['high', 4, 'confirmed', 'site', []],
    'seo.robots.disallow_all': ['critical', 5, 'confirmed', 'site', []],
    'seo.sitemap.missing': ['low', 1, 'confirmed', 'site', []],
    'seo.sitemap.file_error': ['medium', 3, 'confirmed', 'site', []],
    'seo.indexing.homepage_noindex': ['critical', 5, 'confirmed', 'site', []],
    'seo.https.site_not_https': ['high', 4, 'confirmed', 'site', []],
    'seo.https.not_enforced': ['high', 4, 'confirmed', 'site', []],
    'seo.http.server_error': ['high', 4, 'confirmed', 'page', []],
    'seo.http.fetch_failed': ['medium', 3, 'likely', 'page', []],
    'seo.redirect.chain': ['medium', 2, 'confirmed', 'page', []],
    'seo.redirect.broken': ['high', 4, 'confirmed', 'page', []],
    'seo.title.missing': ['high', 4, 'confirmed', 'page', []],
    'seo.title.multiple': ['medium', 2, 'confirmed', 'page', []],
    'seo.title.duplicate': ['medium', 3, 'confirmed', 'page', []],
    'seo.title.too_long': ['info', 0, 'likely', 'page', []],
    'seo.title.too_short': ['info', 0, 'likely', 'page', []],
    'seo.meta_description.missing': ['low', 2, 'confirmed', 'page', []],
    'seo.meta_description.multiple': ['low', 1, 'confirmed', 'page', []],
    'seo.meta_description.duplicate': ['low', 1, 'confirmed', 'page', []],
    'seo.meta_description.too_long': ['info', 0, 'likely', 'page', []],
    'seo.h1.missing': ['medium', 2, 'confirmed', 'page', []],
    'seo.h1.multiple': ['info', 0, 'likely', 'page', []],
    'seo.headings.skipped_level': ['info', 0, 'likely', 'page', []],
    'seo.canonical.missing': ['low', 1, 'confirmed', 'page', []],
    'seo.canonical.multiple': ['high', 4, 'confirmed', 'page', []],
    'seo.canonical.outside_head': ['medium', 2, 'confirmed', 'page', []],
    'seo.canonical.invalid': ['medium', 3, 'confirmed', 'page', []],
    'seo.canonical.relative': ['low', 1, 'confirmed', 'page', []],
    'seo.canonical.target_not_ok': ['high', 4, 'confirmed', 'page', []],
    'seo.canonical.cross_host': ['medium', 2, 'likely', 'page', []],
    'seo.indexing.noindex_in_sitemap': ['high', 4, 'confirmed', 'page', ['sitemap']],
    'seo.sitemap.url_not_ok': ['medium', 3, 'confirmed', 'page', ['sitemap']],
    'seo.sitemap.url_canonicalized': ['medium', 2, 'confirmed', 'page', ['sitemap']],
    'seo.https.mixed_content': ['medium', 3, 'confirmed', 'page', []],
    'seo.mobile.viewport_missing': ['medium', 3, 'confirmed', 'page', []],
    'seo.html.lang_missing': ['low', 1, 'confirmed', 'page', []],
    'seo.content.duplicate_body': ['medium', 3, 'confirmed', 'page', []],
    'seo.content.thin': ['info', 0, 'likely', 'page', []],
    'seo.structured_data.invalid_json': ['medium', 3, 'confirmed', 'page', []],
    'seo.social.og_incomplete': ['info', 0, 'likely', 'page', []],
    'seo.cwv.field_lcp': ['medium', 3, 'confirmed', 'page', ['field_data']],
    'seo.cwv.field_inp': ['medium', 3, 'confirmed', 'page', ['field_data']],
    'seo.cwv.field_cls': ['medium', 3, 'confirmed', 'page', ['field_data']],
    'seo.cwv.lab_lcp': ['low', 2, 'likely', 'page', ['lab_data']],
    'seo.cwv.lab_cls': ['low', 2, 'likely', 'page', ['lab_data']],
    'seo.cwv.lab_tbt': ['low', 1, 'likely', 'page', ['lab_data']],
  };
  for (const check of checks) {
    const [severity, weight, confidence, scope, requires] = spec[check.id];
    assert.deepEqual(
      [check.severity, check.weight, check.confidence, check.scope, check.requires],
      [severity, weight, confidence, scope, requires],
      check.id,
    );
    assert.equal(check.module, 'seo');
    assert.equal(check.last_verified, '2026-11-11');
  }
});

test('titles, descriptions and recommendations follow the writing rules', () => {
  for (const check of checks) {
    assert.match(check.title, /^[A-Za-z<]/, check.id);
    assert.ok(!check.title.endsWith('.'), check.id);
    assert.ok(check.description.endsWith('.'), check.id);
    assert.ok(check.recommendation.endsWith('.'), check.id);
    assert.doesNotMatch(`${check.description} ${check.recommendation}`, /\b(rank|ranking|traffic|boost|guarantee)/i, check.id);
  }
});
