// Wording the validation of 2026-11-12 found wrong (confusion item 8): the
// verb after "1 other page", and a canonical target that redirects described
// as "not an HTML page".

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { makePage, makeRedirect } from '../../helpers/factories.js';
import { audit } from './helpers.js';

const SITE = 'https://example.test';

test('the verb agrees with the number of other pages', () => {
  const words = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  const pair = [makePage({ url: `${SITE}/a`, title: 'Same', titles: ['Same'], word_count: 60, text_hash: 'h1', text_excerpt: words }), makePage({ url: `${SITE}/b`, titles: ['Same'], word_count: 60, text_hash: 'h1', text_excerpt: words })];
  assert.equal(audit('seo.content.duplicate_body', { pages: pair }).findings[0].evidence.detail, '1 other page has exactly the same visible text.');
  assert.equal(audit('seo.title.duplicate', { pages: pair }).findings[0].evidence.detail, '1 other page uses the same title.');
  const three = [...pair, makePage({ url: `${SITE}/c`, titles: ['Same'], word_count: 60, text_hash: 'h1' })];
  assert.equal(audit('seo.content.duplicate_body', { pages: three }).findings[0].evidence.detail, '2 other pages have exactly the same visible text.');
});

test('a canonical target that redirects is described by its redirect, not as a page that is not HTML', () => {
  const canonical = { href: `${SITE}/old`, url: `${SITE}/old`, source: /** @type {const} */ ('html'), in_head: true, line: 4 };
  const pages = [
    makePage({ url: `${SITE}/page`, canonicals: [canonical], indexability: { indexable: false, reasons: ['canonical_elsewhere'] } }),
    makeRedirect(`${SITE}/old`, `${SITE}/new`, { status: 302, redirect_chain: [{ url: `${SITE}/old`, status: 302, location: `${SITE}/new` }] }),
  ];
  const [finding] = audit('seo.canonical.target_not_ok', { pages }).findings;
  assert.equal(finding.evidence.detail, `The canonical target answers HTTP 302 and redirects to ${SITE}/new.`);
});
