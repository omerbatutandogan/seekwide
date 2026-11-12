// Not a test of its own: test/integration/server-process.test.js runs this
// file with `node --test` to show that a test which starts the server and then
// fails an assertion ends at once and reports the failure.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';

import { startProcess, stopAll } from './server-process.js';

afterEach(stopAll);

test('a test that fails while the server runs', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'seekwide-fail-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const { request } = startProcess(dir, { SEEKWIDE_DATA_DIR: path.join(dir, 'data'), CLAUDE_PROJECT_DIR: dir });
  const pong = await request({ id: 1, method: 'ping' });
  assert.deepEqual(pong.result, { pong: 'never' }, 'this assertion fails on purpose');
});
