import { normalizeUrl } from '../util/url.js';
import { collapseWhitespace } from '../util/strings.js';

export const BUSINESS_MODELS = Object.freeze(['b2b_saas', 'ecommerce', 'local_service', 'publisher', 'mobile_app', 'international', 'other']);

const TOP_LEVEL = new Set(['schema_version', 'site_url', 'brand', 'business_model', 'markets', 'competitors', 'target_queries', 'report', 'updated_at']);
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** @typedef {{field: string, message: string}} FieldError */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, unknown>} object
 * @param {Iterable<string>} allowed
 * @param {string} prefix
 * @param {FieldError[]} errors
 */
function rejectUnknown(object, allowed, prefix, errors) {
  const known = new Set(allowed);
  for (const key of Object.keys(object)) {
    if (!known.has(key)) errors.push({ field: `${prefix}${key}`, message: 'is not a known profile field' });
  }
}

/**
 * A trimmed, whitespace-collapsed, non-empty string without control characters.
 * @param {unknown} value
 * @param {string} field
 * @param {FieldError[]} errors
 * @param {{max?: number, collapse?: boolean}} [options]
 * @returns {string|null}
 */
function cleanText(value, field, errors, { max = 200, collapse = true } = {}) {
  if (typeof value !== 'string') {
    errors.push({ field, message: 'must be a string' });
    return null;
  }
  const cleaned = collapse ? collapseWhitespace(value) : value.trim();
  if (cleaned === '') errors.push({ field, message: 'must not be empty' });
  else if (CONTROL_CHARS.test(cleaned)) errors.push({ field, message: 'must not contain control characters' });
  else if (cleaned.length > max) errors.push({ field, message: `must be at most ${max} characters` });
  else return cleaned;
  return null;
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {FieldError[]} errors
 * @param {{maxItems: number, max?: number}} limits
 * @returns {string[]|null}
 */
function cleanList(value, field, errors, { maxItems, max }) {
  if (!Array.isArray(value)) {
    errors.push({ field, message: 'must be an array of strings' });
    return null;
  }
  if (value.length > maxItems) errors.push({ field, message: `must have at most ${maxItems} entries` });
  const seen = new Set();
  value.slice(0, maxItems).forEach((item, index) => {
    const cleaned = cleanText(item, `${field}[${index}]`, errors, { max });
    if (cleaned !== null) seen.add(cleaned);
  });
  return [...seen];
}

/**
 * @param {unknown} value
 * @param {string} field
 * @param {FieldError[]} errors
 * @returns {string|null}
 */
function languageTag(value, field, errors) {
  if (typeof value === 'string' && value.length <= 35) {
    try {
      const [canonical] = Intl.getCanonicalLocales(value.trim());
      if (canonical) return canonical;
    } catch {
      // Falls through to the error below.
    }
  }
  errors.push({ field, message: 'must be a language tag such as "en" or "pt-BR"' });
  return null;
}

/**
 * @param {unknown} value
 * @param {FieldError[]} errors
 * @returns {{country: string, languages: string[]}[]|null}
 */
function cleanMarkets(value, errors) {
  if (!Array.isArray(value)) {
    errors.push({ field: 'markets', message: 'must be an array of {country, languages}' });
    return null;
  }
  if (value.length > 50) errors.push({ field: 'markets', message: 'must have at most 50 entries' });
  /** @type {{country: string, languages: string[]}[]} */
  const markets = [];
  value.slice(0, 50).forEach((item, index) => {
    const field = `markets[${index}]`;
    if (!isPlainObject(item)) {
      errors.push({ field, message: 'must be an object with country and languages' });
      return;
    }
    rejectUnknown(item, ['country', 'languages'], `${field}.`, errors);
    const country = typeof item.country === 'string' && /^[A-Za-z]{2}$/.test(item.country.trim()) ? item.country.trim().toUpperCase() : null;
    if (country === null) errors.push({ field: `${field}.country`, message: 'must be a two-letter country code such as "US"' });
    let languages = null;
    if (!Array.isArray(item.languages) || item.languages.length === 0 || item.languages.length > 10) {
      errors.push({ field: `${field}.languages`, message: 'must be an array of 1 to 10 language tags' });
    } else {
      const tags = item.languages.map((tag, i) => languageTag(tag, `${field}.languages[${i}]`, errors));
      if (!tags.includes(null)) languages = [...new Set(/** @type {string[]} */ (tags))];
    }
    if (country !== null && languages !== null) markets.push({ country, languages });
  });
  return markets;
}

/**
 * Validate and normalize a profile. Every problem is collected, so the caller
 * can name all bad fields at once. `schema_version` and `updated_at` are not
 * part of the result; the caller sets them.
 * @param {unknown} input
 * @returns {{profile: Record<string, unknown>|null, errors: FieldError[]}}
 */
export function normalizeProfile(input) {
  if (!isPlainObject(input)) return { profile: null, errors: [{ field: 'profile', message: 'must be an object' }] };
  /** @type {FieldError[]} */
  const errors = [];
  /** @type {Record<string, unknown>} */
  const profile = {};

  const siteUrl = typeof input.site_url === 'string' && input.site_url.length <= 2048 ? normalizeUrl(input.site_url) : null;
  if (siteUrl === null) errors.push({ field: 'site_url', message: 'must be an http or https URL such as "https://example.com"' });
  profile.site_url = siteUrl;

  if (!isPlainObject(input.brand)) {
    errors.push({ field: 'brand', message: 'must be an object with a name' });
  } else {
    rejectUnknown(input.brand, ['name', 'alternate_names'], 'brand.', errors);
    /** @type {Record<string, unknown>} */
    const brand = { name: cleanText(input.brand.name, 'brand.name', errors) };
    if (input.brand.alternate_names !== undefined) {
      brand.alternate_names = cleanList(input.brand.alternate_names, 'brand.alternate_names', errors, { maxItems: 20 });
    }
    profile.brand = brand;
  }

  if (input.business_model !== undefined) {
    if (BUSINESS_MODELS.includes(/** @type {string} */ (input.business_model))) profile.business_model = input.business_model;
    else errors.push({ field: 'business_model', message: `must be one of ${BUSINESS_MODELS.join(', ')}` });
  }
  if (input.markets !== undefined) profile.markets = cleanMarkets(input.markets, errors);
  if (input.competitors !== undefined) profile.competitors = cleanList(input.competitors, 'competitors', errors, { maxItems: 20 });
  if (input.target_queries !== undefined) profile.target_queries = cleanList(input.target_queries, 'target_queries', errors, { maxItems: 50 });

  if (input.report !== undefined) {
    if (!isPlainObject(input.report)) {
      errors.push({ field: 'report', message: 'must be an object' });
    } else {
      rejectUnknown(input.report, ['brand_name', 'logo_path'], 'report.', errors);
      /** @type {Record<string, string|null>} */
      const report = {};
      if (input.report.brand_name !== undefined) report.brand_name = cleanText(input.report.brand_name, 'report.brand_name', errors);
      if (input.report.logo_path !== undefined) {
        report.logo_path = cleanText(input.report.logo_path, 'report.logo_path', errors, { max: 1000, collapse: false });
      }
      profile.report = report;
    }
  }
  rejectUnknown(input, TOP_LEVEL, '', errors);
  return { profile: errors.length === 0 ? profile : null, errors };
}
