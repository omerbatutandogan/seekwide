// Where forms send their data, how long they are, and the tel: and mailto:
// links of a page (cro module). Pure. Nothing is ever submitted or requested:
// the action is read from the markup.

/** @import { CheckDef, CheckResult, FormRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { CRO, DOCS, MAX_NAMED, formPages, linkSelector } from './helpers.js';

/** Visible fields above which a form is called long; Baymard's figure for a whole checkout flow. */
export const FIELD_LIMIT = 8;

/**
 * @param {FormRecord} form @param {number} index
 * @returns {string} A stable locator for a form: its id, else its name, else its place among the page's forms.
 */
const formSelector = (form, index) => (form.id !== null ? `form[id="${form.id}"]` : form.name !== null ? `form[name="${form.name}"]` : `form (${index + 1} on the page)`);

/** @type {CheckDef} */
const actionInsecure = {
  ...CRO,
  id: 'cro.form.action_insecure',
  title: 'Form on an https page sends its data over http',
  description:
    'Checks forms of https pages for an action URL that starts with http://. Since Chrome 87 such a form gets autofill turned off, a warning under it and a full-page warning when it is sent. A page that sends Content-Security-Policy: upgrade-insecure-requests is left out, as for mixed content. Only the markup is read; no form is sent and no action URL is requested.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['form_pages'],
  doc_ref: DOCS.CHROMIUM_MIXED_FORMS,
  recommendation: 'Change the form\'s action to an https:// URL (or a relative one), and make sure that address accepts the data over https.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of formPages(ctx)) {
      if (!page.url.startsWith('https://')) continue;
      const forms = page.forms.forms.map((form, index) => ({ form, index })).filter(({ form }) => form.action !== null);
      if (forms.length === 0) continue;
      const insecure = page.forms.upgrade_insecure === true ? [] : forms.filter(({ form }) => /** @type {string} */ (form.action).startsWith('http://'));
      if (insecure.length === 0) {
        results.push({ status: 'pass', url: page.url });
        continue;
      }
      results.push({
        status: 'fail', url: page.url, selector: formSelector(insecure[0].form, insecure[0].index), line: insecure[0].form.line,
        evidence: { observed: { actions: insecure.slice(0, MAX_NAMED).map(({ form }) => clip(/** @type {string} */ (form.action), 300)) }, expected: 'An https:// action' },
      });
    }
    return results;
  },
};

/** @type {CheckDef} */
const fieldCountHigh = {
  ...CRO,
  id: 'cro.form.field_count_high',
  title: 'Form with many fields',
  description:
    `Checks each form that is not a search form for more than ${FIELD_LIMIT} visible fields. Baymard Institute found that most sites need only 8 form fields for a whole checkout flow (the average in 2024 was 11.3) and that 17% of shoppers had abandoned a checkout for its complexity. That figure is for a checkout, not for one form, so this is a rule of thumb.`,
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: ['form_pages'],
  doc_ref: DOCS.BAYMARD_FIELDS,
  recommendation: 'Ask only for what the next step needs; leave optional fields out or for later.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of formPages(ctx)) {
      page.forms.forms.forEach((form, index) => {
        if (form.search || form.fields === 0) return;
        const selector = formSelector(form, index);
        results.push(form.fields <= FIELD_LIMIT ? { status: 'pass', url: page.url, selector } : {
          status: 'fail', url: page.url, selector, line: form.line,
          evidence: {
            observed: { fields: form.fields, ...(page.forms.unread_controls ? { at_least: true } : {}) }, expected: `${FIELD_LIMIT} visible fields or fewer`,
            ...(page.forms.unread_controls ? { detail: 'The page has more controls than the reading looks at, so the form has at least this many fields.' } : {}),
          },
        });
      });
    }
    return results;
  },
};

/**
 * Why a tel: link cannot be dialled as RFC 3966 writes a number, or null. The number is the part before the first
 * ";" (parameters follow it), percent-decoded, with spaces ignored as browsers do.
 * @param {string} href
 * @returns {string|null}
 */
