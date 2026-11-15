// Questions the cro checks share (forms and contact paths). Pure.

/** @import { CheckContext, ControlRecord, FormsRecord, PageRecord } from '../../types.js' */

import { MAX_SEEN_CONTROLS } from '../../extract/forms.js';
import { clip } from '../../util/strings.js';

/** The date every rule of this module was read against its documentation. */
export const VERIFIED = '2026-11-14';

/** Fields that are the same for every cro check. */
export const CRO = Object.freeze({
  module: /** @type {const} */ ('cro'),
  engine: /** @type {const} */ ('code'),
  last_verified: VERIFIED,
});

/** Official documentation the rules are based on (CHECKS-SPEC, reference list). */
export const DOCS = Object.freeze({
  WCAG_F68: 'https://www.w3.org/WAI/WCAG22/Techniques/failures/F68',
  WEBDEV_SIGN_IN: 'https://web.dev/articles/sign-in-form-best-practices',
  WCAG_135: 'https://www.w3.org/WAI/WCAG22/Understanding/identify-input-purpose.html',
  HTML_AUTOFILL: 'https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill',
  WEBDEV_FORMS: 'https://web.dev/articles/payment-and-address-form-best-practices',
  LH_PASTE: 'https://developer.chrome.com/docs/lighthouse/best-practices/paste-preventing-inputs',
  CHROMIUM_MIXED_FORMS: 'https://blog.chromium.org/2020/08/protecting-google-chrome-users-from.html',
  RFC_3966: 'https://www.rfc-editor.org/rfc/rfc3966',
  BAYMARD_FIELDS: 'https://baymard.com/research-articles/checkout-flow-average-form-fields',
  WCAG_258: 'https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html',
  LH_CONSOLE: 'https://developer.chrome.com/docs/lighthouse/best-practices/errors-in-console',
});

/** Failing controls named in a finding's evidence. */
export const MAX_NAMED = 5;

/**
 * @typedef {PageRecord & {forms: FormsRecord}} FormPage
 */

/**
 * The html pages whose forms were read (rule set 0.2.1 and later, and the reading did not fail).
 * @param {CheckContext} ctx
 * @returns {FormPage[]}
 */
export function formPages(ctx) {
  return /** @type {FormPage[]} */ (ctx.htmlPages.filter((page) => page.forms !== undefined && page.forms.failed !== true));
}

/**
 * True when a visible control is a form field: it belongs to a form, or, outside any form, it has a name and is not a
 * checkbox or radio button. A checkbox or radio button outside a form, and a control with neither a name nor a form,
 * submits nothing: such controls are menus, accordions and sliders built with style sheets (validation of
 * 2026-11-14: footer accordions and a menu toggle were the false findings of `control_unnamed`).
 * @param {ControlRecord} control
 */
export const isField = (control) => control.form !== null || (control.name !== null && control.type !== 'checkbox' && control.type !== 'radio');

/**
 * The form fields of a page with their index among its visible controls (for `controlSelector`).
 * @param {FormPage} page
 * @returns {{control: ControlRecord, index: number}[]}
 */
export const pageFields = (page) => page.forms.controls.map((control, index) => ({ control, index })).filter(({ control }) => isField(control));

/**
 * What a finding must say when part of a page's controls was not judged: the visible controls past the kept ones
 * (`visible_controls`), those deeper than the reading looks (`unjudged_controls`) and those whose name could not be
 * known (`named_by: 'unknown'`, only for the checks of names, `withNames`). Empty when everything was judged.
 * @param {FormPage} page
 * @param {boolean} [withNames]
 * @returns {{observed: Record<string, number>, detail: string}|null}
 */
export function notJudged(page, withNames = false) {
  const { forms } = page;
  const past = forms.visible_controls !== undefined ? forms.visible_controls - forms.controls.length : 0;
  const deep = forms.unjudged_controls ?? 0;
  const unread = forms.unread_controls ?? 0;
  const unknown = withNames ? forms.controls.filter((control) => control.named_by === 'unknown').length : 0;
  if (past + deep + unknown + unread === 0) return null;
  const parts = [
    ...(past > 0 ? [`${past} visible controls past the first ${forms.controls.length} kept`] : []),
    ...(deep > 0 ? [`${deep} nested deeper than the reading looks`] : []),
    ...(unknown > 0 ? [`${unknown} named by an id past the ids the reading keeps`] : []),
    ...(unread > 0 ? [`${unread} controls past the first ${MAX_SEEN_CONTROLS} looked at, not read`] : []),
  ];
  return { observed: { not_judged: past + deep + unknown + unread }, detail: `Not judged on this page: ${parts.join('; ')}.` };
}

