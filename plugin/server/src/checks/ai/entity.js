// Whether the site says who is behind it in JSON-LD, and says it the same way
// on every page (ai module). Google reads Organization markup to tell one
// organisation from another; it requires none of its properties, so every
// check here is information and changes no count. Pure.

/** @import { CheckContext, CheckDef, CheckResult, PageRecord, ProfileEntity } from '../../types.js' */

import { normalizeUrl } from '../../util/url.js';
import { AI, DOCS } from './helpers.js';

/** The date the rules of this file were read against Google's page. */
export const ENTITY_VERIFIED = '2026-11-24';
/** Variants and pages listed in evidence. */
const MAX_EXAMPLES = 5;
const SELECTOR = 'script[type="application/ld+json"]';

/** A type that names a person, not an organisation or a business. */
const PERSON = /(?:^|[:/])Person$/;

/**
 * The entities of a page's valid JSON-LD blocks, in document order.
 * @param {PageRecord} page
 * @returns {ProfileEntity[]}
 */
export const entitiesOf = (page) => page.jsonld.filter((block) => block.valid).flatMap((block) => block.profiles ?? []);

/**
 * A URL of an entity resolved against its page, or null when it is not an http(s) URL.
 * @param {string|null|undefined} value
 * @param {string} base
 */
const resolved = (value, base) => (typeof value === 'string' ? normalizeUrl(value, base) : null);

/** @param {string} url */
const hostOf = (url) => new URL(url).host;

/** @param {string} name  Compared without case and with runs of white space as one space. */
const nameKey = (name) => name.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** @param {string} url  The site's own URL without its scheme, so http and https name one entity. */
const urlKey = (url) => url.replace(/^https?:/, '');

/** @param {CheckContext} ctx */
function startPage(ctx) {
  const start = ctx.resolve(ctx.site.start_url);
  return start !== undefined && start.status === 200 && start.is_html ? start : null;
}

/** @param {string} a @param {string} b */
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** @type {CheckDef} */
const entityMissing = {
  ...AI,
  last_verified: ENTITY_VERIFIED,
  id: 'ai.entity.missing',
  title: 'No page says in JSON-LD who is behind the site',
  description:
    'Looks at the JSON-LD of every crawled html page for an Organization (or a kind of it), a business or a Person at the top level of a block or in its @graph. Google recommends putting Organization markup on the home page or on one page that describes the organisation, such as the about page, and says it helps Google tell the organisation apart; it requires none of its properties, so the check does not change the count.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'site',
  requires: ['entity_pages'],
  doc_ref: DOCS.GOOGLE_ORG,
  recommendation: 'Add Organization markup (or the most specific kind of it, such as LocalBusiness or OnlineStore; Person for a personal site) to the home page or the about page, with the name, url and logo the site uses.',
  run(ctx) {
    const start = startPage(ctx);
    if (start === null) return [];
    const found = ctx.htmlPages.find((page) => entitiesOf(page).length > 0);
    if (found !== undefined) return [{ status: 'pass', url: start.url, selector: SELECTOR }];
    return [{
      status: 'fail', url: start.url, selector: SELECTOR,
      evidence: {
        observed: { html_pages: ctx.htmlPages.length, entities: 0 },
        expected: 'An Organization, a business or a Person in the JSON-LD of the home page or the about page',
        detail: 'Google: "We recommend placing this information on your home page, or a single page that describes your organization, for example the about us page."',
      },
    }];
  },
};

/** @type {CheckDef} */
const entityUrlOffsite = {
  ...AI,
  last_verified: ENTITY_VERIFIED,
  id: 'ai.entity.url_offsite',
  title: 'The home page\'s Organization markup gives another site\'s address',
  description:
    'Reads the url of each Organization or business at the top level of the start page\'s JSON-LD. Google defines it as the URL of the organisation\'s website and says it helps Google identify the organisation; an address on a host the site\'s owner does not hold (not the site, its registered domain or a sister domain the site links to) points it at someone else. Information only: Google requires none of these properties.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'site',
  requires: ['entity_pages'],
  doc_ref: DOCS.GOOGLE_ORG,
  recommendation: 'Set the url of the site\'s own Organization to the site\'s home page. A partner or a parent company belongs in a property such as parentOrganization or memberOf, not at the top level.',
  run(ctx) {
    const start = startPage(ctx);
    if (start === null) return [];
    /** @type {CheckResult[]} */
    const results = [];
    entitiesOf(start).forEach((entity, index) => {
      if (PERSON.test(entity.type) || typeof entity.url !== 'string') return;
      const url = resolved(entity.url, start.url);
      const selector = `${SELECTOR} entity[${index + 1}]`;
      if (url !== null && ctx.identity.isSameOrganisation(hostOf(url))) {
        results.push({ status: 'pass', url: start.url, selector });
        return;
      }
      results.push({
        status: 'fail', url: start.url, selector,
        evidence: {
          observed: { type: entity.type, name: entity.name ?? null, url: entity.url },
          expected: `A url on ${ctx.identity.host}`,
          detail: 'Google: url is "The URL of the website of your organization, if applicable. This helps Google uniquely identify your organization."',
        },
      });
    });
    return results;
  },
};

