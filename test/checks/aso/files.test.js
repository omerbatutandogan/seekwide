import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readAasa, readAssetLinks } from '../../../plugin/server/src/checks/aso/helpers.js';
import { SITE } from '../../helpers/factories.js';
import { appFiles, audit, counts, findingsFor } from './support.js';

const AASA = JSON.stringify({ applinks: { details: [{ appIDs: ['ABCDE12345.com.example.app'], components: [{ '/': '/buy/*' }] }] } });
const FINGERPRINT = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
const ASSETLINKS = JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'com.example', sha256_cert_fingerprints: [FINGERPRINT] } }]);

test('readAasa finds the services and every app identifier, the format before iOS 13 included', () => {
  assert.deepEqual(readAasa(AASA), { json: true, services: ['applinks'], appIds: ['ABCDE12345.com.example.app'] });
  const all = JSON.stringify({ applinks: { apps: [], details: [{ appID: 'OLD1234567.com.old' }] }, webcredentials: { apps: ['ABCDE12345.com.example.app'] }, appclips: { apps: ['ABCDE12345.com.example.app.Clip'] } });
  assert.deepEqual(readAasa(all), { json: true, services: ['applinks', 'webcredentials', 'appclips'], appIds: ['OLD1234567.com.old', 'ABCDE12345.com.example.app', 'ABCDE12345.com.example.app.Clip'] });
  assert.deepEqual(readAasa('[]'), { json: false, services: [], appIds: [] });
  assert.deepEqual(readAasa('{"applinks": "x"}'), { json: true, services: [], appIds: [] });
});

test('readAssetLinks keeps only complete handle_all_urls statements for Android apps', () => {
  assert.deepEqual(readAssetLinks(ASSETLINKS), { array: true, packages: ['com.example'] });
  const partial = JSON.stringify([
    { relation: ['delegate_permission/common.get_login_creds'], target: { namespace: 'android_app', package_name: 'a.b', sha256_cert_fingerprints: [FINGERPRINT] } },
    { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'web', site: 'https://example.test' } },
    { relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'c.d', sha256_cert_fingerprints: [] } },
  ]);
  assert.deepEqual(readAssetLinks(partial), { array: true, packages: [] });
  assert.deepEqual(readAssetLinks('{}'), { array: false, packages: [] });
});

test('the file checks are skipped, with a reason, when the files were not read', () => {
  const result = audit({ files: null });
  for (const id of ['aso.aasa.invalid', 'aso.aasa.missing', 'aso.assetlinks.invalid', 'aso.assetlinks.missing']) assert.equal(counts(result, id), 'skipped', id);
});

test('aso.aasa.invalid passes a good file and has no unit for a site that serves none', () => {
  assert.deepEqual(counts(audit({ files: appFiles({ body: AASA }) }), 'aso.aasa.invalid'), [1, 0]);
  assert.deepEqual(counts(audit({ files: appFiles() }), 'aso.aasa.invalid'), [0, 0]);
  assert.deepEqual(counts(audit({ files: appFiles({ outcome: 'unverifiable', status: 403, body: null }) }), 'aso.aasa.invalid'), [0, 0], 'a refusal');
});

test('aso.aasa.invalid fails a redirect, an address without https, a body that is not JSON, no service, and an app the profile names but the file lacks', () => {
  const result = audit({ files: appFiles({ status: 301, location: 'https://www.example.test/.well-known/apple-app-site-association', body: 'not json' }) });
  assert.deepEqual(findingsFor(result, 'aso.aasa.invalid')[0].evidence.observed, {
    problems: ['redirect', 'not_json'], status: 301, redirects_to: 'https://www.example.test/.well-known/apple-app-site-association', services: [],
  });
  const http = audit({ files: appFiles({ url: 'http://example.test/.well-known/apple-app-site-association', body: '{"other": {}}' }) });
  assert.deepEqual(findingsFor(http, 'aso.aasa.invalid')[0].evidence.observed.problems, ['not_https', 'no_service']);
  const missing = audit({ files: appFiles({ body: AASA }), apps: { ios: { app_ids: ['ABCDE12345.com.example.app', 'ABCDE12345.com.example.other'], universal_links: true } } });
  const [finding] = findingsFor(missing, 'aso.aasa.invalid');
  assert.deepEqual(finding.evidence.observed.missing_app_ids, ['ABCDE12345.com.example.other']);
  assert.deepEqual([finding.url, finding.severity, finding.weight], [`${SITE}/.well-known/apple-app-site-association`, 'high', 4]);
});

