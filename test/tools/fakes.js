// In-memory fakes for the dependencies of createTools, for unit tests.

/** @import { CheckDef, CrawlJob, CrawlResult, ImageFileResult, Run, VitalsData } from '../../plugin/server/src/types.js' */

import path from 'node:path';
import { attachSources, loadProjectSources } from '../../plugin/server/src/repo/sources.js';
import { loadSearchImport, saveSearchImport } from '../../plugin/server/src/store/imports.js';
import { assertRunId, projectPaths } from '../../plugin/server/src/store/project.js';
import { InputError } from '../../plugin/server/src/util/errors.js';
import { makeCrawl, makeLink, makePage, makeVitals } from '../helpers/factories.js';

// Built with path.resolve, so that it is the absolute path the tools return on Windows too (D:\projects\site).
export const PROJECT = path.resolve('/projects/site');
/** A project folder that does not exist, as the tools normalize it on this platform. */
const MISSING = path.normalize('/missing');
export const NOW = new Date('2026-11-11T14:03:22.000Z');

/**
 * @param {Partial<CheckDef> & {id: string, run: CheckDef['run']}} overrides
 * @returns {CheckDef}
 */
export function makeCheck(overrides) {
  return {
    module: /** @type {'seo'|'links'} */ (overrides.id.split('.')[0]),
    engine: 'code',
    title: `Title of ${overrides.id}`,
    description: 'Test check.',
    severity: 'high',
    weight: 3,
    impact: 2,
    effort: 2,
    confidence: 'confirmed',
    scope: 'page',
    requires: [],
    doc_ref: 'https://developers.google.com/search',
    last_verified: '2026-01-01',
    recommendation: `Fix ${overrides.id}.`,
    ...overrides,
  };
}

/** Checks: a missing-title check (seo) and a broken-outbound check (links, needs outbound). */
export const CHECKS = [
  makeCheck({
    id: 'seo.title.missing',
    run: (ctx) => ctx.indexablePages.map((page) => ({ status: page.titles.some((t) => t.trim() !== '') ? 'pass' : 'fail', url: page.url })),
  }),
  makeCheck({
    id: 'links.outbound.broken',
    severity: 'medium',
    requires: ['outbound'],
    run: (ctx) =>
      [...(ctx.outbound?.values() ?? [])].map((result) => ({ status: result.outcome === 'broken' ? 'fail' : 'pass', url: result.url, selector: result.url })),
  }),
];

/** A finished crawl: two HTML pages (one without a title) linking to two external URLs. */
export function sampleCrawl(overrides = {}) {
  return makeCrawl({
    id: 'c-1',
    pages: [
      makePage({
        url: 'https://example.test/',
        links: [
          makeLink({ url: 'https://example.test/about' }),
          makeLink({ url: 'https://other.test/b' }),
          makeLink({ url: 'https://other.test/a' }),
          makeLink({ url: 'https://other.test/a' }),
        ],
      }),
      makePage({ url: 'https://example.test/about', depth: 1, titles: [] }),
    ],
    ...overrides,
  });
}

/**
 * @param {CrawlResult} crawl
 * @param {Partial<CrawlJob>} [overrides]
 * @returns {CrawlJob}
 */
export function jobFor(crawl, overrides = {}) {
  return {
    id: crawl.id,
    status: 'done',
    start_url: crawl.start_url,
    max_pages: crawl.options.max_pages,
    pages_crawled: crawl.pages.length,
    pages_queued: 0,
    truncated: crawl.truncated,
    blocked: crawl.blocked,
    error: null,
    started_at: crawl.started_at,
    finished_at: crawl.finished_at,
    ...overrides,
  };
}

/** @param {string} message @param {string} code */
function codedError(message, code) {
  return Object.assign(new Error(message), { code });
}

