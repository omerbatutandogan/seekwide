// Which kind of web project a folder holds, and which command starts its
// local server. Decided from file names and from package.json read as data.

import path from 'node:path';
import { entryKind, readFileInside, SCAN_LIMITS } from './scan.js';
import { foldersUpward, workspaceFolders } from './workspaces.js';
import { clip } from '../util/strings.js';

/**
 * @typedef {Object} DevServer
 * @property {string|null} command   Command that starts the project's local server, to be proposed to the user; null when none is known.
 * @property {string|null} script    Text of the package.json script that `command` runs, clipped; null when `command` runs no script.
 * @property {boolean} script_clipped  True when `script`, or a script under `also_runs`, is longer than shown.
 * @property {{name: string, script: string}[]} also_runs  The `pre` and `post` scripts of that script (for
 *   example `predev` and `postdev`), clipped: npm and Yarn 1 run them with it. Empty when there are none.
 * @property {string|null} default_url  Address the server normally listens on; the server's own output is authoritative.
 * @property {'npm'|'pnpm'|'yarn'|'bun'|null} package_manager  Null when the project has no package.json.
 * @property {boolean|null} dependencies_installed  Whether a `node_modules` folder exists; null when the project has no package.json.
 */

/**
 * @typedef {Object} Detection
 * @property {'next-app'|'html'|'unsupported'|'none'} framework
 * @property {string} label          Name to show, for example "Next.js (App Router)".
 * @property {boolean} supported     True when findings can be mapped to source files.
 * @property {string} message        One or two plain sentences on what was found and what it means.
 * @property {string|null} app_dir   'app' or 'src/app' for a Next.js App Router project; null otherwise.
 * @property {{source_dir: string, label: string}[]} workspace_projects  For a folder that is not a supported web
 *   project but the root of a monorepo: the workspace folders that are one (absolute paths), to pass as `source_dir`.
 *   Empty otherwise.
 * @property {DevServer} dev_server
 */

const NEXT_CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts', 'next.config.mts'];

/** Dependencies that name a framework or bundler this version cannot map. First match wins. */
const OTHER_FRAMEWORKS = /** @type {const} */ ([
  ['astro', 'Astro'],
  ['nuxt', 'Nuxt'],
  ['@remix-run/dev', 'Remix'],
  ['@remix-run/react', 'Remix'],
  ['@sveltejs/kit', 'SvelteKit'],
  ['gatsby', 'Gatsby'],
  ['@docusaurus/core', 'Docusaurus'],
  ['@11ty/eleventy', 'Eleventy'],
  ['vitepress', 'VitePress'],
  ['@angular/core', 'Angular'],
  ['react-scripts', 'Create React App'],
  ['vite', 'Vite'],
  ['parcel', 'Parcel'],
  ['webpack', 'webpack'],
]);

/** Files that give away a project type without a package.json. First match wins. */
const MARKER_FILES = /** @type {const} */ ([
  ['wp-config.php', 'WordPress'],
  ['_config.yml', 'Jekyll'],
  ['hugo.toml', 'Hugo'],
  ['hugo.yaml', 'Hugo'],
  ['hugo.json', 'Hugo'],
  ['artisan', 'Laravel'],
  ['manage.py', 'Django'],
]);

const LOCK_FILES = /** @type {const} */ ([
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
]);

/** The port Python's built-in static server is proposed on; an unassigned one that few tools use. */
const STATIC_PORT = 4173;
/** How much of a package.json script is shown; longer ones are clipped and marked. */
const MAX_SCRIPT_SHOWN = 1000;

/**
 * package.json as data: an object, or null when the file is missing, too
 * large, not JSON or not an object. The file is parsed, never loaded as code.
 * @param {string} root
 * @returns {Promise<Record<string, unknown>|null>}
 */
