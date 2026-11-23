// The fixed hosts the plugin's server reaches are the ones its manifest
// declares under network.hosts. The audited sites are named by the user, so
// they cannot be listed there.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { CRUX_ENDPOINT } from '../../plugin/server/src/vitals/crux.js';
import { PSI_ENDPOINT } from '../../plugin/server/src/vitals/psi.js';

test('plugin.json declares exactly the hosts of the Google APIs the server calls', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../plugin/.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  const called = [PSI_ENDPOINT, CRUX_ENDPOINT].map((endpoint) => new URL(endpoint).host).sort();
  assert.deepEqual([...manifest.network.hosts].sort(), called);
});