export function telProblem(href) {
  // Escapes are decoded one run at a time: a malformed one stays as written and is judged as written.
  const number = href.trim().slice(4).split(';', 1)[0].replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return '\uFFFD';
    }
  });
  const compact = number.replace(/\s+/g, '');
  if (!/[0-9]/.test(compact)) return 'The number has no digit, so the link dials nothing.';
  const letters = compact.match(/\p{L}/gu) ?? [];
  if (compact.startsWith('+') && letters.length > 0) return 'A global number (starting with +) has letters, which RFC 3966 does not allow.';
  if (letters.some((letter) => !/^[A-Fa-f]$/.test(letter))) return 'The number has letters (keypad letters such as 1-800-FLOWERS are not supported in a tel: URI).';
  return null;
}

/**
 * Why a mailto: link names an address RFC 6068 cannot read, or null: the addresses are those before "?" and those of
 * a `to` header field, separated by commas; each must have text on both sides of an "@". A link that names no address
 * at all is valid (`mailtoURI = "mailto:" [ to ] [ hfields ]`): a "share by email" link opens a message for the
 * visitor to address (validation of 2026-11-14: all eight findings of the first version were such links).
 * @param {string} href
 * @returns {string|null}
 */
export function mailtoProblem(href) {
  const rest = href.trim().slice(7);
  const mark = rest.indexOf('?');
  const path = mark < 0 ? rest : rest.slice(0, mark);
  const query = mark < 0 ? '' : rest.slice(mark + 1);
  /** @param {string} value */
  const decode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };
  const addresses = decode(path).split(',');
  for (const field of query.split('&')) {
    const eq = field.indexOf('=');
    if (eq > 0 && decode(field.slice(0, eq)).toLowerCase() === 'to') addresses.push(...decode(field.slice(eq + 1)).split(','));
  }
  const given = addresses.map((address) => address.trim()).filter(Boolean);
  if (given.length === 0) return null;
  const bad = given.find((address) => {
    const at = address.lastIndexOf('@');
    return at <= 0 || at === address.length - 1;
  });
  return bad === undefined ? null : 'An address has no "@" with text on both sides.';
}

/** @type {CheckDef} */
const contactLinkInvalid = {
  ...CRO,
  id: 'cro.contact.link_invalid',
  title: 'Phone or email link that cannot work',
  description:
    'Checks the tel: and mailto: links of html pages. A tel: number needs a digit (one without dials nothing) and, by RFC 3966, no letters (keypad letters are not supported; a global number has none at all); an address a mailto: link names needs text on both sides of "@" (RFC 6068), in the link or in its to= field; a share link without an address is valid. web.dev asks to "Wrap all phone numbers in hyperlinks with the tel: schema"; one that cannot be dialled or written to loses the contact.',
  severity: 'low',
  weight: 1,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['form_pages'],
  doc_ref: DOCS.RFC_3966,
  recommendation: 'Write phone links as tel:+<country code><number> with digits only (dashes and dots may separate them), and email links as mailto:name@domain.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of formPages(ctx)) {
      const links = page.links.filter((link) => /^\s*(?:tel|mailto):/i.test(link.href));
      if (links.length === 0) continue;
      const bad = links
        .map((link) => ({ link, problem: /^\s*tel:/i.test(link.href) ? telProblem(link.href) : mailtoProblem(link.href) }))
        .filter((entry) => entry.problem !== null);
      if (bad.length === 0) {
        results.push({ status: 'pass', url: page.url });
        continue;
      }
      results.push({
        status: 'fail', url: page.url, selector: linkSelector(bad[0].link.href), line: bad[0].link.line,
        evidence: {
          observed: { links: bad.length, of: links.length, examples: bad.slice(0, MAX_NAMED).map(({ link, problem }) => ({ href: clip(link.href.trim(), 100), problem })) },
          expected: 'tel: with digits and no letters; mailto: addresses written name@domain',
        },
      });
    }
    return results;
  },
};

export const formChecks = [actionInsecure, fieldCountHigh, contactLinkInvalid];
