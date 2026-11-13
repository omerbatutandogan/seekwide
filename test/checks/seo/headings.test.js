import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makePage } from '../../helpers/factories.js';
import { audit } from './helpers.js';

/** @import { Heading } from '../../../plugin/server/src/types.js' */

const NOINDEX = { indexable: false, reasons: ['noindex_meta'] };

/**
 * @param {number[]} levels
 * @param {string[]} [texts]
 * @returns {Heading[]}
 */
function headings(levels, texts = []) {
  return levels.map((level, index) => ({
    level: /** @type {Heading['level']} */ (level),
    text: texts[index] ?? `Heading ${index + 1}`,
    line: 10 + index,
  }));
}

test('seo.h1.missing fails indexable pages without an h1 that has text', () => {
  const pages = [
    makePage({ url: `${SITE}/ok` }),
    makePage({ url: `${SITE}/none`, headings: headings([2, 3]) }),
    makePage({ url: `${SITE}/empty`, headings: headings([1, 2], ['  ']) }),
    makePage({ url: `${SITE}/hidden`, headings: [], indexability: NOINDEX }),
  ];
  const { units, failed, findings } = audit('seo.h1.missing', { pages });
  assert.deepEqual(units, [`${SITE}/empty`, `${SITE}/none`, `${SITE}/ok`]);
  assert.deepEqual(failed, [`${SITE}/empty`, `${SITE}/none`]);
  assert.equal(findings[0].selector, 'h1');
  assert.equal(findings[0].evidence.observed, 'Only empty <h1> elements');
});

test('seo.h1.multiple fails pages with two h1 headings that have text', () => {
  const pages = [
    makePage({ url: `${SITE}/two`, headings: headings([1, 2, 1], ['Main', 'Section', 'Another']) }),
    makePage({ url: `${SITE}/one-plus-empty`, headings: headings([1, 1], ['Main', '']) }),
    makePage({ url: `${SITE}/hidden`, headings: headings([1, 1]), indexability: NOINDEX }),
  ];
  const { units, failed, findings } = audit('seo.h1.multiple', { pages });
  assert.deepEqual(units, [`${SITE}/one-plus-empty`, `${SITE}/two`]);
  assert.deepEqual(failed, [`${SITE}/two`]);
  assert.equal(findings[0].line, 12);
  assert.deepEqual(findings[0].evidence.observed, ['Main', 'Another']);
});

test('seo.headings.skipped_level fails a heading more than one level deeper than the one before it', () => {
  const pages = [
    makePage({ url: `${SITE}/skip`, headings: headings([1, 2, 4, 2], ['T', 'S', 'Deep', 'S2']) }),
    makePage({ url: `${SITE}/fine`, headings: headings([1, 2, 3, 2, 3, 1]) }),
    makePage({ url: `${SITE}/starts-deep`, headings: headings([3, 4]) }),
    makePage({ url: `${SITE}/no-headings`, headings: [] }),
    makePage({ url: `${SITE}/hidden`, headings: headings([1, 4]), indexability: NOINDEX }),
  ];
  const { units, failed, findings } = audit('seo.headings.skipped_level', { pages });
  assert.deepEqual(units, [`${SITE}/fine`, `${SITE}/skip`, `${SITE}/starts-deep`]);
  assert.deepEqual(failed, [`${SITE}/skip`]);
  assert.equal(findings[0].line, 12);
  assert.equal(findings[0].evidence.observed, 'h2 → h4');
  assert.match(findings[0].evidence.detail ?? '', /"Deep"/);
});
