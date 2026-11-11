// Core Web Vitals end to end: audit_run with the real measurement, clients,
// checks and report renderers, against a stand-in for Google's two APIs on
// 127.0.0.1. The crawl is a prepared one of a public site, because a site on
// this machine is never named to Google. The store is the in-memory fake.

import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

import { allChecks } from '../../server/src/checks/registry.js';
import { renderHtml } from '../../server/src/report/html.js';
import { renderMarkdown } from '../../server/src/report/markdown.js';
import { createTools } from '../../server/src/tools/index.js';
import { queryCrux } from '../../server/src/vitals/crux.js';
import { measureVitals } from '../../server/src/vitals/measure.js';
import { runPagespeed } from '../../server/src/vitals/psi.js';
import { makeCrawl, makePage } from '../helpers/factories.js';
import { INVALID_KEY, KEYLESS_PSI, NO_CRUX_DATA, cruxAnswer, psiAnswer, startGoogle } from '../helpers/google-api.js';
import { jobFor, makeDeps, toolNamed } from '../tools/fakes.js';

/** @import { Reply, SeenRequest } from '../helpers/google-api.js' */

const SITE = 'https://shop.example';
const KEY = 'AIzaTestKey-123_abc';
const CWV = ['seo.cwv.field_cls', 'seo.cwv.field_inp', 'seo.cwv.field_lcp', 'seo.cwv.lab_cls', 'seo.cwv.lab_lcp', 'seo.cwv.lab_tbt'];

/** @type {Awaited<ReturnType<typeof startGoogle>>} */
let google;
/** @type {{psi: (request: SeenRequest) => Reply, crux: (request: SeenRequest) => Reply}} */
const answers = { psi: () => ({}), crux: () => ({}) };

before(async () => {
  google = await startGoogle({ psi: (request) => answers.psi(request), crux: (request) => answers.crux(request) });
});
beforeEach(() => {
  google.requests.length = 0;
});
after(() => google.close());

/** A public shop: a start page, three products and a contact page. */
function crawlOfShop() {
  /** @param {string} path @param {number} depth */
  const page = (path, depth) => makePage({ url: `${SITE}${path}`, depth });
  return makeCrawl({
    id: 'c-shop',
    start_url: `${SITE}/`,
    site_origin: SITE,
    site_host: 'shop.example',
    pages: [page('/', 0), page('/products/kettle', 1), page('/products/mug', 1), page('/products/teapot', 1), page('/contact', 1)],
  });
}

/** audit_run wired to the real measurement, which talks to the stand-in. @param {string|null} apiKey */
function setup(apiKey) {
  const crawl = crawlOfShop();
  const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
  const fetchOptions = { allowLoopback: true };
  const tools = createTools({
    ...fake.deps,
    checks: allChecks(),
    measureVitals: (result, options) =>
      measureVitals(result, {
        ...options,
        apiKey,
        runPagespeed: (url, o) => runPagespeed(url, { ...o, endpoint: google.psiEndpoint, fetchOptions }),
        queryCrux: (target, o) => queryCrux(target, { ...o, endpoint: google.cruxEndpoint, fetchOptions }),
      }),
  });
  return { fake, audit: toolNamed(tools, 'audit_run') };
}

test('with a key: values are measured, rated by the checks, stored in the run and shown in both reports', async () => {
  // The product page is slow in the lab; real users see a slow site and a page that shifts.
  answers.psi = (request) => ({
    json: psiAnswer({ url: request.query.url, lcp: request.query.url.includes('/products/') ? 5210.4 : 1650, cls: 0.011, tbt: request.query.url === `${SITE}/` ? 240 : 80 }),
  });
  answers.crux = (request) => {
    if (request.body.origin) return { json: cruxAnswer({ origin: SITE, lcp: 3310, inp: 190, cls: '0.08' }) };
    if (request.body.url === `${SITE}/`) return { json: cruxAnswer({ url: `${SITE}/`, lcp: 2400, inp: 120, cls: '0.27' }) };
    return NO_CRUX_DATA;
  };
  const { fake, audit } = setup(KEY);
  const result = /** @type {any} */ (await audit.handler({ job_id: 'c-shop', modules: ['seo'] }));

  // The pages that matter, named with the reason they were chosen.
  assert.deepEqual(result.core_web_vitals.pages.map((/** @type {any} */ page) => [page.url, page.why]), [
    [`${SITE}/`, 'Start page'],
    [`${SITE}/products/kettle`, 'One of 3 pages under /products/'],
    [`${SITE}/contact`, 'Top-level page'],
  ]);
  assert.deepEqual(result.core_web_vitals.pages[1].lab, { lcp_ms: 5210, cls: 0.011, tbt_ms: 80, lighthouse_version: '12.8.2', final_url: null });
  assert.deepEqual(result.core_web_vitals.origin.field.lcp_ms, { p75: 3310, good: 0.8234 });
  assert.deepEqual(result.notes, []);

  // Every Core Web Vitals check ran, and the findings are the measured problems.
  const run = fake.runs[0];
  assert.deepEqual(run.checks.filter((stat) => stat.id.startsWith('seo.cwv.')).map((stat) => [stat.id, stat.status]), CWV.map((id) => [id, 'run']));
  const found = run.findings.filter((finding) => finding.check_id.startsWith('seo.cwv.')).map((finding) => `${finding.check_id} ${finding.url}`).sort();
  assert.deepEqual(found, [
    `seo.cwv.field_cls ${SITE}/`,
    'seo.cwv.field_lcp null',
    `seo.cwv.lab_lcp ${SITE}/products/kettle`,
    `seo.cwv.lab_tbt ${SITE}/`,
  ]);
  const siteWide = run.findings.find((finding) => finding.check_id === 'seo.cwv.field_lcp');
  assert.deepEqual(siteWide?.evidence.observed, { p75_ms: 3310, rating: 'needs improvement', good_loads: '82%' });
  assert.equal(siteWide?.doc_ref, 'https://web.dev/articles/lcp');

  // Both report formats show the values, good ones included.
  const markdown = renderMarkdown(run);
  assert.ok(markdown.includes(`| Whole site | ${SITE} | 3.310 s (needs improvement) | 190 ms (good) | 0.08 (good) | — | — | — |`));
  assert.ok(markdown.includes(`| <${SITE}/products/kettle> | One of 3 pages under /products/ | — | — | — | 5.210 s (poor) | 0.011 (good) | 80 ms (good) |`));
  assert.ok(markdown.includes('### Largest Contentful Paint is slow for real users'));
  const html = renderHtml(run);
  assert.ok(html.includes('<td class="n">5.210 s<br><span class="rt rt-poor">Poor</span></td>'));
  assert.ok(html.includes('<td class="n">0.27<br><span class="rt rt-poor">Poor</span></td>'));

  // What Google was sent: the page URLs and the key in a header, nothing else.
  const psi = google.requests.filter((request) => request.api === 'psi');
  const crux = google.requests.filter((request) => request.api === 'crux');
  assert.equal(psi.length, 3);
  assert.equal(crux.length, 4);
  assert.ok(google.requests.every((request) => request.headers['x-goog-api-key'] === KEY));
  assert.ok(google.raw.every((request) => !request.url.includes(KEY)));
  assert.ok(!JSON.stringify(run).includes(KEY) && !JSON.stringify(result).includes(KEY), 'the key is in neither the stored run nor the tool result');

  // The same audit of the same data gives the same findings and score.
  const again = setup(KEY);
  await again.audit.handler({ job_id: 'c-shop', modules: ['seo'] });
  assert.deepEqual(again.fake.runs[0].findings, run.findings);
  assert.deepEqual(again.fake.runs[0].modules, run.modules);
});

