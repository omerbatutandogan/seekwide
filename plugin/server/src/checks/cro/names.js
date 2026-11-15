// Whether the visible controls of a page have a name (cro module). Pure.

/** @import { CheckContext, CheckDef, CheckResult, NameSource } from '../../types.js' */

import { CRO, DOCS, MAX_NAMED, controlSelector, describeControl, formPages, notJudged, pageFields } from './helpers.js';

/**
 * One result per html page with one or more form fields (`isField`): a failure names the first field whose name source is
 * one of `failing`, and up to `MAX_NAMED` of them.
 * @param {CheckContext} ctx
 * @param {Set<NameSource>} failing
 * @param {string} expected
 * @returns {CheckResult[]}
 */
function byName(ctx, failing, expected) {
  /** @type {CheckResult[]} */
  const results = [];
  for (const page of formPages(ctx)) {
    // A field whose name could not be known is not judged.
    const fields = pageFields(page).filter(({ control }) => control.named_by !== 'unknown');
    if (fields.length === 0) continue;
    const bad = fields.filter(({ control }) => failing.has(control.named_by));
    if (bad.length === 0) {
      results.push({ status: 'pass', url: page.url });
      continue;
    }
    const first = bad[0];
    const skipped = notJudged(page, true);
    results.push({
      status: 'fail', url: page.url, selector: controlSelector(first.control, first.index), line: first.control.line,
      evidence: {
        observed: { controls: bad.length, of: fields.length, ...(skipped?.observed ?? {}), examples: bad.slice(0, MAX_NAMED).map(({ control }) => describeControl(control)) },
        expected,
        ...(skipped ? { detail: skipped.detail } : {}),
      },
    });
  }
  return results;
}

/** @type {CheckDef} */
const controlUnnamed = {
  ...CRO,
  id: 'cro.form.control_unnamed',
  title: 'Form control without a name',
  description:
    'Checks the form fields of html pages (visible inputs a visitor fills in, select and textarea that belong to a form, or have a name outside one; a checkbox outside a form is a menu or accordion toggle) for a name assistive technology can announce: a <label> tied to it with for or wrapped around it, aria-labelledby, aria-label, title or a placeholder. WCAG failure F68: without one, some visitors cannot tell what the field is for. Only the served HTML is read; a label added by a script is not seen.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['form_pages'],
  doc_ref: DOCS.WCAG_F68,
  recommendation: 'Give every visible field a <label for="…"> with text (or wrap the field in its <label>). Where no visible label fits, use aria-label.',
  run(ctx) {
    return byName(ctx, new Set(['none']), 'A label, aria-labelledby, aria-label, title or placeholder on every visible control');
  },
};

/** @type {CheckDef} */
const placeholderOnly = {
  ...CRO,
  id: 'cro.form.placeholder_only',
  title: 'Field named only by its placeholder',
  description:
    'Checks the visible form controls of html pages for a field whose only name is its placeholder text. web.dev: "Don\'t use placeholders as input labels"; the hint disappears once the visitor types, and Nielsen Norman Group recommends a visible label outside the field.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: ['form_pages'],
  doc_ref: DOCS.WEBDEV_SIGN_IN,
  recommendation: 'Add a visible <label> for each such field and keep the placeholder, if at all, for an example value.',
  run(ctx) {
    return byName(ctx, new Set(['placeholder']), 'A visible label besides the placeholder');
  },
};

export const nameChecks = [controlUnnamed, placeholderOnly];
