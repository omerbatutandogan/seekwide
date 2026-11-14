// Questions the aso checks share (the site's side of its apps). Pure.

/** The date every rule of this module was read against its documentation. */
export const VERIFIED = '2026-11-13';

/** Fields that are the same for every aso check. */
export const ASO = Object.freeze({
  module: /** @type {const} */ ('aso'),
  engine: /** @type {const} */ ('code'),
  last_verified: VERIFIED,
});

/** Official documentation the rules are based on (CHECKS-SPEC, reference list). */
export const DOCS = Object.freeze({
  APPLE_SMART_BANNER: 'https://developer.apple.com/documentation/webkit/promoting-apps-with-smart-app-banners',
  APPLE_AASA: 'https://developer.apple.com/documentation/xcode/supporting-associated-domains',
  ANDROID_ASSETLINKS: 'https://developer.android.com/training/app-links/configure-assetlinks',
});

/**
 * The services an association file can declare: those Apple's Associated Domains Entitlement page lists (`applinks`,
 * `webcredentials`, `activitycontinuation` for Handoff, `appclips`, read 2026-11-13), and `authsrv`, which Apple's single
 * sign-on extensions use; a file that serves only one of them is a file in use.
 */
export const AASA_SERVICES = Object.freeze(['applinks', 'webcredentials', 'activitycontinuation', 'appclips', 'authsrv']);
/** The relation and namespace of a statement that lets an Android app open the site's links. */
export const HANDLE_ALL_URLS = 'delegate_permission/common.handle_all_urls';

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} value @returns {string[]} The non-empty strings of an array, trimmed. */
const strings = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()) : []);

/**
 * What an `apple-app-site-association` file declares: whether it is a JSON
 * object, which services it has, and every app identifier it names
 * (`applinks.details[].appIDs`, and `appID` of the format before iOS 13;
 * the `apps` of the other services).
 * @param {string} body
 * @returns {{json: boolean, services: string[], appIds: string[]}}
 */
export function readAasa(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { json: false, services: [], appIds: [] };
  }
  if (!isObject(data)) return { json: false, services: [], appIds: [] };
  const services = AASA_SERVICES.filter((name) => isObject(data[name]));
  /** @type {Set<string>} */
  const appIds = new Set();
  const applinks = data.applinks;
  if (isObject(applinks) && Array.isArray(applinks.details)) {
    for (const detail of applinks.details) {
      if (!isObject(detail)) continue;
      for (const id of [...strings(detail.appIDs), ...strings([detail.appID])]) appIds.add(id);
    }
  }
  for (const name of ['webcredentials', 'appclips', 'activitycontinuation', 'authsrv']) {
    const service = data[name];
    if (isObject(service)) for (const id of strings(service.apps)) appIds.add(id);
  }
  return { json: true, services, appIds: [...appIds] };
}

/**
 * What an `assetlinks.json` file declares: whether it is a JSON array, and the
 * package names of its statements that let an Android app open the site's
 * links: relation `delegate_permission/common.handle_all_urls`, target
 * namespace `android_app`, a `package_name` and at least one
 * `sha256_cert_fingerprints` entry.
 * @param {string} body
 * @returns {{array: boolean, packages: string[]}}
 */
export function readAssetLinks(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { array: false, packages: [] };
  }
  if (!Array.isArray(data)) return { array: false, packages: [] };
  /** @type {Set<string>} */
  const packages = new Set();
  for (const statement of data) {
    if (!isObject(statement) || !strings(statement.relation).includes(HANDLE_ALL_URLS)) continue;
    const target = statement.target;
    if (!isObject(target) || target.namespace !== 'android_app' || typeof target.package_name !== 'string' || target.package_name.trim() === '') continue;
    if (strings(target.sha256_cert_fingerprints).length === 0) continue;
    packages.add(target.package_name.trim());
  }
  return { array: true, packages: [...packages] };
}

/**
 * The identifiers of `wanted` that `found` lacks, compared without regard to
 * letter case: a Team ID is written in capitals, and a profile may not be.
 * @param {string[]} wanted
 * @param {string[]} found
 * @returns {string[]}
 */
export function missingIds(wanted, found) {
  const have = new Set(found.map((id) => id.toLowerCase()));
  return wanted.filter((id) => !have.has(id.toLowerCase()));
}
