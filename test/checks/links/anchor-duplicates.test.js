// links.anchor.empty and links.anchor.generic: links that are not meant to
// carry text, and copies of a link that is named (validation of 2026-11-12,
// fixes 5 and 7). The markup models what real sites sent: heading permalinks
// marked aria-hidden, `href="#"` icon buttons in a sticky header, a shop card
// whose image link (alt="") sits beside the product's text link, a mega-menu
// that repeats a link as an image, and "Read more" beside the article title.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractHtml } from '../../../server/src/extract/html.js';
import { SITE, makePage } from '../../helpers/factories.js';
import { audit, findingsFor, statFor } from './support.js';

/**
 * The links module run on one page built from this markup.
 * @param {string} body
 */
function run(body) {
  const url = `${SITE}/article`;
  const { links } = extractHtml(`<html><head><title>Article</title></head><body>${body}</body></html>`, {
    responseUrl: url, siteHost: new URL(SITE).host, includeSubdomains: false,
  });
  return audit([makePage({ url, links })]).result;
}

test('aria-hidden links and links into the page itself are not units of links.anchor.empty', () => {
  const result = run(`
<h2 id="the-html"><a href="#the-html" aria-hidden="true"><svg aria-hidden="true"><path d="M0 0"/></svg></a>The HTML</h2>
<header><a href="#" class="icon-button"><span class="icon"></span></a><a href="#search"><span></span></a></header>
<div aria-hidden="true"><a href="/promo"><img src="/p.png" alt=""></a></div>`);
  assert.equal(statFor(result, 'links.anchor.empty').applicable, 0);
});

test('an image link beside a named link to the same page passes; an icon that is the only link to a site still fails', () => {
  const result = run(`
<div class="card"><a href="/product/blue-mug" tabindex="-1"><img src="/m.jpg" alt=""></a><a href="/product/blue-mug">Blue mug</a></div>
<nav><a href="/collections/apparel"><img src="/a.jpg" alt=""></a><a href="/collections/apparel" title="Apparel"></a></nav>
<footer><a href="https://social.example/acme"><img src="/x.svg" alt=""></a><a href="/contact"></a></footer>`);
  const stat = statFor(result, 'links.anchor.empty');
  assert.equal(stat.applicable, 6);
  assert.deepEqual(findingsFor(result, 'links.anchor.empty').map((finding) => finding.selector).sort(),
    ['a[href="/contact"]', 'a[href="https://social.example/acme"]']);
});

test('an aria-hidden copy does not name a link, so an unnamed link beside it still fails', () => {
  const result = run('<a href="/team" aria-hidden="true">Team</a><a href="/team"><img src="/t.jpg" alt=""></a>');
  assert.equal(statFor(result, 'links.anchor.empty').failed, 1);
});

test('generic text beside a descriptive link to the same page, or with a descriptive aria-label, passes; generic text alone fails', () => {
  const result = run(`
<article><h3><a href="/blog/winter-menu">Our winter menu is here</a></h3><p>Soups and stews.</p><a href="/blog/winter-menu">Read more</a></article>
<div class="course"><a href="/academy/basics" aria-label="Learn more about the basics course">Learn more</a></div>
<p><a href="#comments">More</a></p>
<div><a href="/about">Click here</a><a href="/careers" aria-label="Read more">Read more</a></div>`);
  const stat = statFor(result, 'links.anchor.generic');
  assert.equal(stat.applicable, 5, 'the fragment link is left out');
  assert.deepEqual(findingsFor(result, 'links.anchor.generic').map((finding) => finding.selector).sort(), ['a[href="/about"]', 'a[href="/careers"]']);
});

test('a link into the page itself does not name the page for another link to it (review of 2026-11-12)', () => {
  // A skip link (#main) on the home page does not give the home page's empty logo link a name,
  // and a descriptive #nav link does not describe a generic link to the home page.
  const url = `${SITE}/`;
  const home = (/** @type {string} */ body) => extractHtml(`<html><head><title>Home</title></head><body>${body}</body></html>`, {
    responseUrl: url, siteHost: new URL(SITE).host, includeSubdomains: false,
  }).links;
  const empty = audit([makePage({ url, links: home('<a href="#main">Skip to content</a><a href="/"><svg width="10" height="10"></svg></a>') })]).result;
  assert.equal(statFor(empty, 'links.anchor.empty').failed, 1);
  const generic = audit([makePage({ url, links: home('<a href="/">Click here</a><a href="#nav">Home page of Example</a>') })]).result;
  assert.equal(statFor(generic, 'links.anchor.generic').failed, 1);
});
