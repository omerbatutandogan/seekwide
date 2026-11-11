// Helpers for repo-mode tests: project folders made on the fly, a static file
// server over a folder, and a real crawl of it.

import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCrawlManager } from '../../server/src/crawl/manager.js';
import { listFiles } from '../../server/src/repo/scan.js';
import { startServer } from './http-server.js';

/** @import { CrawlResult } from '../../server/src/types.js' */
/** @import { Route } from './http-server.js' */

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

export const NEXT_FIXTURE = path.join(FIXTURES, 'next-app');
export const HTML_FIXTURE = path.join(FIXTURES, 'html-site');

/**
 * A temporary folder holding `files` (relative path → content). The path is
 * the real one, so it compares equal to what the plugin resolves.
 * @param {Record<string, string>} [files]
 * @returns {Promise<{dir: string, remove: () => Promise<void>}>}
 */
export async function makeTree(files = {}) {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'seekwide-repo-')));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, ...relative.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}

const TYPES = /** @type {Record<string, string>} */ ({ '.html': 'text/html', '.txt': 'text/plain', '.xml': 'application/xml' });

/**
 * Routes that answer like a static file server over `dir`: every file at its
 * path, `index.html` also at its folder's path. `change` may alter a body
 * before it is sent, to play a server that edits pages.
 * @param {string} dir
 * @param {(relative: string, body: string) => string} [change]
 * @returns {Promise<Record<string, Route>>}
 */
export async function staticRoutes(dir, change = (_, body) => body) {
  /** @type {Record<string, Route>} */
  const routes = {};
  for (const file of (await listFiles(dir)).files) {
    const type = TYPES[path.extname(file)];
    if (type === undefined) continue;
    const route = { headers: { 'content-type': type }, body: change(file, await readFile(path.join(dir, file), 'utf8')) };
    routes[`/${file}`] = route;
    if (path.basename(file) === 'index.html') routes[`/${file.slice(0, -'index.html'.length)}`] = route;
  }
  return routes;
}

/**
 * Crawl a local test server with the real crawler and return the result.
 * @param {string} origin
 * @param {string} dataDir
 * @param {number} [maxPages]
 * @returns {Promise<CrawlResult>}
 */
export async function crawlLocal(origin, dataDir, maxPages = 50) {
  const manager = createCrawlManager({ dataDir, sleep: async () => {} });
  const job = await manager.start({ url: `${origin}/`, maxPages, allowLoopback: true });
  const done = await manager.wait(job.id, 30_000);
  if (done?.status !== 'done') throw new Error(`crawl ended as ${done?.status}: ${done?.error}`);
  return /** @type {CrawlResult} */ (await manager.result(job.id));
}

export { startServer };
