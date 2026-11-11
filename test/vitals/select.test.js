import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectVitalsPages } from '../../server/src/vitals/select.js';
import { SITE, makeCrawl, makePage, makeRedirect } from '../helpers/factories.js';

/** @param {string} path @param {Partial<import('../../server/src/types.js').PageRecord>} [overrides] */
const page = (path, overrides = {}) => makePage({ url: `${SITE}${path}`, depth: path === '/' ? 0 : 1, ...overrides });

const urls = (/** @type {{url: string}[]} */ list) => list.map((entry) => entry.url.replace(SITE, ''));

test('the start page comes first, then one page from each group, largest group first', () => {
  const crawl = makeCrawl({
    pages: [
      page('/'),
      page('/about'),
      page('/blog/b', { depth: 2 }), page('/blog/a', { depth: 2 }), page('/blog/c', { depth: 2 }),
      page('/shop/x', { depth: 2 }), page('/shop/y', { depth: 2 }),
    ],
  });
  assert.deepEqual(selectVitalsPages(crawl, 4), [
    { url: `${SITE}/`, why: 'Start page' },
    { url: `${SITE}/blog/a`, why: 'One of 3 pages under /blog/' },
    { url: `${SITE}/shop/x`, why: 'One of 2 pages under /shop/' },
    { url: `${SITE}/about`, why: 'Top-level page' },
  ]);
});

test('the limit is respected and the default is three', () => {
  const crawl = makeCrawl({ pages: [page('/'), page('/a'), page('/b'), page('/c'), page('/d')] });
  assert.equal(selectVitalsPages(crawl).length, 3);
  assert.deepEqual(urls(selectVitalsPages(crawl, 1)), ['/']);
  assert.equal(selectVitalsPages(crawl, 10).length, 5, 'never more pages than there are');
});

test('a limit above the number of groups goes through the groups again for their next page', () => {
  const crawl = makeCrawl({
    pages: [page('/'), page('/about'), page('/blog/b', { depth: 2 }), page('/blog/a', { depth: 2 }), page('/blog/c', { depth: 2 }), page('/shop/x', { depth: 2 }), page('/shop/y', { depth: 2 })],
  });
  assert.deepEqual(urls(selectVitalsPages(crawl, 10)), ['/', '/blog/a', '/shop/x', '/about', '/blog/b', '/shop/y', '/blog/c']);
  assert.deepEqual(urls(selectVitalsPages(crawl, 5)), ['/', '/blog/a', '/shop/x', '/about', '/blog/b']);
  assert.equal(new Set(selectVitalsPages(crawl, 10).map((entry) => entry.url)).size, 7, 'no page is chosen twice');
});

test('only indexable HTML pages that answered 200 are candidates', () => {
  const crawl = makeCrawl({
    pages: [
      page('/'),
      page('/noindex', { indexability: { indexable: false, reasons: ['noindex_meta'] } }),
      page('/gone', { status: 404, indexability: { indexable: false, reasons: ['status_404'] } }),
      page('/file.pdf', { is_html: false, indexability: { indexable: false, reasons: ['not_html'] } }),
      makeRedirect(`${SITE}/old`, `${SITE}/new`),
      page('/new'),
    ],
  });
  assert.deepEqual(urls(selectVitalsPages(crawl, 10)), ['/', '/new']);
});

test('a start URL that redirects is represented by the page it ends on', () => {
  const crawl = makeCrawl({
    start_url: `${SITE}/`,
    pages: [makeRedirect(`${SITE}/`, `${SITE}/en/`), page('/en/', { depth: 0 }), page('/en/about')],
  });
  assert.deepEqual(selectVitalsPages(crawl, 2), [
    { url: `${SITE}/en/`, why: 'Start page' },
    { url: `${SITE}/en/about`, why: 'The only page under /en/' },
  ]);
});

test('a start page that is not indexable is not measured; the others still are', () => {
  const crawl = makeCrawl({ pages: [page('/', { indexability: { indexable: false, reasons: ['noindex_meta'] } }), page('/a')] });
  assert.deepEqual(selectVitalsPages(crawl, 3), [{ url: `${SITE}/a`, why: 'Top-level page' }]);
});

test('inside a group the page closest to the start page wins, then the first by URL; sitemap-only pages come last', () => {
  const crawl = makeCrawl({
    pages: [
      page('/'),
      page('/docs/zeta', { depth: 1 }),
      page('/docs/alpha', { depth: 2 }),
      page('/docs/beta', { depth: null }),
      page('/docs/aaa', { depth: null }),
    ],
  });
  assert.deepEqual(selectVitalsPages(crawl, 2)[1], { url: `${SITE}/docs/zeta`, why: 'One of 4 pages under /docs/' });
  const sitemapOnly = makeCrawl({ pages: [page('/'), page('/docs/b', { depth: null }), page('/docs/a', { depth: null })] });
  assert.equal(selectVitalsPages(sitemapOnly, 2)[1].url, `${SITE}/docs/a`);
});

test('groups of the same size are ordered by how close they are to the start page, then by name', () => {
  const crawl = makeCrawl({
    pages: [page('/'), page('/zebra', { depth: 1 }), page('/apple', { depth: 2 }), page('/mango', { depth: 1 }), page('/far', { depth: null })],
  });
  assert.deepEqual(urls(selectVitalsPages(crawl, 10)), ['/', '/mango', '/zebra', '/apple', '/far']);
});

test('the same crawl always gives the same pages, whatever the record order', () => {
  const pages = [page('/'), page('/blog/a', { depth: 2 }), page('/blog/b', { depth: 2 }), page('/shop/x', { depth: 2 }), page('/about')];
  const forward = selectVitalsPages(makeCrawl({ pages }), 5);
  const backward = selectVitalsPages(makeCrawl({ pages: [...pages].reverse() }), 5);
  assert.deepEqual(forward, backward);
});

test('a crawl without an indexable page gives nothing to measure', () => {
  assert.deepEqual(selectVitalsPages(makeCrawl({ pages: [] }), 3), []);
  assert.deepEqual(selectVitalsPages(makeCrawl({ pages: [page('/', { status: 500, indexability: { indexable: false, reasons: ['status_500'] } })] }), 3), []);
});

test('a long path segment is clipped in the reason, and a bad limit throws', () => {
  const crawl = makeCrawl({ pages: [page('/'), page(`/${'s'.repeat(200)}/one`), page(`/${'s'.repeat(200)}/two`)] });
  const [, second] = selectVitalsPages(crawl, 2);
  assert.ok(second.why.length < 100, second.why);
  assert.match(second.why, /^One of 2 pages under \/s+…\/$/);
  assert.throws(() => selectVitalsPages(crawl, 0), TypeError);
  assert.throws(() => selectVitalsPages(crawl, 1.5), TypeError);
});
