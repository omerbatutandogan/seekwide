/** @import { CheckContext, CheckDef, CheckResult, FieldRecord } from '../../types.js' */

// Core Web Vitals. The numbers were collected before the checks run
// (vitals/measure.js) and are read from `ctx.vitals`; nothing here does I/O.
// Field checks compare the 75th percentile of real Chrome users on phones,
// lab checks one simulated load on an emulated phone.

import { clip } from '../../util/strings.js';
import { goodRange, rateMetric } from '../../vitals/thresholds.js';
import { DOCS, SEO } from './common.js';

/**
 * One result for the site's origin and one for each tested page, wherever the
 * Chrome UX Report has a value for the metric.
 * @param {CheckContext} ctx
 * @param {'lcp_ms'|'inp_ms'|'cls'} metric
 * @returns {CheckResult[]}
 */
function fieldResults(ctx, metric) {
  const { vitals } = ctx;
  if (vitals === null) return [];
  /** @type {CheckResult[]} */
  const results = [];

  /**
   * @param {string|null} url
   * @param {FieldRecord|null} record
   * @param {string} where
   */
  const add = (url, record, where) => {
    const value = record?.[metric];
    if (!record || !value) return;
    const unit = url === null ? { url, selector: 'origin' } : { url };
    const rating = rateMetric(metric, value.p75);
    if (rating === 'good') {
      results.push({ status: 'pass', ...unit });
      return;
    }
    const period = record.period ? `, ${record.period.first} to ${record.period.last}` : '';
    results.push({
      status: 'fail',
      ...unit,
      evidence: {
        observed: {
          [metric === 'cls' ? 'p75' : 'p75_ms']: value.p75,
          rating,
          ...(value.good === null ? {} : { good_loads: `${Math.round(value.good * 100)}%` }),
        },
        expected: `A 75th percentile of ${goodRange(metric)}`,
        detail: `Real Chrome users on phones${period}, ${where}.`,
      },
    });
  };

  add(null, vitals.origin.field, `across the whole site (${clip(vitals.origin.origin)})`);
  for (const page of vitals.pages) add(page.url, page.field, 'on this page');
  return results;
}

/**
 * One result for each tested page that has a lab value for the metric.
 * @param {CheckContext} ctx
 * @param {'lcp_ms'|'cls'|'tbt_ms'} metric
 * @returns {CheckResult[]}
 */
function labResults(ctx, metric) {
  const { vitals } = ctx;
  if (vitals === null) return [];
  /** @type {CheckResult[]} */
  const results = [];
  for (const page of vitals.pages) {
    const value = page.lab?.[metric];
    if (!page.lab || value === null || value === undefined) continue;
    const rating = rateMetric(metric, value);
    if (rating === 'good') {
      results.push({ status: 'pass', url: page.url });
      continue;
    }
    const version = page.lab.lighthouse_version ? ` (Lighthouse ${page.lab.lighthouse_version})` : '';
    // The values belong to the page the test ended on, which a redirect can make another one.
    const redirected = page.lab.final_url ? ` Google was redirected to ${clip(page.lab.final_url)} and tested that page.` : '';
    results.push({
      status: 'fail',
      url: page.url,
      evidence: {
        observed: { [metric]: value, rating },
        expected: goodRange(metric),
        detail: `One simulated load on an emulated mid-range phone${version}. Lab values change from run to run.${redirected}`,
      },
    });
  }
  return results;
}

/**
 * @param {Pick<CheckDef, 'id'|'title'|'description'|'recommendation'|'doc_ref'|'impact'|'effort'> & {metric: 'lcp_ms'|'inp_ms'|'cls'}} spec
 * @returns {CheckDef}
 */
function fieldCheck({ metric, ...spec }) {
  return {
    ...SEO,
    ...spec,
    severity: 'medium',
    weight: 3,
    confidence: 'confirmed',
    scope: 'page',
    requires: ['field_data'],
    run: (ctx) => fieldResults(ctx, metric),
  };
}

/**
 * @param {Pick<CheckDef, 'id'|'title'|'description'|'recommendation'|'doc_ref'|'impact'|'effort'|'weight'> & {metric: 'lcp_ms'|'cls'|'tbt_ms'}} spec
 * @returns {CheckDef}
 */
