// LocalBusiness markup: what Google requires of it and recommends, read on
// Google's local business structured data page, and whether one location is
// described the same way on every page. Pure.

/** @import { CheckContext, CheckDef, CheckResult, LocalBusinessFields, PageRecord, ProfileEntity } from '../../types.js' */

import { normalizeUrl } from '../../util/url.js';
import { DOCS, SEO } from './common.js';

/** The date Google's page was read for these rules. */
export const LOCAL_VERIFIED = '2026-11-24';
const BASE = { ...SEO, last_verified: LOCAL_VERIFIED, doc_ref: DOCS.LOCAL_BUSINESS };
const SELECTOR = 'script[type="application/ld+json"]';
/** Google: the coordinates' precision must be at least this many decimal places. */
export const GEO_PLACES = 5;
/** Google: a priceRange of this many characters or more is not shown. */
export const PRICE_RANGE_MAX = 100;

/**
 * The LocalBusiness entities of an html page's valid JSON-LD blocks, with their place among the page's entities.
 * @param {PageRecord} page
 * @returns {{entity: ProfileEntity & {local: LocalBusinessFields}, selector: string}[]}
 */
function localEntities(page) {
  const entities = page.jsonld.filter((block) => block.valid).flatMap((block) => block.profiles ?? []);
  return entities.flatMap((entity, index) => (entity.local === undefined || entity.local === null ? []
    : [{ entity: /** @type {ProfileEntity & {local: LocalBusinessFields}} */ (entity), selector: `${SELECTOR} entity[${index + 1}]` }]));
}

/**
 * Run `judge` on every LocalBusiness of every html page.
 * @param {CheckContext} ctx
 * @param {(entity: ProfileEntity & {local: LocalBusinessFields}) => {unit: false}|{unit: true, problem: null|{observed: unknown, expected: string, detail?: string}}} judge
 * @returns {CheckResult[]}
 */
function eachLocal(ctx, judge) {
  /** @type {CheckResult[]} */
  const results = [];
  for (const page of ctx.htmlPages) {
    for (const { entity, selector } of localEntities(page)) {
      const verdict = judge(entity);
      if (!verdict.unit) continue;
      if (verdict.problem === null) results.push({ status: 'pass', url: page.url, selector });
      else results.push({
        status: 'fail', url: page.url, selector,
        evidence: { observed: verdict.problem.observed, expected: verdict.problem.expected, ...(verdict.problem.detail ? { detail: verdict.problem.detail } : {}) },
      });
    }
  }
  return results;
}

/** @type {CheckDef} */
const requiredMissing = {
  ...BASE,
  id: 'seo.local.required_missing',
  title: 'LocalBusiness markup lacks its name or address',
  description: 'Checks each LocalBusiness (or one of its subtypes, such as Dentist or Restaurant) in the JSON-LD of html pages for the two properties Google requires: name and address. Without them the business is not eligible for a local business rich result.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['entity_pages', 'local_pages'],
  recommendation: 'Give the LocalBusiness a name and an address (a PostalAddress with the street, city, region, postal code and country).',
  run(ctx) {
    return eachLocal(ctx, (entity) => {
      const missing = [...(entity.name ? [] : ['name']), ...(entity.local.address === null ? ['address'] : [])];
      return { unit: true, problem: missing.length === 0 ? null : { observed: { type: entity.type, missing }, expected: 'name and address', detail: 'Google: "You must include the required properties for your content to be eligible for display as a rich result."' } };
    });
  },
};

