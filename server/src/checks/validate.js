/** @import { CheckDef } from '../types.js' */

import { CAPABILITIES, MODULES, SEVERITIES } from '../config.js';

const ID_PATTERN = /^[a-z]+(\.[a-z0-9_]+){2,3}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Throw a descriptive error when a check definition breaks the contract in
 * `types.js`. Run at start-up and in tests so a malformed check can never reach a user.
 * @param {CheckDef} def
 */
export function validateCheckDef(def) {
  const where = `check ${JSON.stringify(def?.id)}`;
  /** @param {boolean} condition @param {string} message */
  const need = (condition, message) => {
    if (!condition) throw new Error(`${where}: ${message}`);
  };
  /** @param {unknown} value */
  const text = (value) => typeof value === 'string' && value.trim() !== '';

  need(typeof def === 'object' && def !== null, 'definition must be an object');
  need(typeof def.id === 'string' && ID_PATTERN.test(def.id), 'id must look like "module.area.problem"');
  need(MODULES.includes(def.module), `module must be one of ${MODULES.join(', ')}`);
  need(def.id.startsWith(`${def.module}.`), 'id must start with the module name');
  need(def.engine === 'code', 'engine must be "code"');
  need(text(def.title) && !def.title.endsWith('.'), 'title must be a non-empty string without a trailing period');
  need(text(def.description), 'description is required');
  need(text(def.recommendation), 'recommendation is required');
  need(SEVERITIES.includes(def.severity), `severity must be one of ${SEVERITIES.join(', ')}`);
  need(Number.isInteger(def.weight) && def.weight >= 0 && def.weight <= 5, 'weight must be an integer from 0 to 5');
  need((def.severity === 'info') === (def.weight === 0), 'weight must be 0 for info checks and above 0 for all others');
  need([1, 2, 3].includes(def.impact), 'impact must be 1, 2 or 3');
  need([1, 2, 3].includes(def.effort), 'effort must be 1, 2 or 3');
  need(def.confidence === 'confirmed' || def.confidence === 'likely', 'confidence must be "confirmed" or "likely"');
  need(def.scope === 'page' || def.scope === 'site', 'scope must be "page" or "site"');
  need(
    Array.isArray(def.requires) && def.requires.every((capability) => CAPABILITIES.includes(capability)),
    `requires must be a list drawn from ${CAPABILITIES.join(', ')}`,
  );
  need(typeof def.doc_ref === 'string' && def.doc_ref.startsWith('https://'), 'doc_ref must be an https URL');
  need(typeof def.last_verified === 'string' && DATE_PATTERN.test(def.last_verified), 'last_verified must be YYYY-MM-DD');
  need(typeof def.run === 'function', 'run must be a function');
}

/**
 * Validate a list of definitions and return a copy sorted by id.
 * @param {CheckDef[]} defs
 * @returns {CheckDef[]}
 */
export function prepareChecks(defs) {
  const ids = new Set();
  for (const def of defs) {
    validateCheckDef(def);
    if (ids.has(def.id)) throw new Error(`check ${JSON.stringify(def.id)} is defined twice`);
    ids.add(def.id);
  }
  return [...defs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