/**
 * A stable locator for a control: its name, else its id, else its place among the page's visible controls.
 * @param {ControlRecord} control
 * @param {number} index  Its index in `FormsRecord.controls`.
 */
export function controlSelector(control, index) {
  if (control.name !== null) return `${control.tag}[name="${control.name}"]`;
  if (control.id !== null) return `${control.tag}[id="${control.id}"]`;
  return `${control.tag} (visible control ${index + 1})`;
}

/**
 * What a finding says about one control: tag, type, name or id, line.
 * @param {ControlRecord} control
 */
export function describeControl(control) {
  return { tag: control.tag, type: control.type, name: control.name ?? control.id, line: control.line };
}

/** @param {string} value */
const fold = (value) => value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/**
 * The words of a control's name and id: split at anything that is not a letter or digit and at a change from lower to
 * upper case, accents removed ("billingFirstName" and "billing_first-name" read "billing first name").
 * @param {ControlRecord} control
 */
export function nameWords(control) {
  return ` ${fold(`${control.name ?? ''} ${control.id ?? ''}`).split(/[^a-z0-9]+/).filter(Boolean).join(' ')} `;
}

/**
 * Kinds of information about the visitor, by the words of a field's name or id, in English, Turkish, German, Spanish,
 * French, Italian, Portuguese and Dutch. Each pattern matches whole words of `nameWords`.
 */
const KINDS = /** @type {const} */ ([
  ['email', / (?:e ?mail|email ?address|emailaddress|mail|e ?posta|eposta|correo|courriel|epost) /],
  ['phone', / (?:phone|phonenumber|telephone|tel|telefon|telefono|telefone|mobile|mobil|cell|cellphone|gsm|handy|celular|portable|cep ?tel(?:efon|efonu)?|telefonnummer) /],
  ['name', / (?:name|full ?name|first ?name|last ?name|fname|lname|surname|given ?name|family ?name|vorname|nachname|nombre|apellidos?|prenom|nom|nome|cognome|sobrenome|ad ?soyad|soyad|soyadi|isim|voornaam|achternaam|naam) /],
  ['address', / (?:address|address ?[123]|addr|street|adres|adresi|adresse|direccion|endereco|indirizzo|strasse) /],
  ['postal_code', / (?:zip|zip ?code|postcode|postal|postal ?code|plz|postleitzahl|codigo ?postal|code ?postal|posta ?kodu|postakodu) /],
  ['city', / (?:city|town|sehir|ilce|ciudad|ville|stadt|citta|cidade|plaats) /],
  ['country', / (?:country|ulke|pais|pays|paese) /],
  ['card_number', / (?:card ?number|cardnumber|cc ?number|ccnumber|credit ?card|kart ?no|kart ?numarasi) /],
  ['username', / (?:username|user ?name|kullanici ?adi) /],
]);

/** Words that make a field something other than the visitor's own details ("domain name", "file name", "product name"). */
const NOT_PERSONAL = / (?:domain|file|filename|product|search|coupon|promo|voucher|gift|discount|captcha|subject|message|comment) /;

/**
 * The kind of information about the visitor a control's name or id names, or null.
 * @param {ControlRecord} control
 * @returns {string|null}
 */
export function fieldKind(control) {
  const words = nameWords(control);
  if (NOT_PERSONAL.test(words)) return null;
  for (const [kind, pattern] of KINDS) {
    if (pattern.test(words)) return kind;
  }
  return null;
}

/** Input types a visitor types personal details into. */
const ENTRY_TYPES = new Set(['text', 'email', 'tel', 'password', 'number', 'url']);

/**
 * True when the control is one a visitor types or picks their own details in: an input of a text-entry type, a
 * `textarea`, or a `select` (a country).
 * @param {ControlRecord} control
 */
export const isEntry = (control) => control.tag !== 'input' || ENTRY_TYPES.has(control.type);

/**
 * The control's purpose as WCAG 1.3.5 reads it: from its type (email, tel, password), else from its name or id;
 * null when neither names information about the visitor.
 * @param {ControlRecord} control
 * @returns {string|null}
 */
export function personalPurpose(control) {
  if (!isEntry(control)) return null;
  if (control.tag === 'input' && control.type === 'email') return 'email';
  if (control.tag === 'input' && control.type === 'tel') return 'phone';
  if (control.tag === 'input' && control.type === 'password') return 'password';
  return fieldKind(control);
}

/**
 * The selector of a link by the address it gives, clipped.
 * @param {string} href
 */
export const linkSelector = (href) => `a[href="${clip(href.trim(), 100)}"]`;