/** @type {CheckDef} */
const recommendedMissing = {
  ...BASE,
  id: 'seo.local.recommended_missing',
  title: 'LocalBusiness markup lacks recommended properties',
  description: 'Checks each LocalBusiness in the JSON-LD of html pages for the recommended properties every kind of business can give: telephone, url, geo and openingHoursSpecification. Google recommends them; it does not require them, so this is information.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['entity_pages', 'local_pages'],
  recommendation: 'Add the missing properties: the main phone number with its country code, the URL of this location\'s page, its coordinates and its opening hours as OpeningHoursSpecification.',
  run(ctx) {
    return eachLocal(ctx, (entity) => {
      const missing = [
        ...(entity.local.telephone === null ? ['telephone'] : []),
        ...(entity.url ? [] : ['url']),
        ...(entity.local.geo === null ? ['geo'] : []),
        ...(entity.local.hours_specification ? [] : ['openingHoursSpecification']),
      ];
      return {
        unit: true,
        problem: missing.length === 0 ? null : {
          observed: { type: entity.type, missing, ...(entity.local.hours_text && !entity.local.hours_specification ? { opening_hours_text: true } : {}) },
          expected: 'telephone, url, geo and openingHoursSpecification',
        },
      };
    });
  },
};

/** @type {CheckDef} */
const geoImprecise = {
  ...BASE,
  id: 'seo.local.geo_imprecise',
  title: 'LocalBusiness coordinates have fewer than 5 decimal places',
  description: 'Checks the latitude and longitude of each LocalBusiness that gives both as numbers. Google: the precision must be at least 5 decimal places. Decimal places are counted as written, so 41.10000 has five.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['entity_pages', 'local_pages'],
  recommendation: `Give the latitude and longitude with at least ${GEO_PLACES} decimal places, as a map shows them for the location.`,
  run(ctx) {
    return eachLocal(ctx, (entity) => {
      const geo = entity.local.geo;
      if (geo === null || geo.latitude === null || geo.longitude === null) return { unit: false };
      const places = Math.min(geo.latitude.places, geo.longitude.places);
      return { unit: true, problem: places >= GEO_PLACES ? null : { observed: { latitude: geo.latitude.value, longitude: geo.longitude.value, decimal_places: places }, expected: `${GEO_PLACES} or more decimal places` } };
    });
  },
};

/** @type {CheckDef} */
const internationalPrefix = {
  ...BASE,
  id: 'seo.local.telephone_no_country_code',
  title: 'LocalBusiness telephone has no international prefix',
  description: 'Checks the telephone of each LocalBusiness for an international prefix (+ or 00). Google asks to include the country code and area code; a number without a prefix may still hold them, which cannot be told from the text, so this is information.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: ['entity_pages', 'local_pages'],
  recommendation: 'Write the number with its country code, such as +90 212 555 01 23.',
  run(ctx) {
    return eachLocal(ctx, (entity) => {
      const phone = entity.local.telephone;
      if (phone === null) return { unit: false };
      return { unit: true, problem: /^(?:tel:)?\s*(?:\+|00)/i.test(phone) ? null : { observed: phone, expected: 'A number starting with + and the country code', detail: 'Google: "Be sure to include the country code and area code in the phone number."' } };
    });
  },
};

/** @type {CheckDef} */
const priceRangeLong = {
  ...BASE,
  id: 'seo.local.price_range_long',
  title: 'LocalBusiness priceRange is too long to be shown',
  description: `Checks the priceRange of each LocalBusiness. Google: it must be shorter than ${PRICE_RANGE_MAX} characters, and a longer one is not shown.`,
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['entity_pages', 'local_pages'],
  recommendation: 'Give the price range as a short range ("$10-15") or a number of currency signs ("$$$").',
  run(ctx) {
    return eachLocal(ctx, (entity) => {
      const length = entity.local.price_range_length;
      if (length === null) return { unit: false };
      return { unit: true, problem: length < PRICE_RANGE_MAX ? null : { observed: { characters: length }, expected: `Fewer than ${PRICE_RANGE_MAX} characters` } };
    });
  },
};

/** @param {string} text */
const addressKey = (text) => text.normalize('NFC').replace(/[\s,.]+/g, ' ').trim().toLowerCase();
/** @param {string} phone */
const phoneKey = (phone) => phone.replace(/^tel:/i, '').replace(/^00/, '+').replace(/[^\d+]/g, '');

