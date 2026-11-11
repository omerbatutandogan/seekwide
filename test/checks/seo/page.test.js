import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makePage, makeRedirect } from '../../helpers/factories.js';
import { audit } from './helpers.js';

const NOINDEX = { indexable: false, reasons: ['noindex_meta'] };

test('seo.https.mixed_content fails https pages that load http resources and ignores http pages', () => {
  const pages = [
    makePage({ url: `${SITE}/mixed`, mixed_content: ['http://cdn.test/a.js', 'http://cdn.test/b.css'] }),
    makePage({ url: `${SITE}/clean` }),
    makePage({ url: 'http://example.test/plain', mixed_content: [] }),
  ];
  const { units, failed, findings } = audit('seo.https.mixed_content', { pages });
  assert.deepEqual(units, [`${SITE}/clean`, `${SITE}/mixed`]);
  assert.deepEqual(failed, [`${SITE}/mixed`]);
  assert.deepEqual(findings[0].evidence.observed, ['http://cdn.test/a.js', 'http://cdn.test/b.css']);
});

test('seo.mobile.viewport_missing fails html pages without viewport content', () => {
  const pages = [
    makePage({ url: `${SITE}/ok` }),
    makePage({ url: `${SITE}/none`, viewport: null }),
    makePage({ url: `${SITE}/empty`, viewport: ' ', indexability: NOINDEX }),
    makeRedirect(`${SITE}/old`, `${SITE}/ok`),
  ];
  const { units, failed, findings } = audit('seo.mobile.viewport_missing', { pages });
  assert.deepEqual(units, [`${SITE}/empty`, `${SITE}/none`, `${SITE}/ok`]);
  assert.deepEqual(failed, [`${SITE}/empty`, `${SITE}/none`]);
  assert.equal(findings[0].selector, 'meta[name=viewport]');
});

test('seo.html.lang_missing fails html pages without a lang attribute', () => {
  const pages = [
    makePage({ url: `${SITE}/ok` }),
    makePage({ url: `${SITE}/none`, html_lang: null }),
    makePage({ url: `${SITE}/error`, status: 404, html_lang: null, indexability: { indexable: false, reasons: ['status_404'] } }),
  ];
  const { units, failed, findings } = audit('seo.html.lang_missing', { pages });
  assert.deepEqual(units, [`${SITE}/none`, `${SITE}/ok`]);
  assert.deepEqual(failed, [`${SITE}/none`]);
  assert.equal(findings[0].selector, 'html');
});

test('seo.content.duplicate_body fails every page with the same text and skips short or non-indexable pages', () => {
  const pages = [
    makePage({ url: `${SITE}/a`, text_hash: 'same', word_count: 120 }),
    makePage({ url: `${SITE}/b`, text_hash: 'same', word_count: 120 }),
    makePage({ url: `${SITE}/c`, text_hash: 'same', word_count: 50 }),
    makePage({ url: `${SITE}/unique`, text_hash: 'other', word_count: 300 }),
    makePage({ url: `${SITE}/short`, text_hash: 'same', word_count: 49 }),
    makePage({ url: `${SITE}/hidden`, text_hash: 'same', word_count: 120, indexability: NOINDEX }),
    makePage({ url: `${SITE}/no-hash`, text_hash: '', word_count: 120 }),
  ];
  const { units, failed, findings } = audit('seo.content.duplicate_body', { pages });
  assert.deepEqual(units, [`${SITE}/a`, `${SITE}/b`, `${SITE}/c`, `${SITE}/unique`]);
  assert.deepEqual(failed, [`${SITE}/a`, `${SITE}/b`, `${SITE}/c`]);
  assert.deepEqual(findings[0].related_urls, [`${SITE}/b`, `${SITE}/c`]);
  assert.deepEqual(findings[1].related_urls, [`${SITE}/a`, `${SITE}/c`]);
  assert.deepEqual(findings[2].related_urls, [`${SITE}/a`, `${SITE}/b`]);
  assert.deepEqual(findings[0].evidence.observed, { pages_with_same_text: 3, word_count: 120 });
});

test('seo.content.thin fails indexable pages under 100 words', () => {
  const pages = [
    makePage({ url: `${SITE}/thin`, word_count: 99 }),
    makePage({ url: `${SITE}/enough`, word_count: 100 }),
    makePage({ url: `${SITE}/hidden`, word_count: 3, indexability: NOINDEX }),
  ];
  const { units, failed, findings } = audit('seo.content.thin', { pages });
  assert.deepEqual(units, [`${SITE}/enough`, `${SITE}/thin`]);
  assert.deepEqual(failed, [`${SITE}/thin`]);
  assert.deepEqual(findings[0].evidence.observed, { word_count: 99 });
});

test('seo.structured_data.invalid_json has one unit per block and fails invalid blocks', () => {
  const pages = [
    makePage({
      url: `${SITE}/sd`,
      jsonld: [
        { valid: true, types: ['Organization'], error: null, line: 12 },
        { valid: false, types: [], error: 'Unexpected token } in JSON at position 40', line: 20 },
      ],
    }),
    makePage({ url: `${SITE}/plain` }),
    makePage({
      url: `${SITE}/error`,
      status: 500,
      jsonld: [{ valid: false, types: [], error: 'bad', line: 3 }],
      indexability: { indexable: false, reasons: ['status_500'] },
    }),
  ];
  const { stat, findings, results } = audit('seo.structured_data.invalid_json', { pages });
  assert.equal(stat.applicable, 2);
  assert.deepEqual(results.map((r) => r.selector), ['jsonld[1]', 'jsonld[2]']);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].selector, 'jsonld[2]');
  assert.equal(findings[0].line, 20);
  assert.match(findings[0].evidence.detail ?? '', /Unexpected token/);
});

test('seo.social.og_incomplete fails indexable pages missing og:title or og:image', () => {
  const pages = [
    makePage({ url: `${SITE}/full`, og: { title: 'T', image: `${SITE}/i.png` } }),
    makePage({ url: `${SITE}/no-image`, og: { title: 'T' } }),
    makePage({ url: `${SITE}/empty`, og: { title: ' ', image: '' } }),
    makePage({ url: `${SITE}/hidden`, og: {}, indexability: NOINDEX }),
  ];
  const { units, failed, findings } = audit('seo.social.og_incomplete', { pages });
  assert.deepEqual(units, [`${SITE}/empty`, `${SITE}/full`, `${SITE}/no-image`]);
  assert.deepEqual(failed, [`${SITE}/empty`, `${SITE}/no-image`]);
  assert.deepEqual(findings[0].evidence.observed, { missing: ['og:title', 'og:image'] });
  assert.deepEqual(findings[1].evidence.observed, { missing: ['og:image'] });
});
