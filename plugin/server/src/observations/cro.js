// The cro module's observations (rule set 0.2.1): the consent tool a page loads,
// the paths to make contact, and where the first action element stands in the
// HTML. Measurements without a pass/fail threshold: they never change a score
// and are not findings. Pure; read from the crawl only.

/** @import { CheckContext, Observation, PageRecord } from '../types.js' */

import { isStoredUrl } from '../store/run-validate.js';

/**
 * Consent tools by the host their installation page tells sites to load the script from, read on 2026-11-14:
 * OneTrust (developer.onetrust.com/onetrust/docs/shopify), Cookiebot (cookiebot.com/en/manual-implementation),
 * Didomi (developers.didomi.io/cmp/web-sdk/getting-started), Usercentrics (usercentrics.com/docs/web/implementation/ui).
 */
const CONSENT_HOSTS = new Map([
  ['cdn.cookielaw.org', 'OneTrust'], ['consent.cookiebot.com', 'Cookiebot'], ['sdk.privacy-center.org', 'Didomi'],
  ['web.cmp.usercentrics.eu', 'Usercentrics'],
]);
/** Form services whose script or frame puts a form on the page that the HTML does not hold, by host (or host ending). */
const FORM_SERVICES = new Map([
  ['hsforms.net', 'HubSpot'], ['hsforms.com', 'HubSpot'], ['typeform.com', 'Typeform'], ['jotform.com', 'Jotform'], ['jotfor.ms', 'Jotform'],
  ['forms.office.com', 'Microsoft Forms'], ['tally.so', 'Tally'], ['calendly.com', 'Calendly'], ['cognitoforms.com', 'Cognito Forms'],
  ['wufoo.com', 'Wufoo'], ['formstack.com', 'Formstack'], ['forms.zohopublic.com', 'Zoho Forms'], ['paperform.co', 'Paperform'],
]);
/** Words that name a contact page in a link's path or text: English, Turkish, German, Spanish, Portuguese, Italian, French, Dutch. */
const CONTACT_PATH = /(?:^|[/_-])(?:contact|contacts|contact-us|contactus|kontakt|kontakty|contacto|contactenos|contato|contatti|contattaci|contactez-nous|iletisim|bize-ulasin|kontaktieren)(?:[/_.-]|$)/i;
/** Compared with the link text folded (lower case, accents removed: "İletişim" reads "iletisim"). */
const CONTACT_TEXT = /^(?:contact(?: us)?|kontakt|contacto|contactenos|contato|contatti|contattaci|contactez-nous|nous contacter|iletisim|bize ulasin|neem contact op)$/;
/** Compared with the link text as written. */
const CONTACT_TEXT_CJK = /^(?:お問い合わせ|联系我们|문의하기)$/u;
const TEL = /^\s*tel:/i;
const MAILTO = /^\s*mailto:/i;
const MAX_URLS = 5;

export const CONSENT_SOURCE = 'https://github.com/InteractiveAdvertisingBureau/GDPR-Transparency-and-Consent-Framework/blob/master/TCFv2/IAB%20Tech%20Lab%20-%20CMP%20API%20v2.md';
export const FIRST_ACTION_SOURCE = 'https://www.nngroup.com/articles/scrolling-and-attention/';

/** @param {PageRecord} page */
const hasForms = (page) => page.forms !== undefined && page.forms !== null && page.forms.failed !== true;

/**
 * @param {string} host
 * @param {Map<string, string>} names
 * @returns {string|null} The name of the service whose host it is or ends in.
 */
function serviceOf(host, names) {
  const plain = host.toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
  for (const [domain, name] of names) {
    if (plain === domain || plain.endsWith(`.${domain}`)) return name;
  }
  return null;
}

/**
 * @param {PageRecord} page
 * @param {Map<string, string>} names
 * @returns {Set<string>}
 */
