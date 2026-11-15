// The sxo module's key-free checks (rule set 0.2.1): one passing and one failing case each.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContext, runChecks } from '../../../plugin/server/src/checks/engine.js';
import { zoomBlocker } from '../../../plugin/server/src/checks/sxo/experience.js';
import { titleParts } from '../../../plugin/server/src/checks/sxo/helpers.js';
import { checks } from '../../../plugin/server/src/checks/sxo/index.js';
import { SITE, makeCrawl, makePage, makeRedirect, makeSecurity } from '../../helpers/factories.js';

/** @param {import('../../../plugin/server/src/types.js').PageRecord[]} pages @param {string} id */
function run(pages, id) {
  const result = runChecks(checks, buildContext(makeCrawl({ pages })), { modules: ['sxo'], detectedAt: '2026-11-14T00:00:00.000Z' });
  return { stat: result.checks.find((check) => check.id === id), findings: result.findings.filter((finding) => finding.check_id === id) };
}

/** @param {string} path @param {string} title @param {string} [h1] @param {object} [overrides] */
const titled = (path, title, h1 = 'A heading', overrides = {}) => makePage({ url: `${SITE}${path}`, titles: [title], headings: [{ level: 1, text: h1, line: 9 }], ...overrides });

test('a title splits at separators, with spaced hyphens, colons and slashes only', () => {
  assert.deepEqual(titleParts('| Site Name'), ['', 'Site Name']);
  assert.deepEqual(titleParts('Product - Site'), ['Product', 'Site']);
  assert.deepEqual(titleParts('E-commerce 10:30 1/2'), ['E-commerce 10:30 1/2']);
  assert.deepEqual(titleParts('A -- B || C'), ['A', 'B', 'C'], 'adjacent separators are one');
  assert.deepEqual(titleParts('A | | B'), ['A', '', 'B']);
  assert.deepEqual(titleParts('-50% sale'), ['-50% sale']);
});

test('sxo.title.half_empty fails a title that starts or ends with a separator or has an empty part', () => {
  const { stat, findings } = run([
    titled('/ok', 'Pricing | Acme'), titled('/a', '| Acme'), titled('/b', 'Pricing –'), titled('/c', 'Pricing | | Acme'),
    titled('/d', 'Docs:'), titled('/e', ''), titled('/noindex', '| X', 'H', { indexability: { indexable: false, reasons: ['noindex_meta'] } }),
  ], 'sxo.title.half_empty');
  assert.deepEqual([stat?.applicable, findings.map((finding) => finding.url)], [5, [`${SITE}/a`, `${SITE}/b`, `${SITE}/c`]], 'an empty title and a noindex page are not units');
});

test('sxo.title.year_stale fails a title year older than the heading\'s, and passes when the heading names the title\'s year', () => {
  const { stat, findings } = run([
    titled('/old', '2020 admissions criteria - University', '2021 admissions criteria'),
    titled('/season', 'Season 2020–2021', 'Season 2021–2022'),
    titled('/same', 'Report 2026', 'Report 2026'),
    titled('/none', 'No year here', '2026 plans'),
    titled('/older-h1', 'Guide 2026', 'Since 1998'),
  ], 'sxo.title.year_stale');
  assert.deepEqual([stat?.applicable, findings.length, findings[0]?.url], [4, 1, `${SITE}/old`]);
});

test('sxo.title.script_mismatch fails a title without a letter of the page\'s primary writing system', () => {
  const text = (/** @type {Record<string, number>} */ scripts) => makeSecurity({ scripts });
  const { stat, findings } = run([
    titled('/en', 'Pricing plans', 'H', { security: text({ latin: 900 }) }),
    titled('/ja-brand', 'ユニクロ公式 | UNIQLO', 'H', { security: text({ cjk: 800, latin: 40 }) }),
    titled('/ru', 'Contact us', 'H', { security: text({ cyrillic: 700, latin: 30 }) }),
    titled('/mixed', 'Hello', 'H', { security: text({ latin: 500, arabic: 500 }) }),
    titled('/short', 'Hello', 'H', { word_count: 20, security: text({ cyrillic: 100 }) }),
  ], 'sxo.title.script_mismatch');
  assert.deepEqual([stat?.applicable, findings.length, findings[0]?.url], [3, 1, `${SITE}/ru`], 'no primary system, or under 50 words: not a unit');
  assert.equal(/** @type {any} */ (findings[0].evidence.observed).page_script, 'cyrillic');
});

test('sxo.title.no_heading_overlap is info and compares the title without its repeated site name with the h1', () => {
  const { stat, findings } = run([
    titled('/pricing', 'Pricing plans | Acme Store', 'Our pricing'),
    titled('/about', 'Our story | Acme Store', 'Company history'), titled('/short', 'Who we are | Acme Store', 'Team'),
    titled('/ja', '会社概要 | Acme', '会社について'),
  ], 'sxo.title.no_heading_overlap');
  assert.deepEqual([stat?.applicable, findings.length, findings[0]?.url, findings[0]?.weight], [2, 1, `${SITE}/about`, 0]);
});

test('the viewport rule follows axe: user-scalable no or 0 and a maximum-scale below 2 block zooming', () => {
  for (const value of ['width=device-width, user-scalable=no', 'width=device-width,user-scalable=0', 'maximum-scale=1.0', 'initial-scale=1; maximum-scale=1.5', 'user-scalable=0.5']) assert.notEqual(zoomBlocker(value), null, value);
  for (const value of ['width=device-width, initial-scale=1', 'maximum-scale=2', 'maximum-scale=5, user-scalable=yes', 'maximum-scale=-1', 'user-scalable=1', 'maximum-scale=device-width', 'user-scalable']) assert.equal(zoomBlocker(value), null, value);
});

