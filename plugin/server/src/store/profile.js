/** @import { Profile } from '../types.js' */

import { SCHEMA_VERSION } from '../config.js';
import { storeError } from './errors.js';
import { STORE_LIMITS, readStoreFile, toJsonFile, writeFileAtomic } from './fs-util.js';
import { assertStoreDirs, ensureProject, projectPaths } from './project.js';
import { normalizeProfile } from './profile-validate.js';
import { isIsoDate } from './run-validate.js';

/**
 * @param {import('./profile-validate.js').FieldError[]} errors
 * @param {string} prefix
 */
function invalidProfile(errors, prefix) {
  const error = storeError('INVALID_PROFILE', `${prefix}: ${errors.map(({ field, message }) => `${field} ${message}`).join('; ')}.`);
  return Object.assign(error, { fields: errors });
}

/**
 * @param {Record<string, unknown>} fields Normalized fields from `normalizeProfile`.
 * @param {string} updatedAt
 * @returns {Profile}
 */
function assemble(fields, updatedAt) {
  const { site_url, brand, business_model, markets, competitors, target_queries, report } = fields;
  const profile = { schema_version: SCHEMA_VERSION, site_url, brand, business_model, markets, competitors, target_queries, report, updated_at: updatedAt };
  return /** @type {Profile} */ (Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined)));
}

/**
 * The saved profile, or null when none was saved yet. The file is validated on
 * the way in: a hand-edited file that is no longer valid throws
 * `INVALID_PROFILE` naming every bad field.
 * @param {string} projectDir
 * @returns {Promise<Profile|null>}
 */
export async function readProfile(projectDir) {
  const paths = projectPaths(projectDir);
  const file = paths.profile;
  await assertStoreDirs(paths);
  let text;
  try {
    text = await readStoreFile(file, STORE_LIMITS.profileBytes, paths.projectDir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return null;
    throw error;
  }
  const where = `The saved profile (${file}) is not valid`;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw invalidProfile([{ field: 'profile.json', message: 'is not valid JSON' }], where);
  }
  const { profile, errors } = normalizeProfile(parsed);
  if (profile === null) throw invalidProfile(errors, `${where}. Fix the file or save a new profile`);
  if (!isIsoDate(parsed.updated_at)) {
    throw invalidProfile([{ field: 'updated_at', message: 'must be an ISO 8601 date' }], `${where}. Fix the file or save a new profile`);
  }
  return assemble(profile, parsed.updated_at);
}

/**
 * Validate, normalize and save the profile, replacing any earlier one. Nothing
 * is written when validation fails; the error has `code: 'INVALID_PROFILE'`, a
 * message that names every bad field and a `fields` array with the same details.
 * `schema_version` and `updated_at` are always set here, whatever the input says.
 * @param {string} projectDir
 * @param {unknown} input
 * @param {Date|(() => Date)} [now]
 * @returns {Promise<Profile>}
 */
export async function writeProfile(projectDir, input, now = new Date()) {
  const date = typeof now === 'function' ? now() : now;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('writeProfile needs a valid Date for `now`.');
  const { profile: fields, errors } = normalizeProfile(input);
  if (fields === null) throw invalidProfile(errors, 'Invalid profile');
  const profile = assemble(fields, date.toISOString());
  const paths = await ensureProject(projectDir);
  await writeFileAtomic(paths.profile, toJsonFile(profile));
  return profile;
}
