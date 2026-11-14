// The app association files of the audited site (aso module): Apple's
// apple-app-site-association and Android's assetlinks.json. Read from
// `ctx.appFiles`, which the audit collects before the checks run. Pure.

/** @import { AppFileResult, CheckContext, CheckDef, CheckResult } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { ASO, DOCS, missingIds, readAasa, readAssetLinks } from './helpers.js';

/** Identifiers listed in evidence. */
const MAX_EXAMPLES = 5;

/**
 * What is wrong with how a file is served, whatever its content: a redirect
 * on the way, or an address that is not https.
 * @param {AppFileResult} file
 * @returns {string[]}
 */
function servingProblems(file) {
  return [
    file.location !== null ? 'redirect' : '',
    !file.url.startsWith('https:') ? 'not_https' : '',
  ].filter(Boolean);
}

/**
 * One result for a file that answered, at its own address.
 * @param {AppFileResult} file
 * @param {string[]} problems
 * @param {Record<string, unknown>} extra  More of what was observed.
 * @param {string} expected
 * @returns {CheckResult}
 */
function fileResult(file, problems, extra, expected) {
  if (problems.length === 0) return { status: 'pass', url: file.url };
  return {
    status: 'fail', url: file.url,
    evidence: {
      observed: { problems, status: file.status, ...(file.location === null ? {} : { redirects_to: clip(file.location, 300) }), ...extra },
      expected,
    },
  };
}

/**
 * @param {CheckContext} ctx
 * @param {'aasa'|'assetlinks'} name
 * @returns {AppFileResult|null}
 */
const fileOf = (ctx, name) => (ctx.appFiles === null ? null : ctx.appFiles[name]);

/** @type {CheckDef} */
const aasaInvalid = {
  ...ASO,
  id: 'aso.aasa.invalid',
  title: 'apple-app-site-association file is not usable',
  description:
    'Reads /.well-known/apple-app-site-association when the site serves one. Apple requires it at that address, over https with a valid certificate and with no redirects, as JSON that lists the app identifiers under one of its services (applinks, webcredentials, activitycontinuation, appclips, authsrv). When the site profile names the app (Team ID and bundle ID), the file must list it too, whatever the letter case. An HTML page or an empty answer at that address means there is no file, and is not a unit.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 2,
  confidence: 'confirmed',
  scope: 'site',
  requires: ['app_files'],
  doc_ref: DOCS.APPLE_AASA,
  recommendation: 'Serve the file at https://<host>/.well-known/apple-app-site-association, directly with status 200 and no redirect, as JSON whose applinks.details[].appIDs (or webcredentials or appclips apps) list "<Team ID>.<bundle ID>" of every app.',
  run(ctx) {
    const file = fileOf(ctx, 'aasa');
    if (file === null || file.outcome !== 'answered') return [];
    const read = readAasa(file.body ?? '');
    const declared = ctx.apps.ios?.app_ids ?? [];
    const missing = read.json ? missingIds(declared, read.appIds) : [];
    const problems = [
      ...servingProblems(file),
      !read.json ? 'not_json' : '',
      read.json && read.services.length === 0 ? 'no_service' : '',
      missing.length > 0 ? 'app_id_missing' : '',
    ].filter(Boolean);
    return [fileResult(file, problems, {
      services: read.services,
      ...(missing.length > 0 ? { missing_app_ids: missing.slice(0, MAX_EXAMPLES).map((id) => clip(id, 300)) } : {}),
    }, 'Served directly over https as JSON with applinks, webcredentials or appclips listing the app')];
  },
};

/** @type {CheckDef} */
const aasaMissing = {
  ...ASO,
  id: 'aso.aasa.missing',
  title: 'apple-app-site-association file is missing',
  description:
    'When the site profile says the iOS app opens the site\'s links (universal links), checks that /.well-known/apple-app-site-association exists. Apple verifies the association from that file; without it the links open in the browser. A site whose profile says nothing about universal links is not a unit, since an app without them needs no file.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 2,
  confidence: 'confirmed',
  scope: 'site',
  requires: ['app_files'],
  doc_ref: DOCS.APPLE_AASA,
  recommendation: 'Publish the association file at https://<host>/.well-known/apple-app-site-association (no file extension), or correct the profile if the app does not use universal links.',
  run(ctx) {
    const file = fileOf(ctx, 'aasa');
    if (file === null || ctx.apps.ios?.universal_links !== true) return [];
    if (file.outcome === 'answered') return [{ status: 'pass', url: file.url }];
    if (file.outcome !== 'not_found') return [];
    return [{ status: 'fail', url: file.url, evidence: { observed: { status: file.status, reason: file.reason }, expected: 'The file, as the profile says the app uses universal links' } }];
  },
};