function labCheck({ metric, ...spec }) {
  return {
    ...SEO,
    ...spec,
    severity: 'low',
    confidence: 'likely',
    scope: 'page',
    requires: ['lab_data'],
    run: (ctx) => labResults(ctx, metric),
  };
}

const FIELD_SCOPE = 'for the whole site and for each tested page that has data of its own';

export const cwvChecks = [
  fieldCheck({
    id: 'seo.cwv.field_lcp',
    metric: 'lcp_ms',
    title: 'Largest Contentful Paint is slow for real users',
    description:
      `Checks the 75th percentile of Largest Contentful Paint among real Chrome users on phones, ${FIELD_SCOPE}. Google counts loading as good when the main content shows within 2.5 seconds.`,
    impact: 3,
    effort: 3,
    doc_ref: DOCS.LCP,
    recommendation:
      'Find the largest element of the page (often a hero image or a headline) and get it on screen sooner: speed up the server response, preload the image or font it needs, compress and size the image, and keep scripts and styles from delaying it.',
  }),
  fieldCheck({
    id: 'seo.cwv.field_inp',
    metric: 'inp_ms',
    title: 'Interaction to Next Paint is slow for real users',
    description:
      `Checks the 75th percentile of Interaction to Next Paint among real Chrome users on phones, ${FIELD_SCOPE}. Google counts a page as responsive when it reacts to a tap, click or key press within 200 milliseconds.`,
    impact: 2,
    effort: 3,
    doc_ref: DOCS.INP,
    recommendation:
      'Shorten the work the page does when someone interacts with it: break up long JavaScript tasks, remove or defer scripts the page does not need (third-party ones in particular), and keep event handlers small.',
  }),
  fieldCheck({
    id: 'seo.cwv.field_cls',
    metric: 'cls',
    title: 'Layout shifts too much for real users',
    description:
      `Checks the 75th percentile of Cumulative Layout Shift among real Chrome users on phones, ${FIELD_SCOPE}. Google counts a page as visually stable when the score is 0.1 or less.`,
    impact: 2,
    effort: 2,
    doc_ref: DOCS.CLS,
    recommendation:
      'Reserve the space of everything that loads late: give images, videos, ads and embeds a width and height or an aspect ratio, avoid inserting content above what is already on screen, and load web fonts so that text does not jump.',
  }),
  labCheck({
    id: 'seo.cwv.lab_lcp',
    metric: 'lcp_ms',
    title: 'Largest Contentful Paint is slow in a lab test',
    description:
      'Checks Largest Contentful Paint in one simulated load of each tested page on an emulated mid-range phone, run by PageSpeed Insights. Lighthouse counts 2.5 seconds or less as fast.',
    weight: 2,
    impact: 2,
    effort: 3,
    doc_ref: DOCS.LIGHTHOUSE_LCP,
    recommendation:
      'Open the page in PageSpeed Insights to see which element is the largest and what delays it, then speed up the server response, preload the image or font it needs, and compress and size the image. Test again to confirm, because lab values vary.',
  }),
  labCheck({
    id: 'seo.cwv.lab_cls',
    metric: 'cls',
    title: 'Layout shifts too much in a lab test',
    description:
      'Checks Cumulative Layout Shift in one simulated load of each tested page on an emulated phone, run by PageSpeed Insights. A lab test only sees shifts that happen while the page loads, so real visitors can experience more.',
    weight: 2,
    impact: 2,
    effort: 2,
    doc_ref: DOCS.CLS,
    recommendation:
      'Give images, videos, ads and embeds a width and height or an aspect ratio, and avoid inserting content above what is already on screen while the page loads.',
  }),
  labCheck({
    id: 'seo.cwv.lab_tbt',
    metric: 'tbt_ms',
    title: 'Main thread is blocked for too long in a lab test',
    description:
      'Checks Total Blocking Time in one simulated load of each tested page on an emulated mid-range phone, run by PageSpeed Insights. It is the lab stand-in for Interaction to Next Paint, which cannot be measured without a real user; Lighthouse counts 200 milliseconds or less as fast.',
    weight: 1,
    impact: 1,
    effort: 3,
    doc_ref: DOCS.LIGHTHOUSE_TBT,
    recommendation:
      'Reduce the JavaScript the page runs while it loads: remove unused code, defer or lazy-load third-party scripts, and split long tasks into smaller ones.',
  }),
];
