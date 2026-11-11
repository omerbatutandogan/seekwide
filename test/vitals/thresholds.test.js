import assert from 'node:assert/strict';
import { test } from 'node:test';

import { THRESHOLDS, formatMetric, goodRange, rateMetric } from '../../server/src/vitals/thresholds.js';

test('the thresholds are the documented ones', () => {
  assert.deepEqual(THRESHOLDS, {
    lcp_ms: { good: 2500, poor: 4000 },
    inp_ms: { good: 200, poor: 500 },
    cls: { good: 0.1, poor: 0.25 },
    tbt_ms: { good: 200, poor: 600 },
  });
  assert.ok(Object.isFrozen(THRESHOLDS) && Object.isFrozen(THRESHOLDS.lcp_ms));
});

test('a value on a boundary belongs to the better range', () => {
  for (const [metric, { good, poor }] of /** @type {[import('../../server/src/vitals/thresholds.js').VitalsMetric, {good: number, poor: number}][]} */ (Object.entries(THRESHOLDS))) {
    const step = metric === 'cls' ? 0.001 : 1;
    assert.equal(rateMetric(metric, 0), 'good', metric);
    assert.equal(rateMetric(metric, good), 'good', metric);
    assert.equal(rateMetric(metric, good + step), 'needs improvement', metric);
    assert.equal(rateMetric(metric, poor), 'needs improvement', metric);
    assert.equal(rateMetric(metric, poor + step), 'poor', metric);
  }
});

test('values are shown the way people read them', () => {
  assert.equal(formatMetric('lcp_ms', 2400), '2.400 s');
  assert.equal(formatMetric('lcp_ms', 10885), '10.885 s');
  assert.equal(formatMetric('lcp_ms', 3000), '3.000 s', 'seconds always have three decimals, so a column lines up');
  assert.equal(formatMetric('lcp_ms', 2400.4), '2.400 s');
  assert.equal(formatMetric('inp_ms', 180), '180 ms');
  assert.equal(formatMetric('tbt_ms', 1055), '1055 ms');
  assert.equal(formatMetric('cls', 0.05), '0.05');
  assert.equal(formatMetric('cls', 0.104), '0.104');
});

test('a shown value never contradicts its rating', () => {
  // Rounded to one decimal, 2549 ms would read "2.5 s" next to "needs improvement".
  assert.equal(formatMetric('lcp_ms', 2500), '2.500 s');
  assert.equal(rateMetric('lcp_ms', 2500), 'good');
  assert.equal(formatMetric('lcp_ms', 2501), '2.501 s');
  assert.equal(formatMetric('lcp_ms', 2549), '2.549 s');
  assert.equal(rateMetric('lcp_ms', 2549), 'needs improvement');
  assert.equal(formatMetric('lcp_ms', 4001), '4.001 s');
  assert.equal(rateMetric('lcp_ms', 4001), 'poor');
  for (let ms = 2400; ms <= 4100; ms += 1) {
    const shown = Number.parseFloat(formatMetric('lcp_ms', ms)) * 1000;
    assert.equal(rateMetric('lcp_ms', Math.round(shown)), rateMetric('lcp_ms', ms), `${ms} ms is shown as ${formatMetric('lcp_ms', ms)}`);
  }
});

test('the good range is given in the unit of the metric', () => {
  assert.equal(goodRange('lcp_ms'), '2500 ms or less');
  assert.equal(goodRange('inp_ms'), '200 ms or less');
  assert.equal(goodRange('tbt_ms'), '200 ms or less');
  assert.equal(goodRange('cls'), '0.1 or less');
});