/** @type {CheckDef} */
const inconsistent = {
  ...BASE,
  id: 'seo.local.inconsistent',
  title: 'Pages give one location different addresses or phone numbers',
  description: 'Groups the LocalBusiness entities of the crawled pages by the address that names the location (its url, or its @id, on the site\'s own hosts) and, for each one described on two or more pages, compares the addresses (without case, spaces or commas) and phone numbers (digits only) that are given. Google asks for each location to be its own LocalBusiness; two addresses for one location leave it to guess. No source sets this rule, so it is information.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 2,
  confidence: 'likely',
  scope: 'site',
  requires: ['entity_pages', 'local_pages'],
  recommendation: 'Give each location the same address and phone number on every page, best from one template, and a LocalBusiness of its own for each other location.',
  run(ctx) {
    /** @type {Map<string, {address: string|null, phone: string|null, page: string}[]>} */
    const groups = new Map();
    for (const page of ctx.htmlPages) {
      for (const { entity } of localEntities(page)) {
        const key = locationKey(ctx, entity, page.url);
        if (key === null) continue;
        const list = groups.get(key) ?? [];
        list.push({ address: entity.local.address_text, phone: entity.local.telephone, page: page.url });
        groups.set(key, list);
      }
    }
    /** @type {CheckResult[]} */
    const results = [];
    for (const key of [...groups.keys()].sort()) {
      const items = /** @type {{address: string|null, phone: string|null, page: string}[]} */ (groups.get(key));
      const pages = [...new Set(items.map((item) => item.page))];
      if (pages.length < 2) continue;
      const addresses = distinct(items, 'address', addressKey);
      const phones = distinct(items, 'phone', phoneKey);
      if (addresses.length <= 1 && phones.length <= 1) {
        results.push({ status: 'pass', url: pages[0], selector: key });
        continue;
      }
      results.push({
        status: 'fail', url: pages[0], selector: key,
        related_urls: [...new Set([...addresses, ...phones].map((item) => item.page))].sort().slice(0, 5),
        evidence: {
          observed: { pages: pages.length, ...(addresses.length > 1 ? { addresses: addresses.slice(0, 5) } : {}), ...(phones.length > 1 ? { telephones: phones.slice(0, 5) } : {}) },
          expected: 'One address and one phone number for the location on every page',
        },
      });
    }
    return results;
  },
};

/**
 * The address that names a location: its url when it is on a host of the site's organisation, else its @id when that is.
 * @param {CheckContext} ctx @param {ProfileEntity} entity @param {string} base
 * @returns {string|null}
 */
function locationKey(ctx, entity, base) {
  for (const value of [entity.url, entity.id]) {
    if (typeof value !== 'string') continue;
    let url;
    try {
      url = new URL(value, base);
    } catch {
      continue;
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !ctx.identity.isSameOrganisation(url.host)) continue;
    // A url is compared as normalised, an @id with its fragment (https://acme.test/#branch-1); the scheme does not count.
    const text = value === entity.url ? (normalizeUrl(url.href) ?? url.href) : url.href;
    return text.replace(/^https?:/, '');
  }
  return null;
}

/**
 * The distinct values of a field, each with the first page that gives it.
 * @param {{address: string|null, phone: string|null, page: string}[]} items
 * @param {'address'|'phone'} field
 * @param {(value: string) => string} key
 */
function distinct(items, field, key) {
  /** @type {Map<string, {value: string, page: string}>} */
  const seen = new Map();
  for (const item of items) {
    const value = item[field];
    if (value === null || key(value) === '') continue;
    if (!seen.has(key(value))) seen.set(key(value), { value, page: item.page });
  }
  return [...seen.values()];
}

export const localChecks = [requiredMissing, recommendedMissing, geoImprecise, internationalPrefix, priceRangeLong, inconsistent];
