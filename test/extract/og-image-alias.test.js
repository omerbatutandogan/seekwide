// og:image:url and og:image:secure_url (validation of 2026-11-12, fix 2).
// Modeled on documentation pages of a large site that send og:image:url and
// no og:image; seo.social.og_incomplete reported their image as missing.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractHtml } from '../../server/src/extract/html.js';
import { audit } from '../checks/seo/helpers.js';
import { makePage } from '../helpers/factories.js';

/** @param {string} head */
function og(head) {
  return extractHtml(`<html><head>${head}</head><body><p>Text</p></body></html>`, {
    responseUrl: 'https://example.test/docs', siteHost: 'example.test', includeSubdomains: false,
  }).og;
}

test('og:image:url and og:image:secure_url give og:image when the page has none', () => {
  assert.equal(og('<meta property="og:title" content="Docs"><meta property="og:image:url" content="https://example.test/a.png">').image, 'https://example.test/a.png');
  assert.equal(og('<meta property="og:image:secure_url" content="https://example.test/s.png">').image, 'https://example.test/s.png');
  assert.equal(og('<meta property="og:image" content="https://example.test/1.png"><meta property="og:image:url" content="https://example.test/2.png">').image, 'https://example.test/1.png');
  // The property keeps its own key too.
  assert.equal(og('<meta property="og:image:url" content="https://example.test/a.png">')['image:url'], 'https://example.test/a.png');
});

test('an alias fills an empty og:image, and a later og:image with a value replaces an alias (review of 2026-11-12)', () => {
  assert.equal(og('<meta property="og:image" content=""><meta property="og:image:url" content="https://example.test/a.png">').image, 'https://example.test/a.png');
  assert.equal(og('<meta property="og:image:secure_url" content="https://example.test/s.png"><meta property="og:image" content="https://example.test/1.png">').image, 'https://example.test/1.png');
  assert.equal(og('<meta property="og:image" content=""><meta property="og:image" content="https://example.test/1.png">').image, '', 'two og:image tags keep the first, as before');
});

test('an empty alias does not take the place of a real og:image, and other image properties are not images', () => {
  assert.equal(og('<meta property="og:image:url" content=" "><meta property="og:image" content="https://example.test/1.png">').image, 'https://example.test/1.png');
  assert.equal(og('<meta property="og:image:alt" content="A chart"><meta property="og:image:width" content="1200">').image, undefined);
});

test('seo.social.og_incomplete passes a page that sends og:image:url and still fails one with no image at all', () => {
  const withAlias = makePage({ url: 'https://example.test/docs', og: og('<meta property="og:title" content="Docs"><meta property="og:image:url" content="https://example.test/a.png">') });
  const without = makePage({ url: 'https://example.test/other', og: og('<meta property="og:title" content="Other"><meta property="og:image:alt" content="A chart">') });
  const { units, failed, findings } = audit('seo.social.og_incomplete', { pages: [withAlias, without] });
  assert.deepEqual(units, ['https://example.test/docs', 'https://example.test/other']);
  assert.deepEqual(failed, ['https://example.test/other']);
  assert.deepEqual(findings[0].evidence?.observed, { missing: ['og:image'] });
});
