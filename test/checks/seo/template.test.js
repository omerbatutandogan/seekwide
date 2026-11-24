import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makePage } from '../../helpers/factories.js';
import { jaccard, shingles, urlPattern } from '../../../plugin/server/src/checks/seo/template.js';
import { audit } from './helpers.js';

const ID = 'seo.content.template_near_duplicate';
const MENU = 'Home Services About Contact Call us today for a free quote from our friendly team.';
const BODY = 'We offer fast and reliable plumbing repairs, drain cleaning, leak detection, water heater installation and emergency callouts. Our licensed plumbers arrive on time, explain every job before starting and guarantee the work for two full years. Book online or call our office to arrange a visit at a time that suits you and your family.';

/** @param {string} path @param {string} text @param {number} [words] */
const page = (path, text, words = 80) => makePage({ url: `${SITE}${path}`, text_excerpt: text, text_hash: `h-${text}`, word_count: words });
const CITIES = ['istanbul', 'ankara', 'izmir', 'bursa', 'antalya', 'konya'];
const cityPage = (/** @type {string} */ city) => page(`/plumber/${city}`, `${MENU} Plumber in ${city}. ${BODY} Serving ${city} and nearby areas.`);
/** Pages outside the pattern that share only the menu. */
const others = ['/about/team', '/blog/pipes', '/blog/winter', '/blog/heaters'].map((path, i) => page(path, `${MENU} ${'Unique article text number '.repeat(3)}${i} ${path} about something entirely different ${'word'.repeat(i + 1)} with its own sentences and ideas that nothing else on the site repeats at all here.`));

test('the URL pattern replaces the last segment; one segment has none', () => {
  assert.equal(urlPattern('https://acme.test/plumber/istanbul'), 'acme.test/plumber/*');
  assert.equal(urlPattern('https://acme.test/plumber/istanbul/'), 'acme.test/plumber/*');
  assert.equal(urlPattern('https://acme.test/istanbul'), null);
  assert.ok(Math.abs(jaccard(shingles('a b c d'), shingles('a b c e')) - 1 / 3) < 1e-9);
});

test('six city pages with one template are reported once, with the pattern', () => {
  const { stat, findings } = audit(ID, { pages: [...CITIES.map(cityPage), ...others] });
  assert.deepEqual([stat.applicable, stat.failed], [1, 1]);
  const [finding] = findings;
  assert.equal(finding.severity, 'info');
  assert.equal(finding.url, `${SITE}/plumber/ankara`);
  assert.equal(finding.related_urls?.length, 5);
  assert.deepEqual({ ...finding.evidence.observed, lowest_similarity: undefined }, { url_pattern: '/plumber/*', pages_in_pattern: 6, similar_pages: 6, lowest_similarity: undefined });
  assert.ok(finding.evidence.observed.lowest_similarity >= 0.8);
  assert.doesNotMatch(JSON.stringify([finding.title, finding.evidence, finding.recommendation]), /spam|abuse/i);
});

test('fewer than five, identical copies, different texts and short pages pass or are not units', () => {
  assert.equal(audit(ID, { pages: CITIES.slice(0, 4).map(cityPage) }).stat.applicable, 0, 'four pages are no pattern');
  const same = CITIES.map((city) => ({ ...cityPage('x'), url: `${SITE}/plumber/${city}` }));
  assert.deepEqual([audit(ID, { pages: same }).stat.applicable, audit(ID, { pages: same }).stat.failed], [1, 0], 'identical copies are duplicate_body\'s');
  const distinct = CITIES.map((city, i) => page(`/blog/${city}`, `${MENU} ${others[i % others.length].text_excerpt.slice(MENU.length)} ${city} ${BODY.split(' ').reverse().slice(i * 8).join(' ')}`));
  assert.equal(audit(ID, { pages: [...distinct, ...others] }).stat.failed, 0);
  assert.equal(audit(ID, { pages: CITIES.map((city) => ({ ...cityPage(city), word_count: 49 })) }).stat.applicable, 0);
});

test('a menu the whole site shares does not make different pages similar', () => {
  const menu = `${MENU} ${BODY}`;
  const pages = CITIES.map((city, i) => page(`/guides/${city}`, `${menu} ${`${city} guide part ${i} `.repeat(2)}${others[i % 4].text_excerpt.slice(MENU.length)}`));
  const site = others.map((other) => ({ ...other, text_excerpt: `${menu} ${other.text_excerpt}` }));
  assert.equal(audit(ID, { pages: [...pages, ...site] }).stat.failed, 0);
});
