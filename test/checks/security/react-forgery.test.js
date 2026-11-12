// A page can forge React's streaming runtime: define `$RC` as a function that
// does nothing and call it, so that a hidden block takes the exemption of a
// streamed boundary while it stays hidden from visitors. Three ways to close
// that were measured on 2026-11-12 (the runtime's known body or a part of it,
// other React or Next.js markers, a weaker finding for every streamed link no
// visible link names): each was either undone by one more statement the page
// writes, or brought the false alarms on nextjs.org and vercel.com back. The
// gap is kept and documented in CHECKS-SPEC.md; these tests pin what it
// costs: the hidden-link check stays silent, and the spam-term check reads
// such a block like the rest of the page, so spam it finds anywhere it finds
// there too (with its usual limits, listed in the spec).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractPage } from '../../../server/src/extract/page.js';
import { makeFetch, makeInput } from '../../extract/fetch-result.js';
import { audit, findingsFor, statFor } from './support.js';

const HIDDEN = 'security.hidden.external_link';
const SPAM = 'security.content.spam_terms';

/** @param {string} path @param {string} body */
function page(path, body) {
  const url = `https://example.test${path}`;
  return extractPage(makeInput(makeFetch({ url, html: `<!doctype html><html lang="en"><head><title>Bakery</title></head><body>${body}</body></html>` })));
}

/** A streamed boundary in the shape React writes, completed by an inline `$RC` whose body does nothing. @param {string} links */
const streamed = (links) => `<main><h1>Our bread</h1><a href="/about">About</a></main><!--$?--><template id="B:1"></template><p>Loading</p><!--/$-->
<div hidden id="S:1"><footer>${links}</footer></div><script>$RC=function(a,b){};$RC("B:1","S:1")</script>`;

const start = page('/', '<main><h1>Fresh bread every morning</h1><p>A family bakery.</p><a href="/promo">Offers</a></main>');

test('known gap: a forged runtime keeps a streamed block out of the hidden-link check, but its spam terms are still counted', () => {
  const result = audit([start, page('/promo', streamed('<a href="https://casino-bonus.test/slots">Best online casino bonus</a>'))]);
  assert.equal(statFor(result, HIDDEN).failed, 0, 'the forged boundary is read as revealed, as documented');
  const spam = findingsFor(result, SPAM);
  assert.deepEqual(spam.map((finding) => finding.url), ['https://example.test/promo']);
});

test('a streamed footer without spam passes both checks, as on nextjs.org and vercel.com', () => {
  const result = audit([start, page('/promo', streamed('<a href="https://community.partner.test/">Community</a><a href="https://github.com/partner">GitHub</a>'))]);
  assert.equal(statFor(result, HIDDEN).failed, 0);
  assert.equal(statFor(result, SPAM).failed, 0);
  assert.ok(statFor(result, SPAM).applicable >= 2);
});