/**
 * Fake dependencies with call logs. `jobs` and `results` seed the crawl manager.
 * @param {{jobs?: CrawlJob[], results?: CrawlResult[], runs?: Run[], profile?: object|null, env?: NodeJS.ProcessEnv,
 *          projectDir?: string, outbound?: (url: string) => 'ok'|'broken'|'unverifiable',
 *          vitals?: VitalsData|Error, imageFile?: (url: string) => ImageFileResult}} [seed]  `vitals`: what the measurement returns,
 *   or the error it throws. `imageFile`: what the check of an image file finds; by default a small WebP that Google may fetch.
 */
export function makeDeps(seed = {}) {
  const calls = /** @type {Record<string, unknown[][]>} */ ({});
  /** @param {string} name @param {unknown[]} args */
  const record = (name, args) => (calls[name] ??= []).push(args);

  const jobs = new Map((seed.jobs ?? []).map((job) => [job.id, job]));
  const results = new Map((seed.results ?? []).map((crawl) => [crawl.id, crawl]));
  /** @type {Run[]} */
  const runs = [...(seed.runs ?? [])];
  let profile = seed.profile ?? null;
  /** Core Web Vitals kept with a crawl, by crawl id and page count. @type {Map<string, {vitals: VitalsData, measured_at: string}>} */
  const storedVitals = new Map();

  const deps = {
    crawlManager: {
      /** @param {{url: string, maxPages?: number, includeSubdomains?: boolean, allowLoopback?: boolean, deployedUrl?: string}} options */
      start(options) {
        record('start', [options]);
        if (options.url.includes('async-reject')) return Promise.reject(new InputError('allowLoopback needs a loopback start host.'));
        if (options.url.includes('bug')) throw new TypeError('Cannot read properties of undefined (reading \'host\')');
        if (options.url.includes('reject')) throw new InputError('maxPages is out of range.');
        const job = { ...jobFor(makeCrawl({ id: 'c-new', start_url: options.url })), status: /** @type {const} */ ('running'), max_pages: options.maxPages ?? 25 };
        jobs.set(job.id, job);
        return job;
      },
      /** @param {string} id */
      get: (id) => (jobs.has(id) ? { ...jobs.get(id) } : null),
      /** @param {string} id @param {number} timeoutMs */
      async wait(id, timeoutMs) {
        record('wait', [id, timeoutMs]);
        return jobs.has(id) ? { ...jobs.get(id) } : null;
      },
      /** @param {string} id */
      result: async (id) => results.get(id) ?? null,
      /** @param {string} id @param {number} pages */
      async storedVitals(id, pages) {
        record('storedVitals', [id, pages]);
        return storedVitals.get(`${id} ${pages}`) ?? null;
      },
      /** @param {string} id @param {number} pages @param {VitalsData} vitals @param {string} measuredAt */
      async storeVitals(id, pages, vitals, measuredAt) {
        record('storeVitals', [id, pages, vitals, measuredAt]);
        storedVitals.set(`${id} ${pages}`, structuredClone({ vitals, measured_at: measuredAt }));
      },
    },
    checks: CHECKS,
    loadProjectSources,
    attachSources,
    saveSearchImport,
    loadSearchImport,
    projectPaths,
    /** @param {string} dir */
    async ensureProject(dir) {
      record('ensureProject', [dir]);
      if (dir.startsWith(MISSING)) throw codedError(`The project folder ${dir} does not exist. Check the path or create the folder first.`, 'PROJECT_DIR_NOT_FOUND');
      return projectPaths(dir);
    },
    /** @param {Date} date @param {string[]} existing */
    newRunId(date, existing) {
      record('newRunId', [date, existing]);
      const base = date.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
      let id = base;
      for (let n = 2; existing.includes(id); n += 1) id = `${base}-${n}`;
      return id;
    },
    /** @param {string} dir @param {Run} run */
    async saveRun(dir, run) {
      record('saveRun', [dir, run]);
      if (runs.some((r) => r.run_id === run.run_id)) throw codedError(`Run ${run.run_id} is already stored.`, 'RUN_EXISTS');
      runs.push(structuredClone(run));
      const paths = projectPaths(dir);
      return { runId: run.run_id, runDir: paths.runDir(run.run_id), findingsFile: paths.findingsFile(run.run_id), entry: {} };
    },
    /** @param {string} dir @param {string} ref */
    async loadRun(dir, ref) {
      record('loadRun', [dir, ref]);
      if (ref !== 'last' && ref !== 'previous') assertRunId(ref);
      const run = ref === 'last' ? runs.at(-1) : ref === 'previous' ? runs.at(-2) : runs.find((r) => r.run_id === ref);
      if (!run) {
        throw codedError(ref === 'previous' ? 'There is only one run, so there is no previous run.' : `Run ${ref} was not found.`, 'RUN_NOT_FOUND');
      }
      return run;
    },
    /** @param {string} dir */
    async listRuns(dir) {
      record('listRuns', [dir]);
      return runs.map((run) => ({ run_id: run.run_id, created_at: run.created_at, start_url: run.start_url, scores: {}, findings: run.findings.length }));
    },
    /** @param {string} dir */
    async readProfile(dir) {
      record('readProfile', [dir]);
      return profile;
    },
    /** @param {string} dir @param {any} input @param {Date} now */
    async writeProfile(dir, input, now) {
      record('writeProfile', [dir, input, now]);
      if (!input.site_url) throw codedError('Invalid profile: site_url is required.', 'INVALID_PROFILE');
      profile = { schema_version: 1, ...input, updated_at: now.toISOString() };
      return profile;
    },
    /** @param {Run} base @param {Run} current */
    compareRuns(base, current) {
      const baseIds = new Set(base.findings.map((f) => f.id));
      const currentIds = new Set(current.findings.map((f) => f.id));
      return {
        base_run_id: base.run_id,
        run_id: current.run_id,
        resolved: base.findings.filter((f) => !currentIds.has(f.id)),
        added: current.findings.filter((f) => !baseIds.has(f.id)),
        persisting: current.findings.filter((f) => baseIds.has(f.id)).length,
        scores: {},
        notes: [],
      };
    },
    /** @param {Run} run @param {object} options */
    renderMarkdown(run, options) {
      record('renderMarkdown', [run, options]);
      return `# Report ${run.run_id}\n`;
    },
    /** @param {Run} run @param {object} options */
    renderHtml(run, options) {
      record('renderHtml', [run, options]);
      return `<!doctype html><title>Report ${run.run_id} é</title>`;
    },
    /** @param {string[]} urls @param {object} options */
    async checkExternalLinks(urls, options) {
      record('checkExternalLinks', [urls, options]);
      const outcome = seed.outbound ?? (() => 'ok');
      return new Map(urls.map((url) => [url, { url, status: outcome(url) === 'broken' ? 404 : 200, outcome: outcome(url), reason: null, final_url: url }]));
    },
    /** @param {string[]} urls @param {object} options */
    async checkImageFiles(urls, options) {
      record('checkImageFiles', [urls, options]);
      return new Map(urls.map((url) => [url, seed.imageFile?.(url) ?? {
        url, outcome: 'ok', status: 200, reason: null, final_url: null, content_type: 'image/webp', bytes: 10_000, vary: null,
        modern_accepted: true, google: 'allowed', google_agent: null, google_host: null,
      }]));
    },
    /** @param {CrawlResult} crawl @param {{maxPages: number}} options */
    async measureVitals(crawl, options) {
      // The signal that stops a measurement is checked by tests of its own; the calls keep the other options.
      const { signal, ...rest } = options;
      if (!(signal instanceof AbortSignal)) throw new TypeError('measureVitals needs a signal');
      record('measureVitals', [crawl.id, rest]);
      if (seed.vitals instanceof Error) throw seed.vitals;
      return seed.vitals ?? makeVitals();
    },
    now: () => NOW,
    defaultProjectDir: () => seed.projectDir ?? PROJECT,
    env: seed.env ?? {},
  };
  return { deps, calls, runs, jobs };
}

/**
 * @param {import('../../plugin/server/src/mcp/stdio.js').ToolDef[]} tools
 * @param {string} name
 */
export function toolNamed(tools, name) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool;
}
