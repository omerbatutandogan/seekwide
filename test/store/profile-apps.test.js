import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeProfile } from '../../plugin/server/src/store/profile-validate.js';

const BASE = { site_url: 'https://example.com', brand: { name: 'Acme' } };

test('apps: iOS app identifiers and Android packages with whether the app opens the site\'s links', () => {
  const { profile, errors } = normalizeProfile({
    ...BASE,
    apps: { ios: { app_ids: [' ABCDE12345.com.example.app ', 'ABCDE12345.com.example.app'], universal_links: true }, android: { packages: ['com.example.app'] } },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(profile?.apps, {
    ios: { app_ids: ['ABCDE12345.com.example.app'], universal_links: true },
    android: { packages: ['com.example.app'], app_links: false },
  });
  assert.deepEqual(normalizeProfile({ ...BASE, apps: {} }).profile?.apps, {});
});

test('apps: a malformed identifier, package, flag or field is named, never repeated', () => {
  const { profile, errors } = normalizeProfile({
    ...BASE,
    apps: { ios: { app_ids: ['com.example.app', 'not an id'], universal_links: 'yes' }, android: { packages: ['1com.example'], extra: 1 }, web: {} },
  });
  assert.equal(profile, null);
  assert.deepEqual(errors.map((error) => error.field).sort(), ['apps.android.extra', 'apps.android.packages[0]', 'apps.ios.app_ids[1]', 'apps.ios.universal_links', 'apps.web']);
  assert.ok(!JSON.stringify(errors).includes('not an id'));
  assert.deepEqual(normalizeProfile({ ...BASE, apps: [] }).errors, [{ field: 'apps', message: 'must be an object with ios and/or android' }]);
  assert.deepEqual(normalizeProfile({ ...BASE, apps: { ios: { app_ids: new Array(11).fill('A1.b') } } }).errors.map((error) => error.field), ['apps.ios.app_ids']);
});
