import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseJsonLd } from '../../server/src/extract/jsonld.js';

/** @param {unknown} data */
const videos = (data) => parseJsonLd(JSON.stringify(data), 1).videos;

const COMPLETE = { '@type': 'VideoObject', name: 'Launch', thumbnailUrl: 'https://e.test/t.jpg', uploadDate: '2026-01-02T10:00:00+01:00' };

test('a VideoObject is found at the top level, in an array, in @graph and nested in another object, in document order', () => {
  assert.deepEqual(videos(COMPLETE), [{ name: true, thumbnail_url: true, upload_date: true }]);
  assert.equal(videos([{ '@type': 'Organization' }, COMPLETE]).length, 1);
  const graph = { '@graph': [{ '@type': 'WebPage' }, { '@type': 'NewsArticle', video: { ...COMPLETE, name: '' } }, COMPLETE] };
  assert.deepEqual(videos(graph), [{ name: false, thumbnail_url: true, upload_date: true }, { name: true, thumbnail_url: true, upload_date: true }]);
});

test('a VideoObject type is read in its usual spellings and in a list of types', () => {
  for (const type of ['VideoObject', 'schema:VideoObject', 'https://schema.org/VideoObject', ['VideoObject', 'LearningResource']]) {
    assert.equal(videos({ ...COMPLETE, '@type': type }).length, 1, JSON.stringify(type));
  }
  assert.equal(videos({ ...COMPLETE, '@type': 'MyVideoObjectish' }).length, 0);
  assert.equal(videos({ name: 'x', thumbnailUrl: 'y', uploadDate: 'z' }).length, 0, 'a node without a type is not a VideoObject');
});

test('Google\'s required properties: name and uploadDate as text, thumbnailUrl as text, a list of text or an object with a URL', () => {
  assert.deepEqual(videos({ '@type': 'VideoObject' }), [{ name: false, thumbnail_url: false, upload_date: false }]);
  assert.equal(videos({ ...COMPLETE, thumbnailUrl: ['', 'https://e.test/t.jpg'] })[0].thumbnail_url, true);
  assert.equal(videos({ ...COMPLETE, thumbnailUrl: { '@type': 'ImageObject', url: 'https://e.test/t.jpg' } })[0].thumbnail_url, true);
  assert.equal(videos({ ...COMPLETE, thumbnailUrl: [] })[0].thumbnail_url, false);
  assert.equal(videos({ ...COMPLETE, uploadDate: '  ' })[0].upload_date, false);
  assert.equal(videos({ ...COMPLETE, name: 42 })[0].name, false);
});

test('a reference by @id is not a second VideoObject, and invalid JSON has none', () => {
  assert.equal(videos({ '@graph': [{ '@type': 'WebPage', video: { '@id': '#v' } }, { ...COMPLETE, '@id': '#v' }] }).length, 1);
  assert.deepEqual(parseJsonLd('{"@type": "VideoObject",', 1).videos, []);
});

test('the search is bounded in depth and in the number of VideoObjects kept', () => {
  /** @type {any} */
  let deep = COMPLETE;
  for (let i = 0; i < 50; i += 1) deep = { child: deep };
  assert.equal(videos(deep).length, 0, 'a VideoObject 50 levels down is beyond the search');
  assert.equal(videos(Array.from({ length: 100 }, () => COMPLETE)).length, 20);
});
