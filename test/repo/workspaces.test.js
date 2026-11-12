// detectProject in a monorepo and on other platforms: the web project in a
// subfolder, dependencies and lock files at the workspace root, the root of a
// monorepo that is not a web project itself, a package.json with a byte order
// mark, and the static server command on Windows.

import assert from 'node:assert/strict';
import { mkdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import { detectProject } from '../../server/src/repo/detect.js';
import { listDirs } from '../../server/src/repo/scan.js';
import { loadProjectSources } from '../../server/src/repo/sources.js';
import { MAX_WORKSPACE_FOLDERS, workspaceFolders } from '../../server/src/repo/workspaces.js';
import { MONOREPO_FIXTURE, makeTree } from '../helpers/repo.js';

const WEB_PKG = JSON.stringify({ name: '@x/web', dependencies: { next: '16.4.6' }, scripts: { dev: 'next dev' } });
const ROOT_PKG = JSON.stringify({ name: 'x', private: true, workspaces: ['apps/*', 'packages/*'] });

/**
 * Run `body` on a temporary tree of `files` and remove it afterwards.
 * @template T
 * @param {Record<string, string>} files
 * @param {(dir: string) => Promise<T>} body
 * @returns {Promise<T>}
 */
async function withTree(files, body) {
  const tree = await makeTree(files);
  try {
    return await body(tree.dir);
  } finally {
    await tree.remove();
  }
}

describe('a web project in a subfolder of the project folder', () => {
  it('sees dependencies installed at the workspace root, where npm, Yarn and Bun put them', async () => {
    await withTree({ 'package.json': ROOT_PKG, 'package-lock.json': '{}', 'node_modules/next/package.json': '{}', 'apps/web/package.json': WEB_PKG, 'apps/web/app/page.jsx': '' }, async (dir) => {
      const sources = await loadProjectSources(dir, path.join(dir, 'apps', 'web'));
      assert.equal(sources.detection.framework, 'next-app');
      assert.equal(sources.detection.dev_server.dependencies_installed, true);
      assert.equal(sources.detection.dev_server.command, 'npm run dev');
    });
  });

  it('names the package manager from a lock file at the workspace root', async () => {
    for (const [lock, manager] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun']]) {
      await withTree({ 'package.json': ROOT_PKG, [lock]: '', 'apps/web/package.json': WEB_PKG, 'apps/web/app/page.jsx': '' }, async (dir) => {
        const sources = await loadProjectSources(dir, path.join(dir, 'apps', 'web'));
        assert.equal(sources.detection.dev_server.command, `${manager} run dev`, lock);
        assert.equal(sources.detection.dev_server.package_manager, manager);
      });
    }
  });

  it('prefers the lock file and dependencies nearest to the web project', async () => {
    await withTree({ 'yarn.lock': '', 'apps/web/package.json': WEB_PKG, 'apps/web/pnpm-lock.yaml': '', 'apps/web/app/page.jsx': '' }, async (dir) => {
      const sources = await loadProjectSources(dir, path.join(dir, 'apps', 'web'));
      assert.equal(sources.detection.dev_server.package_manager, 'pnpm');
      assert.equal(sources.detection.dev_server.dependencies_installed, false);
    });
  });

  it('takes the nearest lock file, also an npm one below a yarn.lock, and looks at every level in between', async () => {
    await withTree({ 'yarn.lock': '', 'apps/web/package.json': WEB_PKG, 'apps/web/package-lock.json': '{}', 'apps/web/app/page.jsx': '' }, async (dir) => {
      const sources = await loadProjectSources(dir, path.join(dir, 'apps', 'web'));
      assert.equal(sources.detection.dev_server.package_manager, 'npm');
    });
    await withTree({ 'yarn.lock': '', 'group/pnpm-lock.yaml': '', 'group/node_modules/next/package.json': '{}', 'group/apps/web/package.json': WEB_PKG, 'group/apps/web/app/page.jsx': '' }, async (dir) => {
      const sources = await loadProjectSources(dir, path.join(dir, 'group', 'apps', 'web'));
      assert.equal(sources.detection.dev_server.package_manager, 'pnpm');
      assert.equal(sources.detection.dev_server.dependencies_installed, true);
    });
  });

  it('never looks above the project folder', async () => {
    await withTree({ 'pnpm-lock.yaml': '', 'node_modules/next/package.json': '{}', 'project/apps/web/package.json': WEB_PKG, 'project/apps/web/app/page.jsx': '' }, async (dir) => {
      const project = path.join(dir, 'project');
      const sources = await loadProjectSources(project, path.join(project, 'apps', 'web'));
      assert.equal(sources.detection.dev_server.package_manager, 'npm');
      assert.equal(sources.detection.dev_server.dependencies_installed, false);
    });
  });

  it('does not take a lock file or node_modules on the way that is a symbolic link', async () => {
    await withTree({ 'apps/web/package.json': WEB_PKG, 'apps/web/app/page.jsx': '', 'elsewhere/node_modules/next/package.json': '{}', 'elsewhere/yarn.lock': '' }, async (dir) => {
      await symlink(path.join(dir, 'elsewhere', 'node_modules'), path.join(dir, 'node_modules'));
      await symlink(path.join(dir, 'elsewhere', 'yarn.lock'), path.join(dir, 'yarn.lock'));
      const sources = await loadProjectSources(dir, path.join(dir, 'apps', 'web'));
      assert.equal(sources.detection.dev_server.package_manager, 'npm');
      assert.equal(sources.detection.dev_server.dependencies_installed, false);
    });
  });
});

describe('the root of a monorepo', () => {
  it('lists the supported web projects of its workspaces, and is not a web project itself', async () => {
    const found = await detectProject(MONOREPO_FIXTURE);
    assert.equal(found.framework, 'none');
    assert.equal(found.supported, false);
    assert.deepEqual(found.workspace_projects, [{ source_dir: path.join(MONOREPO_FIXTURE, 'apps', 'web'), label: 'Next.js (App Router)' }]);
    assert.match(found.message, /root of a monorepo/);
    assert.match(found.message, /workspace_projects/);
    assert.match(found.message, /source_dir/);
  });

  it('reads the workspaces of package.json in both forms, and of pnpm-workspace.yaml', async () => {
    const site = { 'index.html': '<!doctype html><title>Site</title>' };
    const app = { 'package.json': WEB_PKG, 'app/page.jsx': '' };
    const under = (/** @type {string} */ prefix, /** @type {Record<string, string>} */ files) => Object.fromEntries(Object.entries(files).map(([name, text]) => [`${prefix}/${name}`, text]));
    const layouts = [
      { 'package.json': JSON.stringify({ workspaces: ['apps/*', 'site'] }), ...under('apps/web', app), ...under('site', site) },
      { 'package.json': JSON.stringify({ workspaces: { packages: ['./apps/*/', 'site'] } }), ...under('apps/web', app), ...under('site', site) },
      { 'package.json': '{}', 'pnpm-workspace.yaml': "packages:\n  - 'apps/*'   # the apps\n  - \"site\"\ncatalog:\n  react: 19.3.1\n", ...under('apps/web', app), ...under('site', site) },
    ];
    for (const files of layouts) {
      await withTree(files, async (dir) => {
        const found = await detectProject(dir);
        assert.deepEqual(found.workspace_projects, [
          { source_dir: path.join(dir, 'apps', 'web'), label: 'Next.js (App Router)' },
          { source_dir: path.join(dir, 'site'), label: 'Plain HTML' },
        ], Object.keys(files).join(' '));
      });
    }
  });

  it('leaves out workspaces that are not supported, links, dot folders and patterns it does not expand', async () => {
    const files = {
      'package.json': JSON.stringify({ workspaces: ['apps/*', '../outside/*', 'tools/**', '!apps/legacy', '/abs/*', 'packages/*'] }),
      'apps/vite/package.json': JSON.stringify({ devDependencies: { vite: '7' } }),
      'apps/vite/index.html': '',
      'apps/.hidden/index.html': '',
      'apps/node_modules/index.html': '',
      'apps/empty/README.md': '',
      'tools/deep/web/index.html': '',
      'real/index.html': '',
    };
    await withTree(files, async (dir) => {
      await mkdir(path.join(dir, 'packages'));
      await symlink(path.join(dir, 'real'), path.join(dir, 'apps', 'linked'));
      await symlink(path.join(dir, 'real'), path.join(dir, 'packages', 'linked'));
      const found = await detectProject(dir);
      assert.deepEqual(found.workspace_projects, []);
      assert.match(found.message, /No web project was recognized/);
    });
  });

  it('names its workspaces also when a tool in its own package.json is a framework it does not support', async () => {
    const files = { 'package.json': JSON.stringify({ workspaces: ['apps/*'], devDependencies: { vite: '7' } }), 'apps/web/package.json': WEB_PKG, 'apps/web/app/page.jsx': '' };
    await withTree(files, async (dir) => {
      const found = await detectProject(dir);
      assert.equal(found.framework, 'unsupported');
      assert.deepEqual(found.workspace_projects, [{ source_dir: path.join(dir, 'apps', 'web'), label: 'Next.js (App Router)' }]);
      assert.match(found.message, /^This project uses Vite, which is not supported yet\..* root of a monorepo/);
    });
  });

  it('gives no workspace list for a folder that declares no workspaces, or that is a web project itself', async () => {
    await withTree({ 'README.md': '', 'apps/web/package.json': WEB_PKG, 'apps/web/app/page.jsx': '' }, async (dir) => {
      assert.deepEqual((await detectProject(dir)).workspace_projects, []);
    });
    await withTree({ 'package.json': JSON.stringify({ workspaces: ['apps/*'], dependencies: { next: '16' } }), 'app/page.jsx': '', 'apps/web/package.json': WEB_PKG, 'apps/web/app/page.jsx': '' }, async (dir) => {
      const found = await detectProject(dir);
      assert.equal(found.framework, 'next-app');
      assert.deepEqual(found.workspace_projects, []);
    });
  });

  it('stops at a fixed number of workspace folders', async () => {
    /** @type {Record<string, string>} */
    const files = { 'package.json': JSON.stringify({ workspaces: ['sites/*'] }) };
    for (let i = 0; i < 70; i += 1) files[`sites/s${String(i).padStart(2, '0')}/index.html`] = '';
    await withTree(files, async (dir) => {
      const found = await detectProject(dir);
      assert.equal(found.workspace_projects.length, 50);
    });
  });
});

describe('workspace patterns: limits and forms', () => {
  it('reads a pattern of 200 KB of slashes in linear time', async () => {
    const long = `${'/'.repeat(200_000)}x`;
    for (const files of [
      { 'package.json': JSON.stringify({ workspaces: [long] }) },
      { 'package.json': '{}', 'pnpm-workspace.yaml': `packages:\n  - ${'/'.repeat(60_000)}x\n` },
    ]) {
      await withTree(files, async (dir) => {
        const started = performance.now();
        assert.deepEqual(await workspaceFolders(dir, JSON.parse(files['package.json'])), []);
        assert.ok(performance.now() - started < 1000, `took ${Math.round(performance.now() - started)} ms`);
      });
    }
  });

  it('follows no symbolic link: not as the workspace, not on the way to it', async () => {
    await withTree({ 'package.json': '{}', 'outside/site/index.html': '', 'outside/apps/web/index.html': '', 'project/real/index.html': '' }, async (dir) => {
      const project = path.join(dir, 'project');
      await symlink(path.join(dir, 'outside', 'site'), path.join(project, 'site'));
      await symlink(path.join(dir, 'outside', 'apps'), path.join(project, 'apps'));
      assert.deepEqual(await workspaceFolders(project, { workspaces: ['site', 'apps/web', 'apps/*', 'real'] }), ['real']);
    });
  });

  it('never names node_modules or a dot folder, also when a pattern spells it out', async () => {
    const files = { 'node_modules/real/index.html': '', 'node_modules/star/index.html': '', 'a/node_modules/b/index.html': '', '.config/site/index.html': '', 'site/index.html': '' };
    await withTree(files, async (dir) => {
      const pkg = { workspaces: ['node_modules/real', 'a/node_modules/b', 'node_modules/*', '.config/site', '.config/*', 'site'] };
      assert.deepEqual(await workspaceFolders(dir, pkg), ['site']);
    });
  });

  it('ignores entries that are not strings, names each folder once, and stops at 50 patterns', async () => {
    await withTree({ 'site/index.html': '', 'late/index.html': '' }, async (dir) => {
      assert.deepEqual(await workspaceFolders(dir, { workspaces: [1, null, { x: 1 }, 'site', './site', 'site/'] }), ['site']);
      const many = [...Array.from({ length: 50 }, (_, i) => `missing${i}`), 'late'];
      assert.deepEqual(await workspaceFolders(dir, { workspaces: many }), []);
    });
  });

  it('expands * at the root, and keeps the first 50 folders in name order', async () => {
    /** @type {Record<string, string>} */
    const files = {};
    for (let i = 59; i >= 0; i -= 1) files[`s${String(i).padStart(2, '0')}/index.html`] = '';
    await withTree(files, async (dir) => {
      const folders = await workspaceFolders(dir, { workspaces: ['*'] });
      assert.equal(folders?.length, MAX_WORKSPACE_FOLDERS);
      assert.deepEqual(folders?.slice(0, 2), ['s00', 's01']);
      assert.equal(folders?.at(-1), 's49');
    });
    /** @type {Record<string, string>} */
    const two = {};
    for (let i = 0; i < 40; i += 1) {
      two[`a/x${String(i).padStart(2, '0')}/index.html`] = '';
      two[`b/y${String(i).padStart(2, '0')}/index.html`] = '';
    }
    await withTree(two, async (dir) => {
      const folders = await workspaceFolders(dir, { workspaces: ['a/*', 'b/*'] });
      assert.equal(folders?.length, MAX_WORKSPACE_FOLDERS, 'the cap holds across patterns');
      assert.equal(folders?.at(-1), 'b/y09');
    });
  });

  it('reads the packages list of pnpm-workspace.yaml only: a flow list, the end of a block list, a key nested elsewhere', async () => {
    const tree = { 'apps/web/index.html': '', 'site/index.html': '', 'esbuild/index.html': '', 'evil/index.html': '' };
    const cases = [
      ["packages: ['apps/*', \"site\"]\n", ['apps/web', 'site']],
      ['packages:\n  - apps/*\nonlyBuiltDependencies:\n  - esbuild\n', ['apps/web']],
      ['catalog:\n  packages:\n    - evil\npackages:\n  - site\n', ['site']],
      ['packages:\r\n\t- site\r\n', ['site']],
    ];
    for (const [yaml, expected] of cases) {
      await withTree({ ...tree, 'pnpm-workspace.yaml': /** @type {string} */ (yaml) }, async (dir) => {
        assert.deepEqual(await workspaceFolders(dir, null), expected, JSON.stringify(yaml));
      });
    }
  });

  it('does not read a pnpm-workspace.yaml larger than 64 KB', async () => {
    await withTree({ 'site/index.html': '', 'pnpm-workspace.yaml': `packages:\n  - site\n# ${'x'.repeat(70_000)}\n` }, async (dir) => {
      assert.equal(await workspaceFolders(dir, null), null);
    });
  });
});

describe('listDirs', () => {
  it('lists folders only, never through a link on the way, without node_modules, dot folders or names with control or direction characters', async () => {
    const rlo = String.fromCodePoint(0x202e);
    await withTree({ 'outside/a/x': '', 'apps/b/x': '', 'apps/a/x': '', 'apps/file': '', 'apps/node_modules/x': '', 'apps/.hidden/x': '' }, async (dir) => {
      await mkdir(path.join(dir, 'apps', `bad${rlo}name`));
      if (process.platform !== 'win32') await mkdir(path.join(dir, 'apps', 'tab\tname'));
      await symlink(path.join(dir, 'outside'), path.join(dir, 'linked'));
      assert.deepEqual(await listDirs(dir, 'apps', 10), ['a', 'b']);
      assert.deepEqual(await listDirs(dir, 'linked', 10), []);
      assert.deepEqual(await listDirs(dir, 'apps', 1), ['a']);
    });
  });
});

describe('package.json with a byte order mark', () => {
  it('is read like any other package.json, as npm does', async () => {
    await withTree({ 'package.json': `﻿${WEB_PKG}`, 'app/page.jsx': '' }, async (dir) => {
      const found = await detectProject(dir);
      assert.equal(found.framework, 'next-app');
      assert.equal(found.dev_server.command, 'npm run dev');
    });
  });
});

describe('the static server command on Windows', () => {
  it('uses python on Windows, where python3 is usually not installed, and python3 elsewhere', async () => {
    await withTree({ 'index.html': '' }, async (dir) => {
      const windows = await detectProject(dir, { platform: 'win32' });
      assert.equal(windows.dev_server.command, 'python -m http.server 4173 --bind 127.0.0.1');
      for (const platform of /** @type {NodeJS.Platform[]} */ (['darwin', 'linux'])) {
        assert.equal((await detectProject(dir, { platform })).dev_server.command, 'python3 -m http.server 4173 --bind 127.0.0.1');
      }
    });
  });
});

describe('the monorepo fixture through loadProjectSources', () => {
  it('names files as paths from the project folder and routes of the web app', async () => {
    const sources = await loadProjectSources(MONOREPO_FIXTURE, path.join(MONOREPO_FIXTURE, 'apps', 'web'));
    assert.equal(sources.relative, 'apps/web');
    assert.deepEqual(sources.routes.map(({ route, file }) => `${route} ${file}`), [
      '/ app/page.jsx',
      '/docs/[...slug] app/docs/[...slug]/page.jsx',
      '/pricing app/pricing/page.jsx',
    ]);
    assert.equal(sources.resolve('/docs/install')?.file, 'app/docs/[...slug]/page.jsx');
    assert.equal(sources.resolve('/robots.txt')?.file, 'public/robots.txt');
  });
});
