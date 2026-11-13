import assert from 'node:assert/strict';
import { test } from 'node:test';

import { arialWidthPx } from '../../../plugin/server/src/checks/seo/arial-widths.js';
import { SITE, makePage, makeRedirect } from '../../helpers/factories.js';
import { audit } from './helpers.js';

const NOINDEX = { indexable: false, reasons: ['noindex_meta'] };

test('seo.title.missing fails indexable pages without title text and skips non-indexable pages', () => {
  const pages = [
    makePage({ url: `${SITE}/ok` }),
    makePage({ url: `${SITE}/none`, titles: [] }),
    makePage({ url: `${SITE}/blank`, titles: ['', '  '] }),
    makePage({ url: `${SITE}/hidden`, titles: [], indexability: NOINDEX }),
    makeRedirect(`${SITE}/old`, `${SITE}/ok`),
  ];
  const { units, failed, findings } = audit('seo.title.missing', { pages });
  assert.deepEqual(units, [`${SITE}/blank`, `${SITE}/none`, `${SITE}/ok`]);
  assert.deepEqual(failed, [`${SITE}/blank`, `${SITE}/none`]);
  assert.equal(findings[0].selector, 'head > title');
});

test('seo.title.multiple fails html pages with more than one title, including noindex pages', () => {
  const pages = [
    makePage({ url: `${SITE}/one` }),
    makePage({ url: `${SITE}/two`, titles: ['First', 'Second'] }),
    makePage({ url: `${SITE}/hidden`, titles: ['A', 'B'], indexability: NOINDEX }),
    makePage({ url: `${SITE}/error`, status: 404, titles: ['A', 'B'], indexability: { indexable: false, reasons: ['status_404'] } }),
  ];
  const { units, failed, findings } = audit('seo.title.multiple', { pages });
  assert.deepEqual(units, [`${SITE}/hidden`, `${SITE}/one`, `${SITE}/two`]);
  assert.deepEqual(failed, [`${SITE}/hidden`, `${SITE}/two`]);
  assert.deepEqual(findings.find((f) => f.url === `${SITE}/two`)?.evidence.observed, ['First', 'Second']);
});

test('seo.title.duplicate fails every page of a group, ignoring case and spacing, and lists the others', () => {
  const pages = [
    makePage({ url: `${SITE}/a`, titles: ['Blue  Widgets'] }),
    makePage({ url: `${SITE}/b`, titles: ['blue widgets'] }),
    makePage({ url: `${SITE}/c`, titles: [' BLUE WIDGETS '] }),
    makePage({ url: `${SITE}/d`, titles: ['Red widgets'] }),
    makePage({ url: `${SITE}/hidden`, titles: ['Blue widgets'], indexability: NOINDEX }),
    makePage({ url: `${SITE}/untitled`, titles: [''] }),
  ];
  const { units, failed, findings } = audit('seo.title.duplicate', { pages });
  assert.deepEqual(units, [`${SITE}/a`, `${SITE}/b`, `${SITE}/c`, `${SITE}/d`]);
  assert.deepEqual(failed, [`${SITE}/a`, `${SITE}/b`, `${SITE}/c`]);
  assert.deepEqual(findings[0].related_urls, [`${SITE}/b`, `${SITE}/c`]);
  assert.deepEqual(findings[1].related_urls, [`${SITE}/a`, `${SITE}/c`]);
  assert.deepEqual(findings[2].related_urls, [`${SITE}/a`, `${SITE}/b`]);
  assert.equal(findings[0].selector, 'head > title');
  assert.match(findings[0].evidence.detail ?? '', /2 other pages/);
  assert.deepEqual(findings[0].evidence.observed, { pages_with_same_title: 3 });
});

test('seo.title.duplicate evidence stays small however long the shared title is', () => {
  const huge = 'Long title '.repeat(10_000);
  const pages = [makePage({ url: `${SITE}/a`, titles: [huge] }), makePage({ url: `${SITE}/b`, titles: [huge] })];
  const { findings } = audit('seo.title.duplicate', { pages });
  assert.equal(findings.length, 2);
  for (const finding of findings) assert.ok(JSON.stringify(finding.evidence).length < 200);
});

test('arialWidthPx uses Arial advance widths, a default width and full-width CJK', () => {
  assert.equal(arialWidthPx('W', 2048), 1933);
  assert.equal(arialWidthPx('i', 2048), 455);
  assert.equal(arialWidthPx('ş', 2048), 1024);
  assert.equal(arialWidthPx('ก', 2048), 1139);
  assert.equal(arialWidthPx('日', 20), 20);
  assert.equal(arialWidthPx('ş', 2048), 1024);
});

test('seo.title.too_long fails titles wider than 580 px and reports the estimate', () => {
  const pages = [
    makePage({ url: `${SITE}/wide`, titles: ['W'.repeat(31)] }),
    makePage({ url: `${SITE}/fits`, titles: ['W'.repeat(30)] }),
    makePage({ url: `${SITE}/cjk-edge`, titles: ['日'.repeat(29)] }),
    makePage({ url: `${SITE}/cjk-over`, titles: ['日'.repeat(30)] }),
    makePage({ url: `${SITE}/hidden`, titles: ['W'.repeat(40)], indexability: NOINDEX }),
    makePage({ url: `${SITE}/untitled`, titles: [] }),
  ];
  const { units, failed, findings } = audit('seo.title.too_long', { pages });
  assert.deepEqual(units, [`${SITE}/cjk-edge`, `${SITE}/cjk-over`, `${SITE}/fits`, `${SITE}/wide`]);
  assert.deepEqual(failed, [`${SITE}/cjk-over`, `${SITE}/wide`]);
  const wide = findings.find((f) => f.url === `${SITE}/wide`);
  assert.deepEqual(wide?.evidence.observed, { characters: 31, estimated_px: 585 });
  assert.equal(wide?.evidence.expected, '580 px or less');
});

test('seo.title.too_short fails titles under 10 characters', () => {
  const pages = [
    makePage({ url: `${SITE}/short`, titles: ['Home'] }),
    makePage({ url: `${SITE}/ten`, titles: ['Ten chars!'] }),
    makePage({ url: `${SITE}/hidden`, titles: ['Hi'], indexability: NOINDEX }),
  ];
  const { units, failed, findings } = audit('seo.title.too_short', { pages });
  assert.deepEqual(units, [`${SITE}/short`, `${SITE}/ten`]);
  assert.deepEqual(failed, [`${SITE}/short`]);
  assert.deepEqual(findings[0].evidence.observed, { characters: 4, title: 'Home' });
});
