import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MIN_PAGES_FOR_RARE } from '../../../server/src/checks/security/embeds.js';
import { SITE, makePage, makeSecurity } from '../../helpers/factories.js';
import { audit, findingsFor, statFor } from './support.js';

const FRAME = 'security.embeds.hidden_frame';
const RARE = 'security.embeds.rare_host';

/**
 * @param {'script'|'iframe'} tag
 * @param {string} url
 * @param {string|null} [hidden]
 * @returns {import('../../../server/src/types.js').EmbedRecord}
 */
const embed = (tag, url, hidden = null) => ({ tag, url, host: new URL(url).host.replace(/^www\./, ''), hidden, line: 12 });

/**
 * @param {string} path
 * @param {import('../../../server/src/types.js').EmbedRecord[]} embeds
 */
const page = (path, embeds) => makePage({ url: `${SITE}${path}`, security: makeSecurity({ embeds }) });

test(`${FRAME} fails a page with a hidden frame from another site and passes one whose frames are visible`, () => {
  const result = audit([
    page('/', [embed('iframe', 'https://www.youtube-nocookie.com/embed/a'), embed('script', 'https://cdn.test/a.js')]),
    page('/about', [embed('iframe', 'https://bad.test/x', 'zero size'), embed('iframe', 'https://bad.test/y', 'display:none')]),
    page('/blog', [embed('script', 'https://cdn.test/a.js')]),
  ]);
  const stat = statFor(result, FRAME);
  assert.deepEqual([stat.applicable, stat.failed], [2, 1], 'a page without frames is not a unit');
  const [finding] = findingsFor(result, FRAME);
  assert.equal(finding.url, `${SITE}/about`);
  assert.equal(finding.selector, 'iframe[src="https://bad.test/x"]');
  assert.equal(finding.line, 12);
  assert.deepEqual(finding.evidence.observed, { hidden_frames: 2, hosts: ['bad.test'], first: { src: 'https://bad.test/x', how: 'zero size' } });
});

/** Pages that load only a shared tag, so that the crawl reaches `MIN_PAGES_FOR_RARE`. @param {number} count @param {import('../../../server/src/types.js').EmbedRecord[]} embeds */
const filler = (count, embeds) => Array.from({ length: count }, (_, i) => page(`/filler-${i}`, embeds));

test(`${RARE} lists a script or frame host that only one page uses, on a crawl of 50 or more pages`, () => {
  const shared = embed('script', 'https://www.googletagmanager.com/gtag/js');
  const pages = [
    page('/', [shared]),
    page('/a', [shared, embed('script', 'https://odd.test/x.js'), embed('script', 'https://odd.test/y.js')]),
    page('/b', [shared, embed('iframe', 'https://maps.test/embed')]),
    page('/c', [shared, embed('iframe', 'https://maps.test/embed')]),
    ...filler(MIN_PAGES_FOR_RARE - 4, [shared]),
  ];
  const result = audit(pages);
  const stat = statFor(result, RARE);
  assert.deepEqual([stat.applicable, stat.failed], [MIN_PAGES_FOR_RARE + 3, 1]);
  const [finding] = findingsFor(result, RARE);
  assert.equal(finding.severity, 'info');
  assert.equal(finding.weight, 0);
  assert.equal(finding.url, `${SITE}/a`);
  assert.equal(finding.selector, 'script[src="https://odd.test/x.js"]');
  assert.deepEqual(finding.evidence.observed, { host: 'odd.test', tag: 'script', src: 'https://odd.test/x.js', pages_crawled: MIN_PAGES_FOR_RARE });
});

test(`${RARE} has no unit on a crawl of fewer than 50 pages, and never changes the score`, () => {
  // A 25-page crawl: every embed on one page is used by one page, which says nothing (validation of 2026-11-12, fix 12).
  const pages25 = [page('/', []), page('/a', [embed('iframe', 'https://www.youtube.com/embed/x')]), ...filler(23, [])];
  assert.equal(statFor(audit(pages25), RARE).applicable, 0);
  const pages = [page('/', []), page('/a', [embed('script', 'https://odd.test/x.js')]), ...filler(MIN_PAGES_FOR_RARE - 2, [])];
  assert.equal(findingsFor(audit(pages), RARE).length, 1);
  assert.equal(audit(pages).modules.security.score, 100);
});

