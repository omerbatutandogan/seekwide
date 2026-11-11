import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makePage } from '../../helpers/factories.js';
import { audit } from './helpers.js';

const NOINDEX = { indexable: false, reasons: ['noindex_header'] };

test('seo.meta_description.missing fails indexable pages without description text', () => {
  const pages = [
    makePage({ url: `${SITE}/ok` }),
    makePage({ url: `${SITE}/none`, meta_descriptions: [] }),
    makePage({ url: `${SITE}/blank`, meta_descriptions: [' '] }),
    makePage({ url: `${SITE}/hidden`, meta_descriptions: [], indexability: NOINDEX }),
  ];
  const { units, failed, findings } = audit('seo.meta_description.missing', { pages });
  assert.deepEqual(units, [`${SITE}/blank`, `${SITE}/none`, `${SITE}/ok`]);
  assert.deepEqual(failed, [`${SITE}/blank`, `${SITE}/none`]);
  assert.equal(findings[0].selector, 'meta[name=description]');
});

test('seo.meta_description.multiple fails html pages with more than one description', () => {
  const pages = [
    makePage({ url: `${SITE}/one` }),
    makePage({ url: `${SITE}/two`, meta_descriptions: ['First', ''] }),
    makePage({ url: `${SITE}/hidden`, meta_descriptions: ['A', 'B'], indexability: NOINDEX }),
    makePage({ url: `${SITE}/pdf`, is_html: false, meta_descriptions: ['A', 'B'], indexability: { indexable: false, reasons: ['not_html'] } }),
  ];
  const { units, failed } = audit('seo.meta_description.multiple', { pages });
  assert.deepEqual(units, [`${SITE}/hidden`, `${SITE}/one`, `${SITE}/two`]);
  assert.deepEqual(failed, [`${SITE}/hidden`, `${SITE}/two`]);
});

test('seo.meta_description.duplicate fails every page of a group and lists the others', () => {
  const pages = [
    makePage({ url: `${SITE}/a`, meta_descriptions: ['Shared summary.'] }),
    makePage({ url: `${SITE}/b`, meta_descriptions: ['', 'shared  summary.'] }),
    makePage({ url: `${SITE}/c`, meta_descriptions: ['Unique summary.'] }),
    makePage({ url: `${SITE}/hidden`, meta_descriptions: ['Shared summary.'], indexability: NOINDEX }),
    makePage({ url: `${SITE}/none`, meta_descriptions: [] }),
  ];
  const { units, failed, findings } = audit('seo.meta_description.duplicate', { pages });
  assert.deepEqual(units, [`${SITE}/a`, `${SITE}/b`, `${SITE}/c`]);
  assert.deepEqual(failed, [`${SITE}/a`, `${SITE}/b`]);
  assert.deepEqual(findings[0].related_urls, [`${SITE}/b`]);
  assert.deepEqual(findings[1].related_urls, [`${SITE}/a`]);
  assert.deepEqual(findings[1].evidence.observed, { pages_with_same_description: 2 });
});

test('seo.meta_description.too_long fails descriptions over 160 characters', () => {
  const pages = [
    makePage({ url: `${SITE}/long`, meta_descriptions: ['x'.repeat(161)] }),
    makePage({ url: `${SITE}/edge`, meta_descriptions: ['ü'.repeat(160)] }),
    makePage({ url: `${SITE}/hidden`, meta_descriptions: ['x'.repeat(200)], indexability: NOINDEX }),
    makePage({ url: `${SITE}/none`, meta_descriptions: [] }),
  ];
  const { units, failed, findings } = audit('seo.meta_description.too_long', { pages });
  assert.deepEqual(units, [`${SITE}/edge`, `${SITE}/long`]);
  assert.deepEqual(failed, [`${SITE}/long`]);
  assert.deepEqual(findings[0].evidence.observed, { characters: 161 });
});
