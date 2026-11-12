// Shared set-up for crawl manager tests: instant sleep, fixed clock, fake extractor, temp data dir.

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createCrawlManager } from '../../server/src/crawl/manager.js';
import { createHostGates } from '../../server/src/net/polite.js';
import { createRobotsCache } from '../../server/src/net/robots-cache.js';
import { fakeExtract } from './fake-records.js';

export const NOW = new Date('2026-11-11T14:03:22Z');

/** @type {string[]} */
const tempDirs = [];

/** @returns {Promise<string>} */
export async function tempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'seekwide-crawl-test-'));
  tempDirs.push(dir);
  return dir;
}

export async function removeTempDirs() {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
}

let counter = 0;

/**
 * Build a manager with test dependencies. `sleeps` records every requested wait. The manager has host gates
 * and a robots.txt cache of its own, so no other test's requests change its waits.
 * @param {Parameters<typeof createCrawlManager>[0]} [deps]
 */
export async function testManager(deps = {}) {
  /** @type {number[]} */
  const sleeps = [];
  const manager = createCrawlManager({
    dataDir: await tempDir(),
    extract: fakeExtract,
    now: () => NOW,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    idFactory: () => `c-test-${(counter += 1)}`,
    hosts: createHostGates(),
    robotsCache: createRobotsCache(),
    ...deps,
  });
  return { manager, sleeps };
}

/**
 * Run one crawl to the end.
 * @param {Parameters<ReturnType<typeof createCrawlManager>['start']>[0]} options
 * @param {Parameters<typeof createCrawlManager>[0]} [deps]
 */
export async function crawl(options, deps = {}) {
  const { manager, sleeps } = await testManager(deps);
  const started = await manager.start(options);
  const job = await manager.wait(started.id, 10_000);
  const result = await manager.result(started.id);
  return { manager, job, result, sleeps };
}

/**
 * An HTML route whose body links to `links`.
 * @param {string[]} links
 * @param {Record<string, string>} [headers]
 */
export function html(links, headers = {}) {
  return {
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    body: `<!doctype html><html><body>${links.map((href) => `<a href="${href}">link</a>`).join('')}</body></html>`,
  };
}
