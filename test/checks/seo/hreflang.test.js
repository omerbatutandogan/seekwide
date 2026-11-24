import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makePage, makeRedirect } from '../../helpers/factories.js';
import { hreflangProblem } from '../../../plugin/server/src/util/iso-codes.js';
import { audit } from './helpers.js';

/** @import { HreflangRef, PageRecord } from '../../../plugin/server/src/types.js' */

/**
 * @param {string} hreflang @param {string} href @param {Partial<HreflangRef>} [overrides]
 * @returns {HreflangRef}
 */
function ref(hreflang, href, overrides = {}) {
  let url = null;
  try {
    const resolved = new URL(href, SITE);
    url = resolved.protocol === 'https:' || resolved.protocol === 'http:' ? resolved.href : null;
  } catch {
    url = null;
  }
  return { hreflang, href, url, source: 'html', in_head: true, ...overrides };
}

/** @param {string} path @param {HreflangRef[]} hreflang @param {Partial<PageRecord>} [overrides] */
const page = (path, hreflang, overrides = {}) => makePage({ url: `${SITE}${path}`, hreflang, ...overrides });

/** A complete pair: English at /en, Turkish at /tr, each listing both and x-default. */
const PAIR = [
  page('/en', [ref('en', `${SITE}/en`), ref('tr', `${SITE}/tr`), ref('x-default', `${SITE}/en`)]),
  page('/tr', [ref('en', `${SITE}/en`), ref('tr', `${SITE}/tr`), ref('x-default', `${SITE}/en`)]),
];

test('hreflangProblem reads values as Google documents them', () => {
  const cases = {
    en: null, 'en-GB': null, 'EN-gb': null, 'zh-Hant': null, 'zh-Hans-US': null, 'x-default': null, 'X-Default': null, 'tr-TR': null,
    GB: 'region_only', 'en-UK': 'reserved_region', 'en-EU': 'reserved_region', 'es-419': 'unknown_region', 'en-XX': 'unknown_region',
    xx: 'unknown_language', 'zh-Abcd': 'unknown_script', en_GB: 'format', 'en-GB-x': 'format', english: 'format', '': 'format',
  };
  for (const [value, problem] of Object.entries(cases)) assert.equal(hreflangProblem(value), problem, value);
});

test('every check passes a complete pair of versions', () => {
  for (const id of ['seo.hreflang.invalid_code', 'seo.hreflang.not_absolute', 'seo.hreflang.outside_head', 'seo.hreflang.self_missing', 'seo.hreflang.no_return', 'seo.hreflang.target_not_ok', 'seo.hreflang.x_default_missing']) {
    const { stat } = audit(id, { pages: PAIR });
    assert.ok(stat.applicable > 0, id);
    assert.equal(stat.failed, 0, id);
  }
  for (const id of ['seo.hreflang.invalid_code', 'seo.hreflang.x_default_missing']) assert.equal(audit(id, { pages: [makePage()] }).stat.applicable, 0, `${id}: no hreflang, no unit`);
});

test('seo.hreflang.invalid_code: one unit per distinct value of a page', () => {
  const { stat, findings } = audit('seo.hreflang.invalid_code', { pages: [page('/', [ref('en', '/'), ref('GB', '/gb'), ref('en-UK', '/uk'), ref('en', '/again')])] });
  assert.deepEqual([stat.applicable, stat.failed], [3, 2]);
  assert.deepEqual(findings.map((finding) => [finding.selector, finding.evidence.observed?.problem]), [['GB', 'region_only'], ['en-UK', 'reserved_region']]);
});

test('seo.hreflang.not_absolute: a relative or scheme-relative address', () => {
  const { stat, findings } = audit('seo.hreflang.not_absolute', { pages: [page('/', [ref('en', `${SITE}/`), ref('de', '/de'), ref('fr', '//example.test/fr')])] });
  assert.deepEqual([stat.applicable, stat.failed], [3, 2]);
  assert.deepEqual(findings.map((finding) => finding.selector), ['//example.test/fr', '/de']);
});

test('seo.hreflang.outside_head: a link in the body; a header and an old record are not units', () => {
  const { stat, failed } = audit('seo.hreflang.outside_head', { pages: [
    page('/body', [ref('en', `${SITE}/body`), ref('de', `${SITE}/de`, { in_head: false })]),
    page('/header', [ref('en', `${SITE}/header`, { source: 'header', in_head: undefined })]),
    page('/old', [ref('en', `${SITE}/old`, { in_head: undefined })]),
    page('/head', [ref('en', `${SITE}/head`)]),
  ] });
  assert.deepEqual([stat.applicable, stat.failed], [2, 1]);
  assert.deepEqual(failed, [`${SITE}/body`]);
});