test(`${RARE} leaves out the hosts of the site's own organisation, and nothing else`, () => {
  // Modeled on a blog that embeds a page of its organisation's site in another language (a subdomain).
  // The same name under another domain, and another tenant of a shared host, are other sites.
  const pages = [page('/', []), page('/a', [embed('iframe', 'https://it.example.test/widget'), embed('script', 'https://cdn.example.test/x.js'),
    embed('script', 'https://example.xyz/x.js'), embed('script', 'https://odd.test/x.js')]), ...filler(MIN_PAGES_FOR_RARE - 2, [])];
  assert.deepEqual(findingsFor(audit(pages), RARE).map((finding) => /** @type {any} */ (finding.evidence.observed).host).sort(), ['example.xyz', 'odd.test']);
  // vercel.app is a public suffix (the private section of the Public Suffix List): each customer's host is a site of its own.
  const tenant = (/** @type {string} */ path, /** @type {import('../../../server/src/types.js').EmbedRecord[]} */ embeds) =>
    makePage({ url: `https://mysite.vercel.app${path}`, security: makeSecurity({ embeds }) });
  const shared = [tenant('/', []), tenant('/a', [embed('script', 'https://evil.vercel.app/x.js')]), ...Array.from({ length: MIN_PAGES_FOR_RARE - 2 }, (_, i) => tenant(`/f${i}`, []))];
  const crawl = { start_url: 'https://mysite.vercel.app/', site_origin: 'https://mysite.vercel.app', site_host: 'mysite.vercel.app' };
  assert.deepEqual(findingsFor(audit(shared, crawl), RARE).map((finding) => /** @type {any} */ (finding.evidence.observed).host), ['evil.vercel.app']);
});

test(`${RARE} counts the same name under another ending as the organisation's only when a page links there visibly`, () => {
  const linked = makePage({ url: `${SITE}/`, security: makeSecurity({ visible_hosts: ['example.xyz'] }) });
  const pages = [linked, page('/a', [embed('script', 'https://cdn.example.xyz/x.js')]), ...filler(MIN_PAGES_FOR_RARE - 2, [])];
  assert.deepEqual(findingsFor(audit(pages), RARE), []);
  const unlinked = [page('/', []), page('/a', [embed('script', 'https://cdn.example.xyz/x.js')]), ...filler(MIN_PAGES_FOR_RARE - 2, [])];
  assert.deepEqual(findingsFor(audit(unlinked), RARE).map((finding) => /** @type {any} */ (finding.evidence.observed).host), ['cdn.example.xyz']);
});

test(`${FRAME} and ${RARE} leave out frames and scripts from the deployed site of a local crawl`, () => {
  const local = (/** @type {string} */ path, /** @type {import('../../../server/src/types.js').EmbedRecord[]} */ embeds) =>
    makePage({ url: `http://localhost:3000${path}`, security: makeSecurity({ embeds }) });
  const pages = ['/', '/a', '/b', '/c', '/d'].map((path, i) => local(path, i === 1 ? [embed('iframe', 'https://www.acme.com/widget', 'zero size')] : []));
  const crawl = {
    start_url: 'http://localhost:3000/', site_origin: 'http://localhost:3000', site_host: 'localhost:3000',
    options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true, deployed_origin: 'https://acme.com' },
  };
  const result = audit(pages, crawl);
  assert.equal(statFor(result, FRAME).applicable, 0);
  assert.equal(statFor(result, RARE).applicable, 0);
  assert.equal(findingsFor(audit(pages, { ...crawl, options: { ...crawl.options, deployed_origin: undefined } }), FRAME).length, 1);
});
