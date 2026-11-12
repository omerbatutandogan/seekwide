import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makeLink, makePage, makeSecurity } from '../../helpers/factories.js';
import { audit, findingsFor, statFor } from './support.js';

/** @import { HiddenLinkRecord } from '../../../server/src/types.js' */

const ID = 'security.hidden.external_link';

/**
 * @param {number} index
 * @param {string} url
 * @param {Partial<HiddenLinkRecord>} [overrides]
 * @returns {HiddenLinkRecord}
 */
const hiddenAt = (index, url, overrides = {}) => ({
  index, url, host: new URL(url).host.replace(/^www\./, ''), text: 'cheap pills', how: 'display:none', element: 'div[style="display:none"]',
  element_line: 40, line: 41, count: 1, ...overrides,
});

test(`${ID} fails a page with a hidden link to a site that no visible link goes to`, () => {
  const spam = 'https://spam.test/pills';
  const home = makePage({
    url: `${SITE}/`,
    links: [makeLink({ url: `${SITE}/about` }), makeLink({ url: spam, href: `${spam}?ref=1`, internal: false, text: 'cheap pills', line: 41 })],
    security: makeSecurity({
      hidden_links: [hiddenAt(1, spam, { how: 'off-screen', element: 'div[style="position:absolute;left:-9999px"]', count: 3 })],
    }),
  });
  const about = makePage({ url: `${SITE}/about` });
  const result = audit([home, about]);
  const stat = statFor(result, ID);
  assert.deepEqual([stat.applicable, stat.failed], [2, 1]);
  const [finding] = findingsFor(result, ID);
  assert.equal(finding.url, `${SITE}/`);
  assert.equal(finding.selector, `a[href="${spam}?ref=1"]`, 'the raw href of the link');
  assert.equal(finding.line, 41);
  assert.equal(finding.severity, 'high');
  assert.equal(finding.confidence, 'likely');
  assert.deepEqual(finding.evidence.observed, {
    hidden_links: 3, hosts: ['spam.test'], first: { url: spam, text: 'cheap pills', how: 'off-screen', element: 'div[style="position:absolute;left:-9999px"]' },
  });
  assert.match(finding.evidence.detail ?? '', /^3 links to another site .* off-screen, set on div\[style="position:absolute;left:-9999px"\] at line 40\.$/);
});

test(`${ID} passes a hidden link to a site that a visible link on any crawled page also goes to`, () => {
  const social = 'https://www.instagram.com/shop';
  const home = makePage({ url: `${SITE}/`, security: makeSecurity({ hidden_links: [hiddenAt(0, social)] }) });
  const footer = makePage({ url: `${SITE}/contact`, security: makeSecurity({ visible_hosts: ['instagram.com'] }) });
  const result = audit([home, footer]);
  assert.deepEqual(findingsFor(result, ID), []);
  assert.equal(statFor(result, ID).applicable, 2);
});

test(`${ID} describes a link on one character and lists every hidden site`, () => {
  const page = makePage({
    url: `${SITE}/`,
    security: makeSecurity({
      hidden_links: [
        hiddenAt(0, 'https://farm.test/x', { text: '-', how: 'one-character link', element: null, element_line: null }),
        hiddenAt(3, 'https://b.test/', { count: 2 }),
      ],
    }),
  });
  const [finding] = findingsFor(audit([page]), ID);
  assert.deepEqual(/** @type {any} */ (finding.evidence.observed).hosts, ['b.test', 'farm.test']);
  assert.match(finding.evidence.detail ?? '', /^3 links to 2 other sites .* its text is one character \("-"\)\.$/);
  assert.equal(finding.selector, 'a[href="https://farm.test/x"]', 'the URL when the record has no link at that index');
});

test(`${ID} leaves out links to the deployed site of a local crawl`, () => {
  const page = makePage({ url: 'http://localhost:3000/', security: makeSecurity({ hidden_links: [hiddenAt(0, 'https://www.acme.com/pricing')] }) });
  const crawl = {
    start_url: 'http://localhost:3000/', site_origin: 'http://localhost:3000', site_host: 'localhost:3000',
    options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true, deployed_origin: 'https://acme.com' },
  };
  assert.deepEqual(findingsFor(audit([page], crawl), ID), []);
  assert.equal(findingsFor(audit([page], { ...crawl, options: { ...crawl.options, deployed_origin: undefined } }), ID).length, 1);
});

