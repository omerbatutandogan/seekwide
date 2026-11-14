// Helpers shared by the aso check tests. Not a test file itself.

import { buildContext, runChecks } from '../../../plugin/server/src/checks/engine.js';
import { checks } from '../../../plugin/server/src/checks/aso/index.js';
import { SITE, makeCrawl, makePage } from '../../helpers/factories.js';

/** @import { AppFileResult, AppFiles, AppsProfile, PageRecord } from '../../../plugin/server/src/types.js' */

export const NOW = '2026-11-13T00:00:00.000Z';

/**
 * @param {'aasa'|'assetlinks'} name
 * @param {Partial<AppFileResult>} [overrides]  By default a file that answered 200 with an empty JSON object.
 * @returns {AppFileResult}
 */
export function appFile(name, overrides = {}) {
  const path = name === 'aasa' ? '/.well-known/apple-app-site-association' : '/.well-known/assetlinks.json';
  return { url: `${SITE}${path}`, outcome: 'answered', status: 200, reason: null, location: null, final_url: null, content_type: 'application/json', body: '{}', ...overrides };
}

/**
 * @param {Partial<AppFileResult>} [aasa]
 * @param {Partial<AppFileResult>} [assetlinks]
 * @returns {AppFiles}
 */
export function appFiles(aasa = { outcome: 'not_found', status: 404, body: null }, assetlinks = { outcome: 'not_found', status: 404, body: null }) {
  return { aasa: appFile('aasa', aasa), assetlinks: appFile('assetlinks', assetlinks) };
}

/**
 * Run every aso check.
 * @param {{pages?: PageRecord[], files?: AppFiles|null, apps?: AppsProfile}} [options]
 */
export function audit({ pages = [makePage()], files = null, apps = {} } = {}) {
  const ctx = buildContext(makeCrawl({ pages }), { appFiles: files, apps });
  return runChecks(checks, ctx, { modules: ['aso'], detectedAt: NOW });
}

/** @param {{checks: import('../../../plugin/server/src/types.js').CheckStat[]}} result @param {string} id */
export const counts = (result, id) => {
  const stat = result.checks.find((entry) => entry.id === id);
  if (!stat) throw new Error(`no stat for ${id}`);
  return stat.status === 'skipped' ? 'skipped' : [stat.applicable, stat.failed];
};

/** @param {{findings: import('../../../plugin/server/src/types.js').Finding[]}} result @param {string} id */
export const findingsFor = (result, id) => result.findings.filter((finding) => finding.check_id === id);
