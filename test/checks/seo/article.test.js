import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makePage } from '../../helpers/factories.js';
import { parseJsonLd } from '../../../plugin/server/src/extract/jsonld.js';
import { audit } from './helpers.js';

/** A page whose JSON-LD is `data`, read by the real parser. @param {string} path @param {unknown} data */
const page = (path, data) => makePage({ url: `${SITE}${path}`, jsonld: [parseJsonLd(JSON.stringify(data), 3)] });

const FULL = {
  '@context': 'https://schema.org', '@type': 'BlogPosting', headline: 'Fixing pipes',
  author: [{ '@type': 'Person', name: 'Ada', url: `${SITE}/authors/ada` }, { '@type': 'Person', name: 'Bo' }],
  datePublished: '2026-11-20T08:00:00+03:00', dateModified: '2026-11-21T08:00:00+03:00',
};

test('Article, NewsArticle and BlogPosting are read with their authors and dates, also in @graph', () => {
  const [article] = parseJsonLd(JSON.stringify(FULL), 1).articles ?? [];
  assert.deepEqual(article, { type: 'BlogPosting', authors: 2, named_authors: 2, linked_authors: 1, date_published: true, date_modified: true });
  const graph = parseJsonLd(JSON.stringify({ '@graph': [{ '@type': 'WebPage' }, { '@type': ['schema:NewsArticle'], author: 'Ada Lovelace' }] }), 1).articles ?? [];
  assert.deepEqual(graph, [{ type: 'schema:NewsArticle', authors: 1, named_authors: 1, linked_authors: 0, date_published: false, date_modified: false }]);
  assert.deepEqual(parseJsonLd('{"@type":"TechArticle"}', 1).articles, [], 'only the three types Google names');
  assert.deepEqual(parseJsonLd('not json', 1).articles, []);
});

test('a complete article passes; a page without Article markup is no unit', () => {
  for (const id of ['seo.article.author_missing', 'seo.article.author_unlinked', 'seo.article.date_missing']) {
    const { stat } = audit(id, { pages: [page('/blog/pipes', FULL), page('/', { '@type': 'Organization', name: 'Acme' })] });
    assert.deepEqual([stat.applicable, stat.failed], [1, 0], id);
  }
});

test('seo.article.author_missing: no author, or authors without a name', () => {
  const { stat, findings } = audit('seo.article.author_missing', { pages: [page('/a', { '@type': 'Article' }), page('/b', { '@type': 'Article', author: { '@type': 'Person', url: `${SITE}/x` } })] });
  assert.deepEqual([stat.applicable, stat.failed], [2, 2]);
  assert.equal(findings[0].severity, 'info');
  assert.equal(findings[0].line, 3);
  assert.deepEqual(findings.map((finding) => finding.evidence.observed), [{ type: 'Article', authors: 0, named_authors: 0 }, { type: 'Article', authors: 1, named_authors: 0 }]);
});

test('seo.article.author_unlinked: named authors with no url or sameAs; sameAs is enough', () => {
  const plain = { '@type': 'NewsArticle', author: [{ '@type': 'Person', name: 'Ada' }, 'Bo'], datePublished: '2026-11-20' };
  const { stat, findings } = audit('seo.article.author_unlinked', { pages: [page('/a', plain), page('/b', { '@type': 'Article' })] });
  assert.deepEqual([stat.applicable, stat.failed], [1, 1], 'an article without a named author is author_missing\'s');
  assert.deepEqual(findings[0].evidence.observed, { type: 'NewsArticle', named_authors: 2, linked_authors: 0 });
  const sameAs = { ...plain, author: { '@type': 'Person', name: 'Ada', sameAs: ['https://social.test/ada'] } };
  assert.equal(audit('seo.article.author_unlinked', { pages: [page('/a', sameAs)] }).stat.failed, 0);
});

test('seo.article.date_missing: no datePublished', () => {
  const { stat, findings } = audit('seo.article.date_missing', { pages: [page('/a', { ...FULL, datePublished: undefined })] });
  assert.deepEqual([stat.applicable, stat.failed], [1, 1]);
  assert.deepEqual(findings[0].evidence.observed, { type: 'BlogPosting', date_modified: true });
});

test('a crawl made before rule set 0.2.4 skips the article checks', () => {
  const old = makePage({ url: `${SITE}/a`, jsonld: [{ ...parseJsonLd(JSON.stringify(FULL), 1), articles: undefined }] });
  assert.equal(audit('seo.article.author_missing', { pages: [old] }).stat.status, 'skipped');
});