test(`${ID} has no unit on a page without signals, with damaged signals, or that is not an html page`, () => {
  const old = makePage({ url: `${SITE}/old`, security: undefined });
  const damaged = makePage({ url: `${SITE}/damaged`, security: /** @type {any} */ ({ ...makeSecurity(), headers: {} }) });
  const broken = makePage({ url: `${SITE}/gone`, status: 404, security: makeSecurity({ hidden_links: [hiddenAt(0, 'https://spam.test/')] }) });
  const result = audit([makePage(), old, damaged, broken]);
  assert.equal(statFor(result, ID).applicable, 1);
  assert.ok(result.checks.every((stat) => stat.status !== 'error'), 'no check fails on a damaged record');
});

test(`${ID} counts the same name under another ending as the organisation's only when a crawled page links there visibly (security review F2)`, () => {
  // Anyone can register <name>.<ending>: before 0.1.1 example.xyz passed as the site's own on example.test.
  const hidden = makePage({ url: `${SITE}/`, security: makeSecurity({ hidden_links: [hiddenAt(0, 'https://shop.example.xyz/pills')] }) });
  assert.equal(findingsFor(audit([hidden, makePage({ url: `${SITE}/about` })]), ID).length, 1, 'no visible link: another site');
  const linked = makePage({ url: `${SITE}/about`, security: makeSecurity({ visible_hosts: ['example.xyz'] }) });
  assert.equal(findingsFor(audit([hidden, linked]), ID).length, 0, 'a visible link to example.xyz makes its hosts the organisation\'s');
  const other = makePage({ url: `${SITE}/about`, security: makeSecurity({ visible_hosts: ['example-shop.xyz'] }) });
  assert.equal(findingsFor(audit([hidden, other]), ID).length, 1, 'only the same name counts');
});

test(`${ID} leaves out hosts under the site's registered domain, and not another customer of a shared host`, () => {
  const page = (/** @type {string} */ origin, /** @type {string} */ url) => makePage({ url: `${origin}/`, security: makeSecurity({ hidden_links: [hiddenAt(0, url)] }) });
  const site = (/** @type {string} */ host) => ({ start_url: `https://${host}/`, site_origin: `https://${host}`, site_host: host });
  assert.equal(findingsFor(audit([page(SITE, 'https://shop.example.test/x')]), ID).length, 0);
  assert.equal(findingsFor(audit([page('https://acme.vercel.app', 'https://spam.vercel.app/x')], site('acme.vercel.app')), ID).length, 1);
  assert.equal(findingsFor(audit([page('https://acme.wordpress.com', 'https://spam.wordpress.com/x')], site('acme.wordpress.com')), ID).length, 1);
  assert.equal(findingsFor(audit([page('https://acme.gen.tr', 'https://spam.gen.tr/x')], site('acme.gen.tr')), ID).length, 1);
});

test(`${ID} does not pass a page the scan read only in part: cut at its 200,000th tag or at its hosts (review A4)`, () => {
  const cut = (/** @type {string[]} */ limits, /** @type {string} */ path) => makePage({ url: `${SITE}${path}`, limits_reached: limits, security: makeSecurity() });
  const result = audit([cut(['tags'], '/a'), cut(['links', 'security.hosts'], '/b'), cut(['links'], '/c'), makePage({ url: `${SITE}/d` })]);
  assert.deepEqual([statFor(result, ID).applicable, statFor(result, ID).failed], [2, 0], 'only /c and /d pass: a page past 5,000 links was still read whole');
  const found = makePage({ url: `${SITE}/e`, limits_reached: ['tags'], security: makeSecurity({ hidden_links: [hiddenAt(0, 'https://spam.test/x')] }) });
  assert.equal(findingsFor(audit([found]), ID).length, 1, 'what was found is reported');
});

