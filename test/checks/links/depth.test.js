import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makePage } from '../../helpers/factories.js';
import { audit, findingsFor, statFor } from './support.js';

const ID = 'links.depth.deep';

test('links.depth.deep fails for indexable pages more than 4 clicks from the start page', () => {
  const pages = [
    makePage({ url: `${SITE}/`, depth: 0 }),
    makePage({ url: `${SITE}/four`, depth: 4 }),
    makePage({ url: `${SITE}/five`, depth: 5 }),
    makePage({ url: `${SITE}/seven`, depth: 7 }),
  ];

  const { result } = audit(pages);
  const stat = statFor(result, ID);
  assert.equal(stat.applicable, 4);
  assert.equal(stat.passed, 2);
  assert.equal(stat.failed, 2);

  const findings = findingsFor(result, ID);
  assert.deepEqual(findings.map((f) => f.url), [`${SITE}/five`, `${SITE}/seven`]);
  assert.equal(findings[0].severity, 'info');
  assert.equal(findings[0].weight, 0);
  assert.equal(findings[0].selector, null);
  assert.deepEqual(findings[0].evidence.observed, { depth: 5 });
  assert.equal(findings[0].evidence.expected, '4 clicks or fewer from the start page');
});

test('links.depth.deep leaves out pages without a depth and pages that are not indexable', () => {
  const pages = [
    makePage({ url: `${SITE}/`, depth: 0 }),
    makePage({ url: `${SITE}/sitemap-only`, depth: null, discovered_via: ['sitemap'] }),
    makePage({
      url: `${SITE}/hidden`,
      depth: 9,
      meta_robots: ['noindex'],
      indexability: { indexable: false, reasons: ['noindex_meta'] },
    }),
  ];

  const { result } = audit(pages);
  const stat = statFor(result, ID);
  assert.equal(stat.applicable, 1);
  assert.equal(stat.failed, 0);
  assert.equal(findingsFor(result, ID).length, 0);
});