test('aso.aasa.missing is a unit only when the profile says the app uses universal links', () => {
  const ios = { ios: { app_ids: [], universal_links: true } };
  assert.deepEqual(counts(audit({ files: appFiles(), apps: {} }), 'aso.aasa.missing'), [0, 0]);
  assert.deepEqual(counts(audit({ files: appFiles(), apps: { ios: { app_ids: ['ABCDE12345.a.b'], universal_links: false } } }), 'aso.aasa.missing'), [0, 0]);
  const missing = audit({ files: appFiles(), apps: ios });
  assert.deepEqual(counts(missing, 'aso.aasa.missing'), [1, 1]);
  assert.deepEqual(findingsFor(missing, 'aso.aasa.missing')[0].evidence.observed, { status: 404, reason: null });
  assert.deepEqual(counts(audit({ files: appFiles({ body: AASA }), apps: ios }), 'aso.aasa.missing'), [1, 0]);
  assert.deepEqual(counts(audit({ files: appFiles({ outcome: 'disallowed', status: 0, body: null }), apps: ios }), 'aso.aasa.missing'), [0, 0]);
});

test('aso.assetlinks.invalid checks the content type, the array, the statements and the profile\'s packages', () => {
  assert.deepEqual(counts(audit({ files: appFiles(undefined, { body: ASSETLINKS }) }), 'aso.assetlinks.invalid'), [1, 0]);
  const wrongType = audit({ files: appFiles(undefined, { body: ASSETLINKS, content_type: 'text/plain' }), apps: { android: { packages: ['com.example', 'com.other'], app_links: true } } });
  assert.deepEqual(findingsFor(wrongType, 'aso.assetlinks.invalid')[0].evidence.observed, {
    problems: ['content_type', 'package_missing'], status: 200, content_type: 'text/plain', packages: ['com.example'], missing_packages: ['com.other'],
  });
  const notArray = audit({ files: appFiles(undefined, { body: '{"relation": []}' }) });
  assert.deepEqual(findingsFor(notArray, 'aso.assetlinks.invalid')[0].evidence.observed.problems, ['not_json_array']);
  const empty = audit({ files: appFiles(undefined, { body: '[]' }), apps: { android: { packages: [], app_links: true } } });
  assert.deepEqual(findingsFor(empty, 'aso.assetlinks.invalid')[0].evidence.observed.problems, ['no_app_statement']);
});

test('aso.assetlinks.missing is a unit only when the profile says the app uses App Links', () => {
  const android = { android: { packages: ['com.example'], app_links: true } };
  assert.deepEqual(counts(audit({ files: appFiles(), apps: {} }), 'aso.assetlinks.missing'), [0, 0]);
  assert.deepEqual(counts(audit({ files: appFiles(), apps: android }), 'aso.assetlinks.missing'), [1, 1]);
  assert.deepEqual(counts(audit({ files: appFiles(undefined, { body: ASSETLINKS }), apps: android }), 'aso.assetlinks.missing'), [1, 0]);
});

test('a file for sign-in credentials only is a correct file when the profile declares no Android app links (review of batch 1, D4)', () => {
  const passkeys = JSON.stringify([{ relation: ['delegate_permission/common.get_login_creds'], target: { namespace: 'android_app', package_name: 'com.ok.app', sha256_cert_fingerprints: [FINGERPRINT] } }]);
  assert.deepEqual(counts(audit({ files: appFiles(undefined, { body: passkeys }) }), 'aso.assetlinks.invalid'), [1, 0]);
  const declared = audit({ files: appFiles(undefined, { body: passkeys }), apps: { android: { packages: ['com.ok.app'], app_links: false } } });
  assert.deepEqual(findingsFor(declared, 'aso.assetlinks.invalid')[0].evidence.observed.problems, ['no_app_statement', 'package_missing']);
});

test('an association file with any of Apple\'s services is in use, and identifiers compare without regard to case', () => {
  for (const service of ['activitycontinuation', 'webcredentials', 'authsrv']) {
    const body = JSON.stringify({ [service]: { apps: ['ABCDE12345.com.example.app'] } });
    assert.deepEqual(counts(audit({ files: appFiles({ body }) }), 'aso.aasa.invalid'), [1, 0], service);
  }
  const lower = audit({ files: appFiles({ body: AASA }), apps: { ios: { app_ids: ['abcde12345.com.example.app'], universal_links: true } } });
  assert.deepEqual(counts(lower, 'aso.aasa.invalid'), [1, 0]);
});

test('evidence keeps package names short, however long the file writes them', () => {
  const huge = JSON.stringify([{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: 'p'.repeat(500_000), sha256_cert_fingerprints: ['AA'] } }]);
  const result = audit({ files: appFiles(undefined, { body: huge, content_type: 'text/plain' }) });
  const [finding] = findingsFor(result, 'aso.assetlinks.invalid');
  assert.ok(JSON.stringify(finding.evidence).length < 2000);
  assert.ok(/** @type {string[]} */ (finding.evidence.observed.packages)[0].length <= 300);
});
