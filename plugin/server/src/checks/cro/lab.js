// Lighthouse's target size and console error audits of the tested pages, from
// the same PageSpeed Insights test as the lab Core Web Vitals (cro module). Pure.

/** @import { CheckContext, CheckDef, CheckResult, LabAudit } from '../../types.js' */

import { CRO, DOCS } from './helpers.js';

/**
 * One result per tested page whose lab test returned the audit; it fails when
 * the audit's score is below 1.
 * @param {CheckContext} ctx
 * @param {'target_size'|'console_errors'} name
 * @param {(audit: LabAudit) => Record<string, unknown>} observed
 * @param {string} expected
 * @returns {CheckResult[]}
 */
function byAudit(ctx, name, observed, expected) {
  /** @type {CheckResult[]} */
  const results = [];
  for (const page of ctx.vitals?.pages ?? []) {
    const audit = page.lab?.audits?.[name] ?? null;
    if (audit === null) continue;
    results.push(audit.score >= 1 ? { status: 'pass', url: page.url } : {
      status: 'fail', url: page.url,
      evidence: { observed: { ...observed(audit), lighthouse_version: page.lab?.lighthouse_version ?? null }, expected },
    });
  }
  return results;
}

/** @type {CheckDef} */
const targetSize = {
  ...CRO,
  id: 'cro.lab.target_size',
  title: 'Tap targets too small on a phone',
  description:
    'Reads Lighthouse\'s target-size audit (accessibility) of the pages PageSpeed Insights tested on an emulated phone. WCAG 2.5.8 (level AA) asks for targets of at least 24 by 24 CSS pixels, or enough space around smaller ones; buttons and links below that are hard to hit. A lab test is one simulated load, which is why the finding is likely.',
  severity: 'low',
  weight: 2,
  impact: 2,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: ['lab_audits'],
  doc_ref: DOCS.WCAG_258,
  recommendation: 'Make buttons and links at least 24 by 24 CSS pixels, or space small ones apart; the PageSpeed Insights report of the page names them.',
  run(ctx) {
    return byAudit(ctx, 'target_size', (audit) => ({ targets: audit.items }), 'Every target at least 24 × 24 CSS pixels, or spaced apart');
  },
};

/** @type {CheckDef} */
const consoleErrors = {
  ...CRO,
  id: 'cro.lab.console_errors',
  title: 'Browser errors logged while the page loads',
  description:
    'Reads Lighthouse\'s errors-in-console audit (best practices) of the tested pages: "Lighthouse flags all browser errors logged to the console". An error can stop a form or a button from working, or be harmless noise from a third-party script; the audit does not tell which, so this is information.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: ['lab_audits'],
  doc_ref: DOCS.LH_CONSOLE,
  recommendation: 'Open the page with the browser\'s developer tools and fix the errors its console shows, starting with those from your own scripts.',
  run(ctx) {
    return byAudit(ctx, 'console_errors', (audit) => ({ errors: audit.items }), 'No browser error in the console while the page loads');
  },
};

export const labChecks = [targetSize, consoleErrors];
