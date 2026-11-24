// Whether an hreflang value names a language (and optionally a script and a
// region) the way Google reads it: an ISO 639-1 language code, then an
// optional ISO 15924 script code, then an optional ISO 3166-1 alpha-2 region
// code, in any case, or `x-default`. The codes are read from
// server/data/iso-codes.json (scripts/gen-iso-codes.js) once, when first asked.

import { readFileSync } from 'node:fs';

const DATA = new URL('../../data/iso-codes.json', import.meta.url);

/** @type {{languages: Set<string>, scripts: Set<string>, regions: Set<string>}|null} */
let loaded = null;

function codes() {
  if (loaded === null) {
    const data = JSON.parse(readFileSync(DATA, 'utf8'));
    const set = (/** @type {unknown} */ value, /** @type {(code: string) => string} */ fold) => new Set(String(value).split(' ').filter(Boolean).map(fold));
    loaded = {
      languages: set(data.languages, (code) => code.toLowerCase()),
      scripts: set(data.scripts, (code) => code.toLowerCase()),
      regions: set(data.regions, (code) => code.toLowerCase()),
    };
  }
  return loaded;
}

/** Codes Google names as having no effect in hreflang: they are not ISO 3166-1 alpha-2 regions. */
const RESERVED_REGIONS = new Set(['eu', 'un', 'uk']);

/**
 * @typedef {'format'|'region_only'|'unknown_language'|'unknown_script'|'unknown_region'|'reserved_region'} HreflangProblem
 */

/**
 * What is wrong with an hreflang value, or null when Google can read it.
 * @param {string} value
 * @returns {HreflangProblem|null}
 */
export function hreflangProblem(value) {
  const text = value.trim().toLowerCase();
  if (text === 'x-default') return null;
  const parts = text.split('-');
  if (parts.length > 3 || parts.some((part) => !/^[a-z0-9]+$/.test(part))) return 'format';
  const { languages, scripts, regions } = codes();
  const [language, ...rest] = parts;
  if (!/^[a-z]{2}$/.test(language)) return 'format';
  if (!languages.has(language)) return regions.has(language) && rest.length === 0 ? 'region_only' : 'unknown_language';
  let next = rest.shift();
  if (next !== undefined && next.length === 4) {
    if (!/^[a-z]{4}$/.test(next) || !scripts.has(next)) return 'unknown_script';
    next = rest.shift();
  }
  if (next === undefined) return null;
  if (rest.length > 0) return 'format';
  // A UN M.49 area such as 419 (Latin America) is not an ISO 3166-1 alpha-2 region; Google names es-419 as unsupported.
  if (!/^[a-z]{2}$/.test(next)) return /^\d{3}$/.test(next) ? 'unknown_region' : 'format';
  if (RESERVED_REGIONS.has(next)) return 'reserved_region';
  return regions.has(next) ? null : 'unknown_region';
}
