// The real dependencies of the tools, built from the environment. Kept apart
// from index.js, which starts the server when it is loaded, so that the wiring
// can be tested on its own.

import { allChecks } from './checks/registry.js';
import { dataDir, defaultProjectDir, googleApiKeySetting, toolSettings } from './config.js';
import { createCrawlManager } from './crawl/manager.js';
import { fetchAppFiles } from './net/app-files.js';
import { checkImageFiles } from './net/image-check.js';
import { checkExternalLinks } from './net/link-check.js';
import { renderHtml } from './report/html.js';
import { renderMarkdown } from './report/markdown.js';
import { attachSources, loadProjectSources } from './repo/sources.js';
import { compareRuns, ensureProject, listRuns, loadRun, loadSearchImport, newRunId, projectPaths, readProfile, saveRun, saveSearchImport, writeProfile } from './store/index.js';
import { measureVitals } from './vitals/measure.js';

/** @import { ToolDeps } from './tools/index.js' */

/**
 * Build the dependencies the tools run with.
 *
 * Guarantees: the Google API key is read from `env` here and nowhere else, and
 * only to be bound into `measureVitals`; `env` in the result holds the two
 * report settings and nothing else, so no tool can read the key, or any other
 * variable, from the server's environment. Nothing is read from disk or sent
 * anywhere until a tool is called.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {typeof measureVitals} [measure]  The measurement; tests replace it.
 * @returns {ToolDeps}
 */
export function createToolDeps(env = process.env, measure = measureVitals) {
  return {
    crawlManager: createCrawlManager({ dataDir: dataDir(env) }),
    checks: allChecks(),
    projectPaths,
    ensureProject,
    newRunId,
    saveRun,
    loadRun,
    listRuns,
    readProfile,
    writeProfile,
    compareRuns,
    renderMarkdown,
    renderHtml,
    checkExternalLinks,
    checkImageFiles,
    fetchAppFiles,
    // A key that is set but cannot be used is said to be unusable, never taken for no key.
    measureVitals: (crawl, options) => {
      const { key, unusable } = googleApiKeySetting(env);
      return measure(crawl, { ...options, apiKey: key, ...(unusable ? { apiKeyUnusable: true } : {}) });
    },
    loadProjectSources,
    attachSources,
    saveSearchImport,
    loadSearchImport,
    now: () => new Date(),
    defaultProjectDir: () => defaultProjectDir(env),
    env: toolSettings(env),
  };
}
