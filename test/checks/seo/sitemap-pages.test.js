import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makePage, makeRedirect } from '../../helpers/factories.js';
import { audit } from './helpers.js';

/**
 * A record for a URL the crawler was refused on.
 * @param {string} url
 * @param {number} status
 * @param {string} fetchError
 */
function unreadable(url, status, fetchError) {
  return makePage({
    url,
    status,
    is_html: false,
    fetch_error: fetchError,
    titles: [],
    meta_descriptions: [],
    canonicals: [],
    headings: [],
    indexability: { indexable: false, reasons: ['fetch_error'] },
  });
}

/**
 * @param {string[]} urls
 */
function sitemap(urls) {
  return { loaded: true, files: [{ url: `${SITE}/sitemap.xml`, status: 200, type: /** @type {const} */ ('urlset'), count: urls.length, error: null }], urls, truncated: false };
}

test('seo.indexing.noindex_in_sitemap fails noindex pages listed in the sitemap', () => {
  const pages = [
    makePage({ url: `${SITE}/listed-ok` }),
    makePage({ url: `${SITE}/listed-hidden`, x_robots: ['noindex'], indexability: { indexable: false, reasons: ['noindex_header'] } }),
    makePage({ url: `${SITE}/unlisted-hidden`, indexability: { indexable: false, reasons: ['noindex_meta'] } }),
  ];
  const { units, failed, findings } = audit('seo.indexing.noindex_in_sitemap', {
    pages,
    sitemap: sitemap([`${SITE}/listed-ok`, `${SITE}/listed-hidden`, `${SITE}/not-crawled`]),
  });
  assert.deepEqual(units, [`${SITE}/listed-hidden`, `${SITE}/listed-ok`]);
  assert.deepEqual(failed, [`${SITE}/listed-hidden`]);
  assert.match(findings[0].evidence.detail ?? '', /X-Robots-Tag/);
});

test('sitemap page checks are skipped when the crawl has no sitemap URLs', () => {
  for (const id of ['seo.indexing.noindex_in_sitemap', 'seo.sitemap.url_not_ok', 'seo.sitemap.url_canonicalized']) {
    const { stat } = audit(id, { pages: [makePage()] });
    assert.equal(stat.status, 'skipped', id);
  }
});

test('seo.sitemap.url_not_ok fails listed records that do not answer 200', () => {
  const pages = [
    makePage({ url: `${SITE}/ok` }),
    makePage({ url: `${SITE}/gone`, status: 404, indexability: { indexable: false, reasons: ['status_404'] } }),
    makeRedirect(`${SITE}/old`, `${SITE}/ok`),
    makePage({ url: `${SITE}/unlisted`, status: 500, indexability: { indexable: false, reasons: ['status_500'] } }),
    unreadable(`${SITE}/challenged`, 503, 'bot_challenge'),
    unreadable(`${SITE}/limited`, 429, 'rate_limited'),
  ];
  const { units, failed, findings } = audit('seo.sitemap.url_not_ok', {
    pages,
    sitemap: sitemap([`${SITE}/ok`, `${SITE}/gone`, `${SITE}/old`, `${SITE}/challenged`, `${SITE}/limited`]),
  });
  assert.deepEqual(units, [`${SITE}/gone`, `${SITE}/ok`, `${SITE}/old`]);
  assert.deepEqual(failed, [`${SITE}/gone`, `${SITE}/old`]);
  assert.deepEqual(findings.find((f) => f.url === `${SITE}/old`)?.evidence.observed, { status: 301, final_url: `${SITE}/ok` });
});

test('seo.sitemap.url_canonicalized fails listed pages whose canonical points elsewhere', () => {
  const pages = [
    makePage({
      url: `${SITE}/dup`,
      canonicals: [{ href: `${SITE}/main`, url: `${SITE}/main`, source: 'html', in_head: true, line: 6 }],
      indexability: { indexable: false, reasons: ['canonical_elsewhere'] },
    }),
    makePage({ url: `${SITE}/main` }),
  ];
  const { units, failed, findings } = audit('seo.sitemap.url_canonicalized', { pages, sitemap: sitemap([`${SITE}/dup`, `${SITE}/main`]) });
  assert.deepEqual(units, [`${SITE}/dup`, `${SITE}/main`]);
  assert.deepEqual(failed, [`${SITE}/dup`]);
  assert.deepEqual(findings[0].evidence.observed, [`${SITE}/main`]);
  assert.equal(findings[0].line, 6);
});
