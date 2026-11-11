import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makeLink, makePage, makeRedirect } from '../../helpers/factories.js';
import { audit, findingsFor, statFor } from './support.js';

const ID = 'links.orphan.sitemap_only';

/**
 * @param {string[]} urls
 * @returns {{files: never[], urls: string[], truncated: boolean}}
 */
const sitemap = (urls) => ({ files: [], urls, truncated: false });

test('links.orphan.sitemap_only fails for a sitemap URL no page links to', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [makeLink({ url: `${SITE}/linked`, href: '/linked' }), makeLink({ url: `${SITE}/old`, href: '/old' })],
  });
  const pages = [
    home,
    makePage({ url: `${SITE}/linked`, depth: 1 }),
    makeRedirect(`${SITE}/old`, `${SITE}/via-redirect`, { depth: 1 }),
    makePage({ url: `${SITE}/via-redirect`, depth: 2, discovered_via: ['redirect'] }),
    makePage({ url: `${SITE}/orphan`, depth: null, discovered_via: ['sitemap'] }),
  ];
  const urls = [`${SITE}/`, `${SITE}/linked`, `${SITE}/via-redirect`, `${SITE}/orphan`, 'https://other.test/page'];

  const { result } = audit(pages, { crawl: { sitemap: sitemap(urls) } });
  const stat = statFor(result, ID);
  // The start page and the external URL are not units.
  assert.equal(stat.status, 'run');
  assert.equal(stat.applicable, 3);
  assert.equal(stat.passed, 2);
  assert.equal(stat.failed, 1);

  const [finding] = findingsFor(result, ID);
  assert.equal(finding.url, `${SITE}/orphan`);
  assert.equal(finding.selector, null);
  assert.equal(finding.severity, 'medium');
  assert.equal(finding.confidence, 'likely');
  assert.deepEqual(finding.evidence.observed, { links_from_pages: 0, pages_checked: 4 });
  assert.equal(finding.evidence.expected, 'At least one link from another crawled page');
});

test('links.orphan.sitemap_only counts a link to a redirect as a link to its destination', () => {
  const home = makePage({ url: `${SITE}/`, links: [makeLink({ url: `${SITE}/old`, href: '/old' })] });
  const pages = [home, makeRedirect(`${SITE}/old`, `${SITE}/new`), makePage({ url: `${SITE}/new`, depth: 1 })];

  const { result } = audit(pages, { crawl: { sitemap: sitemap([`${SITE}/new`]) } });
  const stat = statFor(result, ID);
  assert.equal(stat.applicable, 1);
  assert.equal(stat.passed, 1);
  assert.equal(findingsFor(result, ID).length, 0);
});

test('links.orphan.sitemap_only passes a linked URL that was not crawled', () => {
  const home = makePage({ url: `${SITE}/`, links: [makeLink({ url: `${SITE}/blocked`, href: '/blocked' })] });
  const { result } = audit([home], { crawl: { sitemap: sitemap([`${SITE}/blocked`]) } });
  assert.equal(statFor(result, ID).passed, 1);
  assert.equal(findingsFor(result, ID).length, 0);
});

test('links.orphan.sitemap_only leaves out the start URL and the start page the start URL redirects to', () => {
  const pages = [
    makeRedirect(`${SITE}/start`, `${SITE}/home`),
    makePage({ url: `${SITE}/home`, depth: 0 }),
    makePage({ url: `${SITE}/lonely`, depth: null, discovered_via: ['sitemap'] }),
  ];
  const urls = [`${SITE}/start`, `${SITE}/home`, `${SITE}/lonely`];

  const { result } = audit(pages, { crawl: { start_url: `${SITE}/start`, sitemap: sitemap(urls) } });
  const stat = statFor(result, ID);
  assert.equal(stat.applicable, 1);
  assert.deepEqual(findingsFor(result, ID).map((f) => f.url), [`${SITE}/lonely`]);
});