/**
 * The site's own entities on each html page, by the address that names them:
 * the `url` when it is of the site's organisation, else the `@id` when that is.
 * @param {CheckContext} ctx
 * @returns {Map<string, {type: string, name: string|null, logo: string|null, page: string}[]>}
 */
function ownEntities(ctx) {
  /** @type {Map<string, {type: string, name: string|null, logo: string|null, page: string}[]>} */
  const groups = new Map();
  for (const page of ctx.htmlPages) {
    for (const entity of entitiesOf(page)) {
      const url = resolved(entity.url, page.url);
      let key = url !== null && ctx.identity.isSameOrganisation(hostOf(url)) ? `url ${urlKey(url)}` : null;
      if (key === null && typeof entity.id === 'string') {
        // An @id keeps its fragment: https://acme.com/#organization and #person are two entities.
        let id = null;
        try {
          id = new URL(entity.id, page.url);
        } catch {
          id = null;
        }
        if (id !== null && (id.protocol === 'https:' || id.protocol === 'http:') && ctx.identity.isSameOrganisation(id.host)) key = `id ${urlKey(id.href)}`;
      }
      if (key === null) continue;
      const item = { type: entity.type, name: entity.name ?? null, logo: resolved(entity.logo, page.url), page: page.url };
      const list = groups.get(key);
      if (list === undefined) groups.set(key, [item]);
      else list.push(item);
    }
  }
  return groups;
}

/**
 * The distinct values of a field, each with the first page that gives it, in page order.
 * @param {{name: string|null, logo: string|null, page: string}[]} items
 * @param {'name'|'logo'} field
 */
function variants(items, field) {
  /** @type {Map<string, {value: string, page: string}>} */
  const seen = new Map();
  for (const item of items) {
    const value = item[field];
    if (value === null) continue;
    const key = field === 'name' ? nameKey(value) : value;
    if (!seen.has(key)) seen.set(key, { value, page: item.page });
  }
  return [...seen.values()];
}

/** @type {CheckDef} */
const entityInconsistent = {
  ...AI,
  last_verified: ENTITY_VERIFIED,
  id: 'ai.entity.inconsistent',
  title: 'Pages describe the site\'s organisation differently',
  description:
    'Groups the Organizations, businesses and Persons of the crawled pages\' JSON-LD by the address that names them (their url, or their @id, on the site\'s own hosts) and, for each one described on two or more pages, compares the names (without case or extra spaces) and the logo addresses that are given. Google asks that the name be the one the site uses for its site name; two names or two logos for one entity leave it to guess which is right. Information only: Google requires none of these properties.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 2,
  confidence: 'likely',
  scope: 'site',
  requires: ['entity_pages'],
  doc_ref: DOCS.GOOGLE_ORG,
  recommendation: 'Give the entity the same name and logo on every page, best from one shared template or one @id that every page refers to.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    const groups = [...ownEntities(ctx).entries()].sort((a, b) => byText(a[0], b[0]));
    for (const [key, items] of groups) {
      const pages = [...new Set(items.map((item) => item.page))];
      if (pages.length < 2) continue;
      const url = pages[0];
      const selector = key.slice(key.indexOf(' ') + 1);
      const names = variants(items, 'name');
      const logos = variants(items, 'logo');
      if (names.length <= 1 && logos.length <= 1) {
        results.push({ status: 'pass', url, selector });
        continue;
      }
      results.push({
        status: 'fail', url, selector,
        related_urls: [...new Set([...names, ...logos].map((variant) => variant.page))].sort(byText).slice(0, MAX_EXAMPLES),
        evidence: {
          observed: {
            type: items[0].type,
            pages: pages.length,
            ...(names.length > 1 ? { names: names.slice(0, MAX_EXAMPLES) } : {}),
            ...(logos.length > 1 ? { logos: logos.slice(0, MAX_EXAMPLES) } : {}),
          },
          expected: 'One name and one logo for the entity on every page',
          detail: 'Google: "Use the same name and alternateName that you\'re using for your site name."',
        },
      });
    }
    return results;
  },
};

export const entityChecks = [entityMissing, entityUrlOffsite, entityInconsistent];