test('sxo.mobile.zoom_disabled fails a page whose viewport blocks zooming', () => {
  const { stat, findings } = run([
    makePage({ url: `${SITE}/ok` }), makePage({ url: `${SITE}/bad`, viewport: 'width=device-width, maximum-scale=1, user-scalable=no' }), makePage({ url: `${SITE}/none`, viewport: null }),
  ], 'sxo.mobile.zoom_disabled');
  assert.deepEqual([stat?.applicable, findings.length, /** @type {any} */ (findings[0].evidence.observed).blocks_zoom], [2, 1, 'maximum-scale=1']);
});

test('sxo.interstitial.redirect_gate fails a page three internal URLs redirect to with their address in its query, on or off the site', () => {
  const gate = (/** @type {string} */ path, /** @type {string} */ to) => makeRedirect(`${SITE}${path}`, to);
  const enc = encodeURIComponent;
  const { stat, findings } = run([
    makePage({ url: `${SITE}/consent` }),
    gate('/', `${SITE}/consent?returnUrl=${enc('/')}`), gate('/a', `${SITE}/consent?returnUrl=${enc('/a')}`), gate('/b', `${SITE}/consent?returnUrl=${enc(`${SITE}/b`)}`),
    gate('/x', 'https://age.example.org/check?next=' + enc(`${SITE}/x`)), gate('/y', 'https://age.example.org/check?next=' + enc(`${SITE}/y`)), gate('/z', 'https://age.example.org/check?next=' + enc(`${SITE}/z`)),
    gate('/old1', `${SITE}/`), gate('/old2', `${SITE}/`), gate('/old3', `${SITE}/`),
    gate('/account', `${SITE}/login?next=%2Faccount`), gate('/orders', `${SITE}/login?next=%2Forders`), gate('/wishlist', `${SITE}/login?next=%2Fwishlist`),
  ], 'sxo.interstitial.redirect_gate');
  assert.deepEqual([stat?.applicable, stat?.failed], [3, 2], 'old URLs moved to the home page pass; a login page is not a unit');
  assert.deepEqual(findings.map((finding) => finding.url), ['https://age.example.org/check', `${SITE}/consent`]);
  assert.deepEqual(/** @type {any} */ (findings[1].evidence.observed).parameters, ['returnUrl']);
  assert.equal(findings[1].confidence, 'likely');
  assert.equal(run([gate('/a', `${SITE}/consent?r=%2Fa`), gate('/b', `${SITE}/consent?r=%2Fb`)], 'sxo.interstitial.redirect_gate').stat?.applicable, 0, 'two redirects are not enough');
});

test('redirects to an error page, a sign-on page or a checkout are not gates; an author page or a paywall elsewhere is reported as seen', () => {
  const to = (/** @type {string} */ target) => ['/a', '/b', '/c'].map((path) => makeRedirect(`${SITE}${path}`, `${target}${encodeURIComponent(`${SITE}${path}`)}`));
  const units = (/** @type {string} */ target, /** @type {object} */ overrides = {}) => run(to(target).map((page) => ({ ...page, ...overrides })), 'sxo.interstitial.redirect_gate');
  for (const target of [`${SITE}/404?path=`, `${SITE}/page-not-found?u=`, `${SITE}/saml2/idp/SSOService.php?RelayState=`, `${SITE}/checkout?return=`, `${SITE}/cart?back=`, `https://id.example.org/oauth2/authorize?redirect_uri=`]) {
    assert.equal(units(target).stat?.applicable, 0, target);
  }
  assert.equal(units(`${SITE}/consent?r=`, { final_status: 404 }).stat?.applicable, 0, 'a target that answered with an error is left out');
  const author = units(`${SITE}/author/x?back=`).findings;
  assert.equal(author.length, 1);
  assert.equal(author[0].title, 'Several pages redirect to one page that carries their address');
  assert.equal(author[0].evidence.detail, '3 internal URLs redirect to this page, each carrying its own address in the query.');
  assert.doesNotMatch(author[0].recommendation, /consent or age question/);
  assert.equal(units('https://pay.example.org/subscribe?return=').findings.length, 1);
});

test('a founding or copyright year is not read as the year the page is about', () => {
  const { findings, stat } = run([
    titled('/since', 'Since 1999 - Acme', 'Acme: established 2005'),
    titled('/est', 'Acme, est. 2001', 'Report 2026'),
    titled('/de', 'Seit 1998 für Sie da', 'Neuheiten 2026'),
    titled('/real', 'Best laptops 2025 - Acme', 'Best laptops 2026'),
  ], 'sxo.title.year_stale');
  assert.deepEqual([stat?.applicable, findings.map((finding) => finding.url)], [1, [`${SITE}/real`]]);
});

test('the viewport rule fails a blocking value even when a later one allows zooming, as axe-core (2026-10-09) and the ACT rule do', () => {
  assert.equal(zoomBlocker('user-scalable=no, user-scalable=yes'), 'user-scalable=no');
  assert.equal(zoomBlocker('maximum-scale=1, maximum-scale=5'), 'maximum-scale=1');
});
