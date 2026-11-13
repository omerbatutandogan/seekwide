import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ImportError } from '../../plugin/server/src/imports/errors.js';
import { IMPORT_MAX_BYTES, readImportFile } from '../../plugin/server/src/imports/read-file.js';

/** @type {string} */
let root;
/** @type {string} */
let project;
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'seekwide-import-file-'));
  project = path.join(root, 'project');
  await mkdir(path.join(project, 'exports'), { recursive: true });
  await mkdir(path.join(root, 'elsewhere'));
  await writeFile(path.join(project, 'exports', 'pages.csv'), 'Page,Clicks,Impressions\n');
  await writeFile(path.join(project, 'empty.csv'), '');
  await writeFile(path.join(root, 'elsewhere', 'secret.csv'), 'secret');
  await symlink(path.join(root, 'elsewhere', 'secret.csv'), path.join(project, 'linked.csv'));
  await symlink(path.join(project, 'exports'), path.join(project, 'linked-dir'));
  await symlink(path.join(root, 'elsewhere'), path.join(project, 'outside-dir'));
});
after(() => rm(root, { recursive: true, force: true }));

/** @param {string} code @param {RegExp} [message] */
const importError = (code, message) => (/** @type {unknown} */ error) =>
  error instanceof ImportError && error.code === code && (message === undefined || message.test(error.message));

describe('readImportFile', () => {
  it('reads a file inside the project folder by a relative or an absolute path', async () => {
    const relative = await readImportFile(project, 'exports/pages.csv');
    assert.equal(relative.bytes.toString(), 'Page,Clicks,Impressions\n');
    assert.equal(relative.relative, 'exports/pages.csv');
    assert.equal((await readImportFile(project, path.join(project, 'exports', 'pages.csv'))).relative, 'exports/pages.csv');
  });

  it('refuses a path outside the project folder before it looks at it, a network path included', async () => {
    await assert.rejects(readImportFile(project, '../elsewhere/secret.csv'), importError('OUTSIDE_PROJECT', /outside the project folder/));
    await assert.rejects(readImportFile(project, path.join(root, 'no-such', 'file.csv')), importError('OUTSIDE_PROJECT'));
    const share = process.platform === 'win32' ? String.raw`\\host\share\export.zip` : '//host/share/export.zip';
    await assert.rejects(readImportFile(project, share), importError('OUTSIDE_PROJECT'));
  });

  it('follows no symbolic link: not the file, not a folder on the way, even one that stays inside the project', async () => {
    for (const name of ['linked.csv', 'linked-dir/pages.csv', 'outside-dir/secret.csv']) {
      await assert.rejects(readImportFile(project, name), importError('NOT_FOUND', /a symbolic link is on the way to it/), name);
    }
  });

  it('refuses a folder, a missing file, an empty name and an empty file', async () => {
    await assert.rejects(readImportFile(project, 'exports'), importError('NOT_A_FILE', /is a folder/));
    await assert.rejects(readImportFile(project, '.'), importError('NOT_A_FILE', /is the project folder/));
    await assert.rejects(readImportFile(project, 'exports/missing.csv'), importError('NOT_FOUND', /does not exist/));
    await assert.rejects(readImportFile(project, '  '), importError('NOT_FOUND', /Name the export file/));
    await assert.rejects(readImportFile(project, 'empty.csv'), importError('EMPTY', /is empty/));
  });

  it('refuses a file over the size limit before reading it', async () => {
    await writeFile(path.join(project, 'big.csv'), Buffer.alloc(IMPORT_MAX_BYTES + 1, 0x61));
    await assert.rejects(readImportFile(project, 'big.csv'), importError('TOO_LARGE', /at most 10 MB/));
    await writeFile(path.join(project, 'limit.csv'), Buffer.alloc(64, 0x61));
    await assert.rejects(readImportFile(project, 'limit.csv', 63), importError('TOO_LARGE'));
    assert.equal((await readImportFile(project, 'limit.csv', 64)).bytes.length, 64);
  });
});