test('without a key, as Google answers today: the audit completes, the checks are skipped with reasons, and coverage shows it', async () => {
  answers.psi = () => KEYLESS_PSI;
  answers.crux = () => INVALID_KEY;
  const { fake, audit } = setup(null);
  const result = /** @type {any} */ (await audit.handler({ job_id: 'c-shop', modules: ['seo'] }));

  assert.equal(google.requests.length, 1, 'one refused request, then no more');
  assert.equal(google.requests[0].api, 'psi');
  const quota = "PageSpeed Insights refused the request: Google's quota for requests without an API key is used up. Add a Google API key in the plugin settings.";
  const noKey = 'No Google API key is set, and the Chrome UX Report API requires one. Add a key in the plugin settings to collect field data.';
  assert.deepEqual(result.notes, [quota, noKey]);
  assert.deepEqual(
    result.skipped_checks.filter((/** @type {any} */ check) => check.id.startsWith('seo.cwv.')),
    CWV.map((id) => ({ id, status: 'skipped', reason: id.includes('field') ? noKey : quota })),
  );
  const run = fake.runs[0];
  assert.equal(typeof run.modules.seo.score, 'number', 'the rest of the module is scored');
  assert.ok(run.modules.seo.coverage < 1);
  assert.equal(run.findings.filter((finding) => finding.check_id.startsWith('seo.cwv.')).length, 0);

  const markdown = renderMarkdown(run);
  assert.ok(markdown.includes(`- **Lab data:** ${quota}`));
  assert.ok(markdown.includes(`- **Field data:** ${noKey}`));
  assert.ok(markdown.includes('| `seo.cwv.lab_lcp` | Skipped |'));
  assert.ok(renderHtml(run).includes('<section id="core-web-vitals">'));
});

test('a slow Google does not fail the audit: the page is noted and the others are reported', async () => {
  answers.psi = (request) => (request.query.url === `${SITE}/contact` ? { status: 500, json: { error: { code: 500, status: 'INTERNAL', message: 'x' } } } : { json: psiAnswer({ url: request.query.url }) });
  answers.crux = () => NO_CRUX_DATA;
  const { fake, audit } = setup(KEY);
  const result = /** @type {any} */ (await audit.handler({ job_id: 'c-shop', modules: ['seo'] }));
  assert.equal(fake.runs.length, 1);
  assert.equal(result.core_web_vitals.lab.available, true);
  assert.equal(result.core_web_vitals.pages[2].lab, null);
  assert.equal(result.core_web_vitals.pages[2].lab_note, 'PageSpeed Insights answered with an error of its own (HTTP 500, INTERNAL).');
  assert.match(result.notes[0], /^PageSpeed Insights tested 2 of 3 pages\. Without a lab result: https:\/\/shop\.example\/contact /);
  assert.match(result.notes[1], /^The Chrome UX Report has no phone data for this site or for the tested pages\./);
  const lab = fake.runs[0].checks.find((stat) => stat.id === 'seo.cwv.lab_lcp');
  assert.deepEqual([lab?.status, lab?.applicable], ['run', 2]);
  const field = fake.runs[0].checks.find((stat) => stat.id === 'seo.cwv.field_lcp');
  assert.deepEqual([field?.status, field?.applicable], ['run', 0], 'the report answered: it has no data, which is not a skip');
});
