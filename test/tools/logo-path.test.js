// A logo named by a project profile is checked against the project folder
// before the file is touched: on Windows, merely opening a path such as
// \\host\share\logo.png makes the system connect to that machine.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadLogo } from '../../server/src/tools/logo.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b00000000049454e44ae426082', 'hex');

/** @type {string} */
let project;
before(async () => {
  project = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seekwide-logo-')));
  await writeFile(path.join(project, 'logo.png'), PNG);
});
after(() => rm(project, { recursive: true, force: true }));

describe('a profile logo outside the project folder', () => {
  it('is refused as outside the project before anything reads the path, even when nothing is there', async () => {
    // A path that does not exist: a refusal that looked at the file first would say it could not be read.
    const missing = path.join(path.dirname(project), 'no-such-folder', 'logo.png');
    await assert.rejects(loadLogo({ path: missing, source: 'profile' }, project), /The logo that report\.logo_path in the project profile names is outside the project folder\. .*Fix or remove report\.logo_path/);
    await assert.rejects(loadLogo({ path: '../no-such-folder/logo.png', source: 'profile' }, project), /outside the project folder/);
  });

  it('refuses a network path in the same way (a UNC path on Windows, a path from the root elsewhere)', async () => {
    const share = process.platform === 'win32' ? String.raw`\\host\share\logo.png` : '//host/share/logo.png';
    await assert.rejects(loadLogo({ path: share, source: 'profile' }, project), /outside the project folder/);
  });

  it('follows no link on the way to a profile logo, also one that stays inside the project', async () => {
    await mkdir(path.join(project, 'assets'), { recursive: true });
    await writeFile(path.join(project, 'assets', 'real.png'), PNG);
    await symlink(path.join(project, 'assets'), path.join(project, 'linked-assets'));
    await symlink(path.join(project, 'logo.png'), path.join(project, 'linked.png'));
    for (const name of ['linked-assets/real.png', 'linked.png']) {
      await assert.rejects(loadLogo({ path: name, source: 'profile' }, project), /a symbolic link is on the way to it/, name);
    }
    assert.match(await loadLogo({ path: 'assets/real.png', source: 'profile' }, project), /^data:image\/png;base64,/);
  });

  it('accepts a logo under the real path of a project that is named through a link, and refuses one reached through a link', async () => {
    const alias = `${project}-alias`;
    await symlink(project, alias);
    try {
      // The project folder as the session names it (a link, like /var on macOS or a short name on Windows), the logo by its real path.
      assert.match(await loadLogo({ path: path.join(project, 'logo.png'), source: 'profile' }, alias), /^data:image\/png;base64,/);
      assert.match(await loadLogo({ path: 'logo.png', source: 'profile' }, alias), /^data:image\/png;base64,/);
      // A path through a link outside the folder that was named.
      await assert.rejects(loadLogo({ path: path.join(alias, 'logo.png'), source: 'profile' }, project), /outside the project folder/);
    } finally {
      await rm(alias, { force: true });
    }
  });

  it('still reads a logo inside the project, and a logo from the arguments wherever it is', async () => {
    assert.match(await loadLogo({ path: 'logo.png', source: 'profile' }, project), /^data:image\/png;base64,/);
    assert.match(await loadLogo({ path: path.join(project, 'logo.png'), source: 'arguments' }, path.join(project, 'sub')), /^data:image\/png;base64,/);
  });
});
