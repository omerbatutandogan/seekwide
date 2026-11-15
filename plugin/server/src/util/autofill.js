// The grammar of the autocomplete attribute of a form control, as the HTML
// standard gives it (read 2026-11-14 at
// https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#autofill).
// Pure.

/** Autofill field names that are not contact information. */
const FIELD_NAMES = new Set([
  'name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name', 'honorific-suffix', 'nickname', 'organization-title',
  'username', 'new-password', 'current-password', 'one-time-code', 'organization', 'street-address', 'address-line1', 'address-line2',
  'address-line3', 'address-level4', 'address-level3', 'address-level2', 'address-level1', 'country', 'country-name', 'postal-code',
  'cc-name', 'cc-given-name', 'cc-additional-name', 'cc-family-name', 'cc-number', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-csc',
  'cc-type', 'transaction-currency', 'transaction-amount', 'language', 'bday', 'bday-day', 'bday-month', 'bday-year', 'sex', 'url', 'photo',
]);
/** Contact field names, which may follow home, work, mobile, fax or pager. */
const CONTACT_NAMES = new Set(['tel', 'tel-country-code', 'tel-national', 'tel-area-code', 'tel-local', 'tel-local-prefix', 'tel-local-suffix', 'tel-extension', 'email', 'impp']);
const CONTACT_KINDS = new Set(['home', 'work', 'mobile', 'fax', 'pager']);
const ADDRESS_KINDS = new Set(['shipping', 'billing']);

/**
 * True when an autocomplete value follows the standard's grammar, compared in
 * ASCII lower case: a single `on` or `off`; or an optional `section-*` token,
 * an optional `shipping` or `billing`, then a field name, or an optional
 * `home`, `work`, `mobile`, `fax` or `pager` followed by a contact field name,
 * then an optional `webauthn`. An empty value has no token to judge and is
 * not called invalid here.
 * @param {string} value
 * @returns {boolean}
 */
export function isValidAutocomplete(value) {
  // The standard compares in ASCII lower case and splits at ASCII whitespace: a non-ASCII space stays inside a token.
  const tokens = value.replace(/[A-Z]/g, (letter) => letter.toLowerCase()).split(/[\t\n\f\r ]+/).filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length === 1 && (tokens[0] === 'on' || tokens[0] === 'off')) return true;
  let at = 0;
  if (tokens[at]?.startsWith('section-')) at += 1;
  if (ADDRESS_KINDS.has(tokens[at] ?? '')) at += 1;
  if (CONTACT_KINDS.has(tokens[at] ?? '')) {
    at += 1;
    if (!CONTACT_NAMES.has(tokens[at] ?? '')) return false;
  } else if (!FIELD_NAMES.has(tokens[at] ?? '') && !CONTACT_NAMES.has(tokens[at] ?? '')) {
    return false;
  }
  at += 1;
  if (tokens[at] === 'webauthn') at += 1;
  return at === tokens.length;
}

/**
 * True when the value states no purpose: absent, empty, `on` or `off`.
 * @param {string|null} value
 */
export const statesNoPurpose = (value) => value === null || ['', 'on', 'off'].includes(value.replace(/[A-Z]/g, (letter) => letter.toLowerCase()).replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, ''));