test('links.orphan.sitemap_only only counts links from html pages', () => {
  const errorPage = makePage({
    url: `${SITE}/error`,
    status: 404,
    indexability: { indexable: false, reasons: ['status_404'] },
    links: [makeLink({ url: `${SITE}/x`, href: '/x' })],
  });
  const pages = [makePage({ url: `${SITE}/` }), errorPage, makePage({ url: `${SITE}/x`, depth: null })];

  const { result } = audit(pages, { crawl: { sitemap: sitemap([`${SITE}/x`]) } });
  assert.deepEqual(findingsFor(result, ID).map((f) => f.url), [`${SITE}/x`]);
});

test('links.orphan.sitemap_only does not count a link from a page to itself', () => {
  const selfOnly = makePage({ url: `${SITE}/y`, depth: 1, links: [makeLink({ url: `${SITE}/y`, href: '/y' })] });
  const selfAndOther = makePage({
    url: `${SITE}/z`,
    depth: 1,
    links: [makeLink({ url: `${SITE}/z`, href: '/z' }), makeLink({ url: `${SITE}/w`, href: '/w' })],
  });
  const pages = [
    makePage({ url: `${SITE}/`, links: [makeLink({ url: `${SITE}/z`, href: '/z' })] }),
    selfOnly,
    selfAndOther,
    makePage({ url: `${SITE}/w`, depth: 2 }),
  ];

  const { result } = audit(pages, { crawl: { sitemap: sitemap([`${SITE}/y`, `${SITE}/z`, `${SITE}/w`]) } });
  assert.equal(statFor(result, ID).applicable, 3);
  // /y is linked only from itself. /z is linked from the home page, /w from /z.
  assert.deepEqual(findingsFor(result, ID).map((f) => f.url), [`${SITE}/y`]);
});

test('links.orphan.sitemap_only does not count a link to a redirect that leads back to the same page', () => {
  const page = makePage({ url: `${SITE}/p`, depth: 1, links: [makeLink({ url: `${SITE}/p-old`, href: '/p-old' })] });
  const pages = [makePage({ url: `${SITE}/` }), page, makeRedirect(`${SITE}/p-old`, `${SITE}/p`, { depth: 2 })];

  const { result } = audit(pages, { crawl: { sitemap: sitemap([`${SITE}/p`]) } });
  assert.deepEqual(findingsFor(result, ID).map((f) => f.url), [`${SITE}/p`]);
});

test('links.orphan.sitemap_only treats subdomain URLs as internal only when the crawl includes subdomains', () => {
  const pages = [makePage({ url: `${SITE}/` })];
  const urls = ['https://blog.example.test/post'];

  const without = audit(pages, { crawl: { sitemap: sitemap(urls) } });
  assert.equal(statFor(without.result, ID).applicable, 0);

  const withSubdomains = audit(pages, {
    crawl: { sitemap: sitemap(urls), options: { max_pages: 25, rate_per_sec: 1, include_subdomains: true } },
  });
  assert.equal(statFor(withSubdomains.result, ID).applicable, 1);
  assert.deepEqual(findingsFor(withSubdomains.result, ID).map((f) => f.url), urls);
});

test('links.orphan.sitemap_only is skipped for a truncated or blocked crawl and without a sitemap', () => {
  const pages = [makePage({ url: `${SITE}/` }), makePage({ url: `${SITE}/orphan`, depth: null })];
  const withSitemap = sitemap([`${SITE}/orphan`]);

  const truncated = audit(pages, { crawl: { sitemap: withSitemap, truncated: true } });
  const truncatedStat = statFor(truncated.result, ID);
  assert.equal(truncatedStat.status, 'skipped');
  assert.match(truncatedStat.skip_reason ?? '', /complete crawl/);
  assert.equal(findingsFor(truncated.result, ID).length, 0);

  const blocked = audit(pages, {
    crawl: { sitemap: withSitemap, blocked: { reason: 'bot_challenge', url: `${SITE}/`, status: 403 } },
  });
  assert.equal(statFor(blocked.result, ID).status, 'skipped');

  const noSitemap = audit(pages);
  const noSitemapStat = statFor(noSitemap.result, ID);
  assert.equal(noSitemapStat.status, 'skipped');
  assert.match(noSitemapStat.skip_reason ?? '', /XML sitemap/);
});