test('seo.hreflang.self_missing: a page that lists the others and not itself', () => {
  const { stat, failed } = audit('seo.hreflang.self_missing', { pages: [
    page('/en', [ref('tr', `${SITE}/tr`)]),
    page('/tr', [ref('tr', `${SITE}/tr`), ref('en', `${SITE}/en`)]),
    page('/only-default', [ref('x-default', `${SITE}/`)]),
  ] });
  assert.deepEqual([stat.applicable, stat.failed], [2, 1], 'a page with only x-default is not a unit');
  assert.deepEqual(failed, [`${SITE}/en`]);
});

test('seo.hreflang.no_return: the alternate does not point back; one not crawled or reached through a redirect is not judged', () => {
  const { stat, findings } = audit('seo.hreflang.no_return', { pages: [
    page('/en', [ref('en', `${SITE}/en`), ref('tr', `${SITE}/tr`), ref('de', `${SITE}/de`), ref('fr', `${SITE}/fr-old`), ref('es', `${SITE}/es`)]),
    page('/tr', [ref('tr', `${SITE}/tr`)]),
    page('/de', [ref('de', `${SITE}/de`), ref('en', `${SITE}/en`)]),
    makeRedirect(`${SITE}/fr-old`, `${SITE}/fr`),
    page('/fr', [ref('fr', `${SITE}/fr`)]),
  ] });
  assert.deepEqual([stat.applicable, stat.failed], [3, 1], '/en to /tr and /de, /de to /en');
  assert.deepEqual(findings.map((finding) => [finding.url, finding.selector]), [[`${SITE}/en`, `${SITE}/tr`]]);
});

test('seo.hreflang.target_not_ok: a redirect, an error page and a noindex page', () => {
  const { stat, findings } = audit('seo.hreflang.target_not_ok', { pages: [
    page('/en', [ref('en', `${SITE}/en`), ref('fr', `${SITE}/fr-old`), ref('de', `${SITE}/de`), ref('it', `${SITE}/it`), ref('es', `${SITE}/es`)]),
    makeRedirect(`${SITE}/fr-old`, `${SITE}/fr`),
    page('/fr', []),
    page('/de', [], { status: 404, is_html: true, indexability: { indexable: false, reasons: ['status_404'] } }),
    page('/it', [], { indexability: { indexable: false, reasons: ['noindex_meta'] } }),
  ] });
  assert.deepEqual([stat.applicable, stat.failed], [4, 3], '/es was not crawled');
  assert.ok(findings.every((finding) => finding.severity === 'info'));
  assert.deepEqual(findings.find((finding) => finding.selector === `${SITE}/fr-old`)?.evidence.observed, { alternate: `${SITE}/fr-old`, redirects_to: `${SITE}/fr`, status: 200, indexable: true });
});

test('seo.hreflang.x_default_missing: information, once for the site', () => {
  const { stat, failed } = audit('seo.hreflang.x_default_missing', { pages: [makePage({ url: `${SITE}/` }), page('/en', [ref('en', `${SITE}/en`)])] });
  assert.deepEqual([stat.applicable, stat.failed], [1, 1]);
  assert.deepEqual(failed, [`${SITE}/`]);
});

test('the code lists hold ISO 639-1, ISO 15924 and ISO 3166-1 alpha-2 as generated', async () => {
  const { readFile } = await import('node:fs/promises');
  const data = JSON.parse(await readFile(new URL('../../../plugin/server/data/iso-codes.json', import.meta.url), 'utf8'));
  const count = (/** @type {string} */ list) => list.split(' ').length;
  assert.deepEqual([count(data.languages), count(data.scripts), count(data.regions)], [184, 173, 249]);
  assert.match(data.source, /^Debian iso-codes 4\.16\.0/);
  for (const code of ['tr', 'en', 'zh', 'he']) assert.ok(data.languages.split(' ').includes(code), code);
  for (const code of ['TR', 'GB', 'US']) assert.ok(data.regions.split(' ').includes(code), code);
  assert.ok(!data.regions.split(' ').includes('UK'), 'UK is reserved, not assigned');
});
