// A cancelled audit_run stops its outbound requests and saves nothing; a Core
// Web Vitals measurement shared by several audits stops only when all of them
// were cancelled, and a stopped measurement is not kept.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkExternalLinks } from '../../server/src/net/link-check.js';
import { createHostGates } from '../../server/src/net/polite.js';
import { createRobotsCache } from '../../server/src/net/robots-cache.js';
import { createTools } from '../../server/src/tools/index.js';
import { collectVitals } from '../../server/src/tools/audit-vitals.js';
import { fetchResult } from '../net/fake-fetch.js';
import { makeLink, makePage, makeVitals } from '../helpers/factories.js';
import { jobFor, makeDeps, sampleCrawl, toolNamed } from './fakes.js';

describe('a cancelled audit_run', () => {
  it('sends no request after the cancel and saves no run', async () => {
    const links = Array.from({ length: 6 }, (_, i) => makeLink({ url: `https://far.test/${i}`, internal: false }));
    const crawl = sampleCrawl({ pages: [makePage({ links })] });
    const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
    const controller = new AbortController();
    /** @type {string[]} */
    const requested = [];
    fake.deps.checkExternalLinks = (urls, options) => checkExternalLinks(urls, {
      ...options,
      sleep: async () => {},
      hosts: createHostGates(),
      robotsCache: createRobotsCache(),
      fetch: async (url) => {
        requested.push(url);
        if (requested.length === 3) controller.abort(new Error('The client cancelled the request.'));
        return fetchResult(url, { status: url.endsWith('/robots.txt') ? 404 : 200 });
      },
    });
    const audit = toolNamed(createTools(fake.deps), 'audit_run');
    await assert.rejects(audit.handler({ job_id: 'c-1', modules: ['links'] }, { signal: controller.signal }), /cancelled/);
    assert.equal(requested.length, 3, requested.join(', '));
    assert.equal(fake.calls.saveRun, undefined);
  });

  it('still saves when nothing cancels it', async () => {
    const crawl = sampleCrawl();
    const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
    const audit = toolNamed(createTools(fake.deps), 'audit_run');
    await audit.handler({ job_id: 'c-1', modules: ['seo'], check_core_web_vitals: false }, { signal: new AbortController().signal });
    assert.equal(fake.calls.saveRun?.length, 1);
  });
});

describe('a Core Web Vitals measurement shared by two audits', () => {
  /** @param {(signal: AbortSignal) => void} [onEnd] */
  const setup = (onEnd) => {
    const crawl = sampleCrawl();
    const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
    /** @type {(value?: unknown) => void} */
    let finish = () => {};
    /** @type {AbortSignal[]} */
    const signals = [];
    /** @type {unknown[]} */
    const stored = [];
    fake.deps.measureVitals = async (_crawl, options) => {
      const signal = /** @type {AbortSignal} */ (options.signal);
      signals.push(signal);
      await new Promise((resolve) => { finish = resolve; });
      onEnd?.(signal);
      return makeVitals();
    };
    fake.deps.crawlManager.storedVitals = async () => null;
    fake.deps.crawlManager.storeVitals = async (...args) => {
      stored.push(args);
    };
    return { crawl, fake, signals, stored, finish: () => finish() };
  };

  it('goes on when one of them is cancelled, and is kept', async () => {
    const { crawl, fake, signals, stored, finish } = setup();
    const pending = new Map();
    const first = new AbortController();
    const second = new AbortController();
    const a = collectVitals(fake.deps, crawl, 3, pending, first.signal);
    const b = collectVitals(fake.deps, crawl, 3, pending, second.signal);
    await new Promise((resolve) => setImmediate(resolve));
    first.abort(new Error('cancelled'));
    assert.equal(signals.length, 1, 'one measurement for both');
    assert.equal(signals[0].aborted, false);
    finish();
    await Promise.all([a, b]);
    assert.equal(stored.length, 1);
  });

  it('stops when every audit waiting for it was cancelled, and is not kept', async () => {
    const { crawl, fake, signals, stored, finish } = setup();
    const pending = new Map();
    const first = new AbortController();
    const second = new AbortController();
    const a = collectVitals(fake.deps, crawl, 3, pending, first.signal);
    const b = collectVitals(fake.deps, crawl, 3, pending, second.signal);
    await new Promise((resolve) => setImmediate(resolve));
    first.abort(new Error('cancelled'));
    second.abort(new Error('cancelled'));
    assert.equal(signals[0].aborted, true);
    finish();
    await Promise.all([a, b]);
    assert.deepEqual(stored, []);
  });
});
