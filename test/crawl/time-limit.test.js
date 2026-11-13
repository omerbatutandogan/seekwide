// A crawl has a total time limit (LIMITS.crawlMaxMs). One that reaches it with
// URLs left ends as truncated, and the audit and the report say why.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { LIMITS } from '../../plugin/server/src/config.js';
import { buildContext, runChecks } from '../../plugin/server/src/checks/engine.js';
import { allChecks } from '../../plugin/server/src/checks/registry.js';
import { runNotes } from '../../plugin/server/src/tools/audit-summary.js';
import { factualSummary } from '../../plugin/server/src/report/facts.js';
import { fakeFetch } from '../net/fake-fetch.js';
import { makeCrawl } from '../helpers/factories.js';
import { NOW, crawl, html, removeTempDirs } from './harness.js';

after(removeTempDirs);

// Plain http, so the crawl makes no http-to-https probe and the requests are easy to count.
const S = 'http://site.test';
/** Every request takes this long on the clock the crawl reads. */
const STEP_MS = 6 * 60_000;

/**
 * A site of five pages in a row, and a clock that moves on with every request.
 * @param {string} robots
 */
function slowSite(robots = 'User-agent: *\nAllow: /\n') {
  const { fetch: answer, calls } = fakeFetch({
    [`${S}/robots.txt`]: { headers: { 'content-type': 'text/plain' }, text: robots },
    [`${S}/`]: { ...html(['/a']), text: html(['/a']).body },
    [`${S}/a`]: { ...html(['/b']), text: html(['/b']).body },
    [`${S}/b`]: { ...html(['/c']), text: html(['/c']).body },
    [`${S}/c`]: { ...html(['/d']), text: html(['/d']).body },
    [`${S}/d`]: { ...html([]), text: html([]).body },
  });
  let clock = NOW.getTime();
  /** @type {typeof answer} */
  const fetch = async (url, options) => {
    clock += STEP_MS;
    return answer(url, options);
  };
  return { fetch, calls, now: () => new Date(clock) };
}

/** Paths of the pages a crawl recorded. @param {any} result */
const paths = (result) => result.pages.map((/** @type {any} */ page) => new URL(page.url).pathname);

test('the limit is generous: half an hour', () => {
  assert.equal(LIMITS.crawlMaxMs, 30 * 60_000);
});

test('a crawl that reaches its time limit with URLs left stops as truncated and says it was the time limit', async () => {
  const site = slowSite();
  const { job, result } = await crawl({ url: S }, { fetch: site.fetch, now: site.now });
  // robots.txt, /, the sitemap guess, /a and /b take 30 minutes; /c is not requested.
  assert.deepEqual(paths(result), ['/', '/a', '/b']);
  assert.equal(site.calls.some((call) => call.url === `${S}/c`), false);
  assert.equal(result?.truncated, true);
  assert.equal(result?.time_limit_reached, true);
  assert.equal(job?.status, 'done');
  assert.equal(job?.truncated, true);
});

test('a crawl that finishes in time, or whose time runs out with nothing left it may fetch, is not cut short', async () => {
  const fast = await crawl({ url: S }, { fetch: slowSite().fetch });
  assert.deepEqual(paths(fast.result), ['/', '/a', '/b', '/c', '/d']);
  assert.equal(fast.result?.truncated, false);
  assert.equal(fast.result?.time_limit_reached, undefined);

  // The time runs out when the only URL left is one robots.txt does not allow.
  const site = slowSite('User-agent: *\nDisallow: /c\n');
  const { result } = await crawl({ url: S }, { fetch: site.fetch, now: site.now });
  assert.deepEqual(paths(result), ['/', '/a', '/b']);
  assert.equal(site.calls.some((call) => call.url === `${S}/c`), false);
  assert.equal(result?.truncated, false);
  assert.equal(result?.time_limit_reached, undefined);
});

test('the checks that need a complete crawl say why they were skipped, the time limit included', () => {
  const result = runChecks(allChecks(), buildContext(makeCrawl({ truncated: true, time_limit_reached: true })), { detectedAt: NOW.toISOString() });
  const skipped = result.checks.filter((check) => check.skip_reason?.startsWith('Needs a complete crawl.'));
  assert.ok(skipped.length > 0);
  for (const check of skipped) assert.match(/** @type {string} */ (check.skip_reason), /stopped at a limit \(of pages, of size or of time\) or was blocked/, check.id);
});

test('the audit and the report name the time limit, not the page budget', () => {
  const timed = makeCrawl({ truncated: true, time_limit_reached: true });
  const notes = runNotes(timed, { requested: false, checked: false, found: 0 }, { requested: false, checked: false, vitals: null }, []);
  assert.deepEqual(notes, ['The crawl stopped at its time limit of 30 minutes with URLs left to visit, so checks that need a complete crawl were skipped. Crawl again with a smaller max_pages, or crawl the sections that matter one at a time.']);
  const budget = runNotes(makeCrawl({ truncated: true }), { requested: false, checked: false, found: 0 }, { requested: false, checked: false, vitals: null }, []);
  assert.match(budget[0], /^The crawl stopped at its page budget/);

  const facts = { host: 'site.test', pages: 3, htmlPages: 3, indexablePages: 3, maxPages: 25, checksRun: 1, checksTotal: 1, findings: 0, checksWithFindings: 0, severityCounts: {}, scores: [], truncated: true, blocked: null, unreadablePages: 0 };
  assert.ok(factualSummary({ ...facts, timeLimited: true }).includes('The crawl stopped at its time limit, so these results describe the pages crawled, not the whole site.'));
  assert.ok(factualSummary(facts).includes('The crawl stopped at its limit of 25 pages, so these results describe the pages crawled, not the whole site.'));
});
