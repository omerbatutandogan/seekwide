// Whether a schema.org type is LocalBusiness or one of its subtypes, the types
// Google's local business rules apply to. The list is read from
// server/data/local-business-types.json (scripts/gen-local-business-types.js)
// once, when first asked.

import { readFileSync } from 'node:fs';

const DATA = new URL('../../data/local-business-types.json', import.meta.url);

/** @type {Set<string>|null} */
let loaded = null;

/**
 * @param {string} type  A `@type` value: `Dentist`, `schema:Dentist` or `https://schema.org/Dentist`.
 * @returns {boolean}
 */
export function isLocalBusinessType(type) {
  loaded ??= new Set(String(JSON.parse(readFileSync(DATA, 'utf8')).types).split(' ').filter(Boolean));
  const name = type.trim().replace(/^(?:https?:\/\/schema\.org\/|schema:)/i, '');
  return loaded.has(name);
}
