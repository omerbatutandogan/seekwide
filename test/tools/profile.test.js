import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ToolError } from '../../server/src/mcp/stdio.js';
import { createTools } from '../../server/src/tools/index.js';
import { NOW, PROJECT, makeDeps, toolNamed } from './fakes.js';
import { PROFILE_NOTE } from '../../server/src/tools/profile.js';

/** @param {ReturnType<typeof makeDeps>} fake @param {string} name */
const tool = (fake, name) => toolNamed(createTools(fake.deps), name);

describe('profile_get', () => {
  it('reports a missing profile', async () => {
    assert.deepEqual(await tool(makeDeps(), 'profile_get').handler({}), { exists: false, profile: null, _note: PROFILE_NOTE });
  });

  it('returns a saved profile', async () => {
    const profile = { schema_version: 1, site_url: 'https://example.test/', brand: { name: 'Example' }, updated_at: 'x' };
    const fake = makeDeps({ profile });
    assert.deepEqual(await tool(fake, 'profile_get').handler({ project_dir: '/p' }), { exists: true, profile, _note: PROFILE_NOTE });
    assert.deepEqual(fake.calls.readProfile, [['/p']]);
  });
});

describe('profile_set', () => {
  it('saves through writeProfile with the injected clock and returns the saved profile', async () => {
    const fake = makeDeps();
    const input = { site_url: 'https://example.test/', brand: { name: 'Example' } };
    const result = await tool(fake, 'profile_set').handler({ profile: input });
    assert.deepEqual(fake.calls.writeProfile, [[PROJECT, input, NOW]]);
    assert.deepEqual(result, { project_dir: PROJECT, profile: { schema_version: 1, ...input, updated_at: NOW.toISOString() } });
  });

  it('turns an invalid profile into a ToolError that says what to do', async () => {
    const fake = makeDeps();
    await assert.rejects(tool(fake, 'profile_set').handler({ profile: { brand: { name: 'x' } } }), (error) =>
      error instanceof ToolError && error.message === 'Invalid profile: site_url is required. Fix these fields and call profile_set again.');
  });

  it('rejects a relative project_dir', async () => {
    await assert.rejects(tool(makeDeps(), 'profile_set').handler({ project_dir: '.', profile: {} }), /absolute path/);
  });
});