function embedded(page, names) {
  const found = new Set();
  for (const embed of page.security?.embeds ?? []) {
    const name = serviceOf(embed.host, names);
    if (name !== null) found.add(name);
    // Google Forms is on docs.google.com, which serves documents too: only a frame of a form counts.
    else if (names === FORM_SERVICES && embed.tag === 'iframe' && /^https:\/\/docs\.google\.com\/forms\//.test(embed.url)) found.add('Google Forms');
  }
  return found;
}

/** @param {string} value */
const fold = (value) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** @param {import('../types.js').LinkRecord} link */
const isContactLink = (link) => link.internal && link.url !== null
  && (CONTACT_PATH.test(new URL(link.url).pathname) || CONTACT_TEXT.test(fold(link.text)) || CONTACT_TEXT_CJK.test(link.text.trim()));

/**
 * @param {string} id @param {string} reason @param {string|null} source
 * @returns {Observation}
 */
export const notAvailable = (id, reason, source) => ({ id, module: id.split('.', 1)[0], status: 'not_available', reason, values: {}, urls: [], source });

const NO_PAGES = 'No html page of this crawl carries the forms reading of rule set 0.2.1 (the crawl was blocked, read no html page, or was made by an older version). Crawl the site again.';

/**
 * Which consent tools the pages load and whether the IAB TCF consent API is on them.
 * @param {PageRecord[]} pages  The html pages with a forms reading.
 * @returns {Observation}
 */
function consentTool(pages) {
  if (pages.length === 0) return notAvailable('cro.consent_tool', NO_PAGES, CONSENT_SOURCE);
  const providers = new Set();
  let providerPages = 0;
  for (const page of pages) {
    const found = embedded(page, CONSENT_HOSTS);
    if (found.size > 0) providerPages += 1;
    for (const name of found) providers.add(name);
  }
  return {
    id: 'cro.consent_tool', module: 'cro', status: 'measured', reason: null,
    values: {
      pages_read: pages.length, providers: providers.size === 0 ? null : [...providers].sort().join(', '), provider_pages: providerPages,
      tcf_pages: pages.filter((page) => page.forms?.tcf_stub === true).length,
    },
    urls: [], source: CONSENT_SOURCE,
  };
}

/**
 * The ways to make contact the pages offer: tel: and mailto: links, forms, links to a contact page, embedded form services.
 * @param {PageRecord[]} pages  The html pages with a forms reading.
 * @returns {Observation}
 */
function contactPath(pages) {
  if (pages.length === 0) return notAvailable('cro.contact_path', NO_PAGES, null);
  const services = new Set();
  /** @type {string[]} */
  const contactPages = [];
  let tel = 0; let mailto = 0; let forms = 0; let linking = 0; let serviced = 0;
  for (const page of pages) {
    if (page.links.some((link) => TEL.test(link.href))) tel += 1;
    if (page.links.some((link) => MAILTO.test(link.href))) mailto += 1;
    const record = /** @type {import('../types.js').FormsRecord} */ (page.forms);
    if (record.forms.some((form, index) => !form.search && record.controls.some((control) => control.form === index))) forms += 1;
    const contacts = page.links.filter(isContactLink);
    if (contacts.length > 0) linking += 1;
    for (const link of contacts) {
      if (contactPages.length < MAX_URLS && !contactPages.includes(/** @type {string} */ (link.url)) && isStoredUrl(link.url)) contactPages.push(/** @type {string} */ (link.url));
    }
    const found = embedded(page, FORM_SERVICES);
    if (found.size > 0) serviced += 1;
    for (const name of found) services.add(name);
  }
  return {
    id: 'cro.contact_path', module: 'cro', status: 'measured', reason: null,
    values: {
      pages_read: pages.length, tel_pages: tel, mailto_pages: mailto, form_pages: forms, contact_link_pages: linking,
      form_service_pages: serviced, form_services: services.size === 0 ? null : [...services].sort().join(', '),
    },
    urls: contactPages.sort(), source: null,
  };
}

/**
 * Where the start page's first action element stands in the HTML: how many words and elements come before it.
 * @param {CheckContext} ctx
 * @returns {Observation}
 */
function firstAction(ctx) {
  const start = ctx.resolve(ctx.site.start_url);
  if (!start || start.status !== 200 || !start.is_html || !hasForms(start)) {
    return notAvailable('cro.first_action', 'The start page was not read as an html page with the forms reading of rule set 0.2.1, so there is nothing to measure.', FIRST_ACTION_SOURCE);
  }
  const action = start.forms?.first_action ?? null;
  return {
    id: 'cro.first_action', module: 'cro', status: 'measured', reason: null,
    values: action === null
      ? { found: false, in_main: null, tag: null, words_before: null, elements_before: null }
      : { found: true, in_main: action.in_main, tag: action.tag, words_before: action.words_before, elements_before: action.elements_before },
    urls: isStoredUrl(start.url) ? [start.url] : [], source: FIRST_ACTION_SOURCE,
  };
}

/**
 * The cro module's observations of a crawl, in a fixed order.
 * @param {CheckContext} ctx
 * @returns {Observation[]}
 */
export function croObservations(ctx) {
  const pages = ctx.htmlPages.filter(hasForms);
  return [
    guarded('cro.consent_tool', CONSENT_SOURCE, () => consentTool(pages)),
    guarded('cro.contact_path', null, () => contactPath(pages)),
    guarded('cro.first_action', FIRST_ACTION_SOURCE, () => firstAction(ctx)),
  ];
}

export const OBSERVATION_FAILED = 'This could not be measured: the crawl\'s records of the pages do not have the form this version reads (a crawl file written by hand or damaged). The rest of the audit is not affected.';

/**
 * One observation, isolated as a check is: an exception (a malformed record in a stored crawl) becomes an
 * observation that says it could not be measured, and the audit goes on.
 * @param {string} id @param {string|null} source @param {() => Observation} build
 * @returns {Observation}
 */
function guarded(id, source, build) {
  try {
    return build();
  } catch {
    return notAvailable(id, OBSERVATION_FAILED, source);
  }
}

/**
 * How many html pages had their forms reading stop on an error.
 * @param {CheckContext} ctx
 */
export const formsFailedPages = (ctx) => ctx.htmlPages.filter((page) => page.forms !== null && typeof page.forms === 'object' && page.forms.failed === true).length;
