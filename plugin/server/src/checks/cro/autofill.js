// Autofill, input types and pasting in the visible controls of a page (cro module). Pure.

/** @import { CheckContext, CheckDef, CheckResult, ControlRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { isValidAutocomplete, statesNoPurpose } from '../../util/autofill.js';
import { CRO, DOCS, MAX_NAMED, controlSelector, describeControl, fieldKind, formPages, nameWords, notJudged, pageFields, personalPurpose } from './helpers.js';

/**
 * One result per html page with one or more form fields (`isField`) that `applies` accepts: a failure names the first that `fails`
 * accepts, and up to `MAX_NAMED` of them with what `detail` adds.
 * @param {CheckContext} ctx
 * @param {(control: ControlRecord) => boolean} applies
 * @param {(control: ControlRecord) => boolean} fails
 * @param {(control: ControlRecord) => Record<string, unknown>} detail
 * @param {string} expected
 * @returns {CheckResult[]}
 */
function perPage(ctx, applies, fails, detail, expected) {
  /** @type {CheckResult[]} */
  const results = [];
  for (const page of formPages(ctx)) {
    const units = pageFields(page).filter(({ control }) => applies(control));
    if (units.length === 0) continue;
    const bad = units.filter(({ control }) => fails(control));
    if (bad.length === 0) {
      results.push({ status: 'pass', url: page.url });
      continue;
    }
    const skipped = notJudged(page);
    results.push({
      status: 'fail', url: page.url, selector: controlSelector(bad[0].control, bad[0].index), line: bad[0].control.line,
      evidence: {
        observed: { controls: bad.length, of: units.length, ...(skipped?.observed ?? {}), examples: bad.slice(0, MAX_NAMED).map(({ control }) => ({ ...describeControl(control), ...detail(control) })) },
        expected,
        ...(skipped ? { detail: skipped.detail } : {}),
      },
    });
  }
  return results;
}

/** @param {ControlRecord} control */
const autocompleteOf = (control) => (control.autocomplete === null ? null : clip(control.autocomplete, 100));

/** @type {CheckDef} */
const autocompleteMissing = {
  ...CRO,
  id: 'cro.form.autocomplete_missing',
  title: 'Personal field without an autocomplete purpose',
  description:
    'Checks html pages with a field that asks for the visitor\'s own details (an email, tel or password input, or a field whose name or id says name, address, postal code, city, country, phone, email or card number, in eight languages) for an autocomplete value that states its purpose. WCAG 1.3.5 (level AA) asks that the purpose of such a field can be programmatically determined; browsers then fill it in. A field about someone else (a friend\'s email) is out of the criterion\'s scope and cannot be told apart by its name, which is why the finding is likely.',
  severity: 'low',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: ['form_pages'],
  doc_ref: DOCS.WCAG_135,
  recommendation: 'Add the matching autocomplete value to each such field, for example autocomplete="email", "tel", "given-name", "postal-code" or "current-password".',
  run(ctx) {
    return perPage(
      ctx,
      (control) => personalPurpose(control) !== null,
      (control) => statesNoPurpose(control.autocomplete),
      (control) => ({ purpose: personalPurpose(control), autocomplete: autocompleteOf(control) }),
      'An autocomplete value naming the field\'s purpose (not missing, empty, "on" or "off")',
    );
  },
};

/** @type {CheckDef} */
const autocompleteInvalid = {
  ...CRO,
  id: 'cro.form.autocomplete_invalid',
  title: 'Autocomplete value the HTML standard does not define',
  description:
    'Checks the visible form controls that have an autocomplete attribute for a value outside the HTML standard\'s grammar (a single on or off, or an optional section-*, shipping or billing, then a field name such as email or postal-code, then an optional webauthn). Values such as "nope", "false" or "new-field", often written to stop autofill, are not autofill tokens; browsers ignore them.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['form_pages'],
  doc_ref: DOCS.HTML_AUTOFILL,
  recommendation: 'Use a value the HTML standard defines: the field\'s purpose (email, tel, name, street-address, one-time-code…), or "off" where autofill is really unwanted.',
  run(ctx) {
    return perPage(
      ctx,
      (control) => control.autocomplete !== null,
      // The full value was judged when the page was read; a record made before that is judged on the kept value.
      (control) => (control.autocomplete_valid !== undefined && control.autocomplete_valid !== null ? !control.autocomplete_valid : !isValidAutocomplete(/** @type {string} */ (control.autocomplete))),
      (control) => ({ autocomplete: autocompleteOf(control) }),
      'on, off, or autofill detail tokens of the HTML standard',
    );
  },
};

/** Words of a field that takes either an email address or a user name, where a text type is right. */
const EITHER = / (?:or|user|username|login|kullanici|benutzer|usuario|utilisateur) /;

/**
 * Whether an input asks for an email address or a phone number, by its autocomplete value or its name or id.
 * @param {ControlRecord} control
 * @returns {'email'|'phone'|null}
 */
function emailOrPhone(control) {
  if (control.tag !== 'input' || EITHER.test(nameWords(control))) return null;
  const tokens = (control.autocomplete ?? '').toLowerCase().split(/\s+/);
  if (tokens.includes('email')) return 'email';
  if (tokens.some((token) => token === 'tel' || token === 'tel-national')) return 'phone';
  const kind = fieldKind(control);
  return kind === 'email' || kind === 'phone' ? kind : null;
}

/** @type {CheckDef} */
const inputTypeGeneric = {
  ...CRO,
  id: 'cro.form.input_type_generic',
  title: 'Email or phone field typed as plain text',
  description:
    'Checks inputs whose autocomplete value or name says email or phone for a type other than text. web.dev: "use type="email" for email addresses and type="tel" for phone numbers", which brings up the right keyboard on phones and the browser\'s own validation. A field that takes an email or a user name is left out; the name is read as written, which is why the finding is likely.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: ['form_pages'],
  doc_ref: DOCS.WEBDEV_FORMS,
  recommendation: 'Give email fields type="email" and phone fields type="tel".',
  run(ctx) {
    return perPage(
      ctx,
      (control) => emailOrPhone(control) !== null,
      (control) => control.type === 'text',
      (control) => ({ asks_for: emailOrPhone(control) }),
      'type="email" for an email address, type="tel" for a phone number',
    );
  },
};

/** @type {CheckDef} */
const pasteBlocked = {
  ...CRO,
  id: 'cro.form.paste_blocked',
  title: 'Pasting into a password or email field is blocked',
  description:
    'Checks password and email fields for an inline onpaste handler that returns false or calls preventDefault. Lighthouse flags inputs that prevent pasting: "users should not be prevented from pasting into <input> elements", which breaks password managers. A handler added by a script file is not seen.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['form_pages'],
  doc_ref: DOCS.LH_PASTE,
  recommendation: 'Remove the onpaste handler that blocks pasting, so that password managers and pasted addresses work.',
  run(ctx) {
    return perPage(
      ctx,
      (control) => ['password', 'email'].includes(/** @type {string} */ (personalPurpose(control))),
      (control) => control.paste_blocked,
      () => ({}),
      'No onpaste handler that blocks pasting',
    );
  },
};

export const autofillChecks = [autocompleteMissing, autocompleteInvalid, inputTypeGeneric, pasteBlocked];
