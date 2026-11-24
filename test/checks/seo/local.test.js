import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';

import { SITE, makePage } from '../../helpers/factories.js';
import { parseJsonLd } from '../../../plugin/server/src/extract/jsonld.js';
import { isLocalBusinessType } from '../../../plugin/server/src/util/local-business.js';
import { audit } from './helpers.js';

/** @import { PageRecord } from '../../../plugin/server/src/types.js' */

/** A page whose JSON-LD is `data`, read by the real parser. @param {string} path @param {unknown} data */
const page = (path, data) => makePage({ url: `${SITE}${path}`, jsonld: [parseJsonLd(JSON.stringify(data), 1)] });

const FULL = {
  '@context': 'https://schema.org', '@type': 'Dentist', name: 'Smile', url: `${SITE}/`,
  address: { '@type': 'PostalAddress', streetAddress: '1 Main St', addressLocality: 'Istanbul', postalCode: '34000', addressCountry: 'TR' },
  telephone: '+90 212 555 01 23', geo: { '@type': 'GeoCoordinates', latitude: 41.01234, longitude: 28.97654 },
  openingHoursSpecification: [{ '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '09:00:00', closes: '17:00:00' }],
  priceRange: '$$',
};

test('the LocalBusiness types are schema.org\'s subtree, read as written in @type', async () => {
  for (const type of ['LocalBusiness', 'Dentist', 'Restaurant', 'Store', 'schema:Bakery', 'https://schema.org/Hotel']) assert.ok(isLocalBusinessType(type), type);
  for (const type of ['Organization', 'OnlineStore', 'OnlineBusiness', 'Person', 'Corporation']) assert.ok(!isLocalBusinessType(type), type);
  const data = JSON.parse(await readFile(new URL('../../../plugin/server/data/local-business-types.json', import.meta.url), 'utf8'));
  assert.equal(data.types.split(' ').length, 152);
  assert.match(data.source, /^schema\.org 30\.1/);
});

test('a Dentist is read as a profile entity with its local fields; decimal places are counted as written', () => {
  const [entity] = parseJsonLd('{"@type":"Dentist","name":"D","geo":{"latitude":41.10000,"longitude":"29.01"},"address":"1 Main St, Istanbul","openingHours":"Mo-Fr 09:00-17:00","priceRange":"$$"}', 1).profiles ?? [];
  assert.equal(entity.type, 'Dentist');
  assert.deepEqual(entity.local, {
    address: 'text', address_parts: [], address_text: '1 Main St, Istanbul', telephone: null,
    geo: { latitude: { value: 41.1, places: 5 }, longitude: { value: 29.01, places: 2 } }, hours_specification: false, hours_text: true, price_range_length: 2,
  });
});

test('a complete LocalBusiness passes every check', () => {
  for (const id of ['seo.local.required_missing', 'seo.local.recommended_missing', 'seo.local.geo_imprecise', 'seo.local.telephone_no_country_code', 'seo.local.price_range_long']) {
    const { stat } = audit(id, { pages: [page('/', FULL)] });
    assert.deepEqual([stat.applicable, stat.failed], [1, 0], id);
  }
  assert.equal(audit('seo.local.required_missing', { pages: [page('/', { '@type': 'Organization', name: 'Acme' })] }).stat.applicable, 0, 'an Organization is not a LocalBusiness');
});

test('seo.local.required_missing: no name or no address', () => {
  const { stat, findings } = audit('seo.local.required_missing', { pages: [page('/', { '@type': 'Restaurant', telephone: '+1 212 555 0100' }), page('/b', { ...FULL, address: { '@type': 'PostalAddress' } })] });
  assert.deepEqual([stat.applicable, stat.failed], [2, 2]);
  assert.deepEqual(findings.map((finding) => finding.evidence.observed), [{ type: 'Restaurant', missing: ['name', 'address'] }, { type: 'Dentist', missing: ['address'] }]);
});

test('seo.local.recommended_missing: information naming what is missing', () => {
  const { stat, findings } = audit('seo.local.recommended_missing', { pages: [page('/', { '@type': 'Bakery', name: 'B', address: '1 Main St', openingHours: 'Mo-Sa 07:00-19:00' })] });
  assert.deepEqual([stat.applicable, stat.failed], [1, 1]);
  assert.equal(findings[0].severity, 'info');
  assert.deepEqual(findings[0].evidence.observed, { type: 'Bakery', missing: ['telephone', 'url', 'geo', 'openingHoursSpecification'], opening_hours_text: true });
});

test('seo.local.geo_imprecise, telephone_no_country_code and price_range_long', () => {
  const rough = { ...FULL, geo: { latitude: 41.01, longitude: '28.97654' }, telephone: '(212) 555 0100', priceRange: 'x'.repeat(100) };
  assert.deepEqual(audit('seo.local.geo_imprecise', { pages: [page('/', rough)] }).findings[0].evidence.observed, { latitude: 41.01, longitude: 28.97654, decimal_places: 2 });
  assert.equal(audit('seo.local.geo_imprecise', { pages: [page('/', { ...FULL, geo: { latitude: 41.01234 } })] }).stat.applicable, 0, 'one coordinate is not a unit');
  assert.equal(audit('seo.local.telephone_no_country_code', { pages: [page('/', rough)] }).stat.failed, 1);
  assert.equal(audit('seo.local.telephone_no_country_code', { pages: [page('/', { ...FULL, telephone: '0090 212 555 0100' })] }).stat.failed, 0);
  assert.equal(audit('seo.local.price_range_long', { pages: [page('/', rough)] }).stat.failed, 1);
  assert.equal(audit('seo.local.price_range_long', { pages: [page('/', { ...FULL, priceRange: 'x'.repeat(99) })] }).stat.failed, 0);
});

test('seo.local.inconsistent: one location with two addresses; two locations are not compared', () => {
  const branch = (/** @type {string} */ path, /** @type {Record<string, unknown>} */ fields) => page(path, { ...FULL, ...fields });
  const { stat, findings } = audit('seo.local.inconsistent', { pages: [
    branch('/', {}),
    branch('/contact', { address: { streetAddress: '1 Main St.', addressLocality: 'ISTANBUL', postalCode: '34000', addressCountry: 'TR' }, telephone: '+90 (212) 555-01-23' }),
    branch('/about', { address: { streetAddress: '9 Other Rd', addressLocality: 'Istanbul' } }),
    branch('/kadikoy', { url: `${SITE}/kadikoy`, address: '5 Sea St' }),
  ] });
  assert.deepEqual([stat.applicable, stat.failed], [1, 1], 'punctuation, case and phone formatting are not differences; /kadikoy is another location on one page');
  assert.deepEqual(findings[0].evidence.observed, {
    pages: 3,
    addresses: [{ value: '1 Main St, Istanbul, 34000, TR', page: `${SITE}/` }, { value: '9 Other Rd, Istanbul', page: `${SITE}/about` }],
  });
});

test('the local checks are skipped for a crawl made before rule set 0.2.3', () => {
  const old = makePage({ jsonld: [{ valid: true, types: ['Restaurant'], error: null, line: 1, profiles: [{ type: 'Restaurant', same_as: 0, id: null, name: 'R', url: null, logo: null }] }] });
  assert.equal(audit('seo.local.required_missing', { pages: [old] }).stat.status, 'skipped');
});