/** @type {CheckDef} */
const assetLinksInvalid = {
  ...ASO,
  id: 'aso.assetlinks.invalid',
  title: 'assetlinks.json file is not usable',
  description:
    'Reads /.well-known/assetlinks.json when the site serves one. Android App Links need it over https, without redirects, with the content type application/json, as a JSON array. When the site profile says an Android app opens the site\'s links, or names its package, the file must also have a statement whose relation is delegate_permission/common.handle_all_urls and whose target is that android_app with its sha256_cert_fingerprints; a file that serves other relations only (sharing sign-in credentials) needs none. An HTML page or an empty answer at that address means there is no file, and is not a unit.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 2,
  confidence: 'confirmed',
  scope: 'site',
  requires: ['app_files'],
  doc_ref: DOCS.ANDROID_ASSETLINKS,
  recommendation: 'Serve https://<host>/.well-known/assetlinks.json directly with status 200 and Content-Type: application/json, as the array Android Studio\'s App Links Assistant generates for each package and signing certificate.',
  run(ctx) {
    const file = fileOf(ctx, 'assetlinks');
    if (file === null || file.outcome !== 'answered') return [];
    const read = readAssetLinks(file.body ?? '');
    const declared = ctx.apps.android?.packages ?? [];
    // A file can serve other relations only (sharing sign-in credentials, passkeys): it needs a link statement only
    // when the profile says an Android app opens the site's links.
    const linksDeclared = ctx.apps.android?.app_links === true || declared.length > 0;
    const missing = read.array ? declared.filter((name) => !read.packages.includes(name)) : [];
    const problems = [
      ...servingProblems(file),
      file.content_type !== 'application/json' ? 'content_type' : '',
      !read.array ? 'not_json_array' : '',
      read.array && linksDeclared && read.packages.length === 0 ? 'no_app_statement' : '',
      missing.length > 0 ? 'package_missing' : '',
    ].filter(Boolean);
    return [fileResult(file, problems, {
      content_type: file.content_type,
      packages: read.packages.slice(0, MAX_EXAMPLES).map((name) => clip(name, 300)),
      ...(missing.length > 0 ? { missing_packages: missing.slice(0, MAX_EXAMPLES).map((name) => clip(name, 300)) } : {}),
    }, 'Served directly over https as application/json, with a handle_all_urls statement for each Android app the profile names')];
  },
};

/** @type {CheckDef} */
const assetLinksMissing = {
  ...ASO,
  id: 'aso.assetlinks.missing',
  title: 'assetlinks.json file is missing',
  description:
    'When the site profile says the Android app is verified to open the site\'s links (Android App Links), checks that /.well-known/assetlinks.json exists. Android verifies the links from that file on each host; without it they open in the browser or a chooser. A site whose profile says nothing about App Links is not a unit.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 2,
  confidence: 'confirmed',
  scope: 'site',
  requires: ['app_files'],
  doc_ref: DOCS.ANDROID_ASSETLINKS,
  recommendation: 'Publish https://<host>/.well-known/assetlinks.json for the app\'s package and signing certificate, or correct the profile if the app does not use App Links.',
  run(ctx) {
    const file = fileOf(ctx, 'assetlinks');
    if (file === null || ctx.apps.android?.app_links !== true) return [];
    if (file.outcome === 'answered') return [{ status: 'pass', url: file.url }];
    if (file.outcome !== 'not_found') return [];
    return [{ status: 'fail', url: file.url, evidence: { observed: { status: file.status, reason: file.reason }, expected: 'The file, as the profile says the app uses App Links' } }];
  },
};

export const fileChecks = [aasaInvalid, aasaMissing, assetLinksInvalid, assetLinksMissing];