async function readPackageJson(root) {
  const bytes = await readFileInside(root, 'package.json', SCAN_LIMITS.maxPackageJsonBytes);
  if (bytes === null) return null;
  try {
    // npm reads a package.json that starts with a byte order mark, as Windows editors often write one.
    const value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
const record = (value) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : {});

/**
 * @param {string} root
 * @param {string[]} names
 * @param {'file'|'dir'} kind
 * @returns {Promise<boolean>}
 */
async function anyOf(root, names, kind) {
  for (const name of names) {
    if ((await entryKind(root, name)) === kind) return true;
  }
  return false;
}

/**
 * @param {string} label
 * @param {string} message
 * @returns {Pick<Detection, 'framework'|'label'|'supported'|'message'|'app_dir'>}
 */
function unsupported(label, message) {
  return { framework: 'unsupported', label, supported: false, message, app_dir: null };
}

const URL_AUDIT = 'The site can still be audited by its address; findings then name URLs and not source files.';

/**
 * @param {string} root
 * @param {Record<string, unknown>|null} pkg
 * @returns {Promise<Pick<Detection, 'framework'|'label'|'supported'|'message'|'app_dir'>>}
 */
async function classify(root, pkg) {
  const dependencies = { ...record(pkg?.dependencies), ...record(pkg?.devDependencies) };
  const has = (/** @type {string} */ name) => Object.hasOwn(dependencies, name);

  if (has('next') || (await anyOf(root, NEXT_CONFIGS, 'file'))) {
    // Next.js ignores src/app and src/pages when app or pages exists at the root.
    const rootApp = (await entryKind(root, 'app')) === 'dir';
    const rootPages = (await entryKind(root, 'pages')) === 'dir';
    const srcApp = !rootApp && !rootPages && (await entryKind(root, 'src/app')) === 'dir';
    const srcPages = !rootApp && !rootPages && (await entryKind(root, 'src/pages')) === 'dir';
    if (rootApp || srcApp) {
      const pagesToo = rootPages || srcPages;
      return {
        framework: 'next-app',
        label: 'Next.js (App Router)',
        supported: true,
        message: `This is a Next.js project that uses the App Router.${pagesToo ? ' It also has a pages folder; routes defined there are not mapped to files yet.' : ''}`,
        app_dir: rootApp ? 'app' : 'src/app',
      };
    }
    if (rootPages || srcPages) {
      return unsupported('Next.js (Pages Router)', `This is a Next.js project that uses the Pages Router, which is not supported yet. ${URL_AUDIT}`);
    }
    return unsupported('Next.js', `This looks like a Next.js project, but it has no app folder. ${URL_AUDIT}`);
  }

  for (const [dependency, label] of OTHER_FRAMEWORKS) {
    if (has(dependency)) return unsupported(label, `This project uses ${label}, which is not supported yet. ${URL_AUDIT}`);
  }
  for (const [file, label] of MARKER_FILES) {
    if ((await entryKind(root, file)) === 'file') return unsupported(label, `This project uses ${label}, which is not supported yet. ${URL_AUDIT}`);
  }

  if (await anyOf(root, ['index.html', 'index.htm'], 'file')) {
    return { framework: 'html', label: 'Plain HTML', supported: true, message: 'This is a plain HTML site: the files in this folder are the pages.', app_dir: null };
  }
  return {
    framework: 'none',
    label: 'No web project',
    supported: false,
    message: `No web project was recognized in this folder: it has no Next.js app folder and no index.html. ${URL_AUDIT}`,
    app_dir: null,
  };
}

/**
 * @param {string} root
 * @param {Record<string, unknown>|null} pkg
 * @param {Detection['framework']} framework
 * @param {{projectDir: string, platform: NodeJS.Platform}} where
 * @returns {Promise<DevServer>}
 */
async function devServer(root, pkg, framework, { projectDir, platform }) {
  const levels = foldersUpward(root, projectDir);
  const at = (/** @type {{base: string, prefix: string}} */ level, /** @type {string} */ name) => entryKind(level.base, level.prefix === '' ? name : `${level.prefix}/${name}`);
  /** @type {DevServer['package_manager']} */
  let manager = null;
  let installed = null;
  if (pkg !== null) {
    installed = false;
    for (const level of levels) {
      for (const [file, name] of LOCK_FILES) {
        if (manager === null && (await at(level, file)) === 'file') manager = name;
      }
      if ((await at(level, 'node_modules')) === 'dir') installed = true;
    }
    manager ??= 'npm';
  }
  const scripts = record(pkg?.scripts);
  /** @param {string} name */
  const script = (name) => (typeof scripts[name] === 'string' && /** @type {string} */ (scripts[name]).trim() !== '' ? /** @type {string} */ (scripts[name]) : null);
  const base = { package_manager: manager, dependencies_installed: installed };
  const none = { script: null, script_clipped: false, also_runs: [] };
  /**
   * The script `<manager> run <name>` starts, with the scripts run before and after it.
   * @param {string} name
   * @param {string} text
   */
  const runs = (name, text) => {
    const also = [`pre${name}`, `post${name}`].flatMap((hook) => {
      const hookText = script(hook);
      return hookText === null ? [] : [{ name: hook, text: hookText }];
    });
    const clipped = [text, ...also.map((hook) => hook.text)].some((value) => value.length > MAX_SCRIPT_SHOWN);
    return {
      command: `${manager ?? 'npm'} run ${name}`,
      script: clip(text, MAX_SCRIPT_SHOWN),
      script_clipped: clipped,
      also_runs: also.map((hook) => ({ name: hook.name, script: clip(hook.text, MAX_SCRIPT_SHOWN) })),
    };
  };

  if (framework === 'next-app') {
    const dev = script('dev');
    return dev !== null
      ? { ...runs('dev', dev), default_url: 'http://localhost:3000', ...base }
      : { command: 'npx next dev', ...none, default_url: 'http://localhost:3000', ...base };
  }
  if (framework === 'html') {
    for (const name of ['dev', 'start']) {
      const text = script(name);
      if (text !== null) return { ...runs(name, text), default_url: null, ...base };
    }
    // python3 is the name on macOS and Linux; on Windows the installer from python.org provides python.
    const python = platform === 'win32' ? 'python' : 'python3';
    return { command: `${python} -m http.server ${STATIC_PORT} --bind 127.0.0.1`, ...none, default_url: `http://127.0.0.1:${STATIC_PORT}`, ...base };
  }
  return { command: null, ...none, default_url: null, ...base };
}

const MONOREPO_NEXT = 'call project_detect again with one of them as source_dir.';

/**
 * The workspaces of a monorepo root that are supported web projects.
 * @param {string} root
 * @param {Record<string, unknown>|null} pkg
 * @returns {Promise<Detection['workspace_projects']>}
 */
async function workspaceProjects(root, pkg) {
  /** @type {Detection['workspace_projects']} */
  const found = [];
  for (const folder of (await workspaceFolders(root, pkg)) ?? []) {
    const dir = path.join(root, ...folder.split('/'));
    const kind = await classify(dir, await readPackageJson(dir));
    if (kind.supported) found.push({ source_dir: dir, label: kind.label });
  }
  return found;
}

/**
 * Say what kind of web project `root` holds.
 *
 * Guarantees: only Next.js with the App Router and plain HTML are reported as
 * supported; everything else gets a message in plain words that names what was
 * found. A folder that is not supported but declares workspaces (package.json
 * or pnpm-workspace.yaml) lists those that are, under `workspace_projects`.
 * The lock file and `node_modules` are looked for in `root` and in the folders
 * above it up to `projectDir`, never above. The answer comes from file names
 * and from package.json parsed as JSON. No file of the project is executed or
 * imported, and no symbolic link is followed.
 *
 * @param {string} root  Absolute real path of the folder (see `resolveSourceDir`).
 * @param {{projectDir?: string, platform?: NodeJS.Platform}} [options]  `projectDir`: absolute real path of the
 *   project folder that holds `root` (default `root`); `platform`: where the dev server will run (default this one).
 * @returns {Promise<Detection>}
 */
export async function detectProject(root, { projectDir = root, platform = process.platform } = {}) {
  const pkg = await readPackageJson(root);
  const kind = await classify(root, pkg);
  const workspaces = kind.supported ? [] : await workspaceProjects(root, pkg);
  let { message } = kind;
  if (workspaces.length > 0) {
    message = kind.framework === 'none'
      ? `This folder is the root of a monorepo and is not a web project itself. Supported web projects were found in its workspaces (workspace_projects): ${MONOREPO_NEXT}`
      : `${message} This folder is also the root of a monorepo, and supported web projects were found in its workspaces (workspace_projects): ${MONOREPO_NEXT}`;
  }
  return { ...kind, message, workspace_projects: workspaces, dev_server: await devServer(root, pkg, kind.framework, { projectDir, platform }) };
}
