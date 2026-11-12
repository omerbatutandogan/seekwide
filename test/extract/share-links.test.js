// A share link is left out of the hidden-link check only when it goes to a
// known share or messaging service and carries the site's address. Any other
// link counts whatever its query holds: an injected link can name the site in
// its query as easily as a share button does (review of 2026-11-12).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractPage } from '../../server/src/extract/page.js';
import { SHARE_SERVICES, isShareLink } from '../../server/src/extract/share-links.js';
import { makeFetch, makeInput } from './fetch-result.js';

/** @import { PageSecurity } from '../../server/src/types.js' */

const PAGE = encodeURIComponent('https://example.test/page');
/** A share link of each listed service, in the form its share button writes, for the page https://example.test/page. */
const SHARES = {
  'facebook.com': `https://www.facebook.com/sharer/sharer.php?u=${PAGE}`,
  'm.facebook.com': `https://m.facebook.com/sharer.php?u=${PAGE}`,
  'twitter.com': `https://twitter.com/intent/tweet?url=${PAGE}&text=Read`,
  'x.com': `https://x.com/intent/post?url=${PAGE}`,
  'linkedin.com': `https://www.linkedin.com/sharing/share-offsite/?url=${PAGE}`,
  'pinterest.com': `https://www.pinterest.com/pin/create/button/?url=${PAGE}`,
  'wa.me': `https://wa.me/?text=Read%20this%20${PAGE}`,
  'api.whatsapp.com': `https://api.whatsapp.com/send?text=${PAGE}`,
  'web.whatsapp.com': `https://web.whatsapp.com/send?text=${PAGE}`,
  't.me': `https://t.me/share/url?url=${PAGE}&text=Read`,
  'telegram.me': `https://telegram.me/share/url?url=${PAGE}`,
  'tumblr.com': `https://www.tumblr.com/widgets/share/tool?canonicalUrl=${PAGE}`,
  'vk.com': `https://vk.com/share.php?url=${PAGE}`,
  'reddit.com': `https://www.reddit.com/submit?url=${PAGE}&title=Read`,
  'mastodonshare.com': `https://mastodonshare.com/?text=Read&url=${PAGE}`,
};

/** @param {string[]} hrefs  Links inside a share menu that the page hides. */
function hiddenHosts(hrefs) {
  const html = `<body><p>Article</p><div class="share-menu" style="display:none">${hrefs.map((href) => `<a href="${href}">Share</a>`).join('')}</div></body>`;
  return /** @type {PageSecurity} */ (extractPage(makeInput(makeFetch({ html }))).security).hidden_links.map((link) => link.host).sort();
}

test('a hidden share menu of every listed service, with the site\'s address, is not a hidden link to another site', () => {
  assert.deepEqual(Object.keys(SHARES).sort(), [...SHARE_SERVICES].sort(), 'every listed service has a case here');
  for (const [service, href] of Object.entries(SHARES)) assert.deepEqual(hiddenHosts([href]), [], service);
  assert.deepEqual(hiddenHosts(Object.values(SHARES)), []);
});

test('a link to any other host is never a share link, whatever its query names', () => {
  assert.deepEqual(hiddenHosts(['https://spam.test/x?ref=example.test']), ['spam.test']);
  assert.deepEqual(hiddenHosts([`https://spam.test/x?u=${PAGE}`, 'https://pills.test/?u=https://example.test/']), ['pills.test', 'spam.test']);
  assert.deepEqual(hiddenHosts([`https://pills.tumblr.com/?u=${PAGE}`]), ['pills.tumblr.com'], 'a blog on tumblr.com is not Tumblr\'s share page');
});

test('a listed service without the site\'s address in the link is a hidden link like any other', () => {
  assert.deepEqual(hiddenHosts(['https://www.facebook.com/sharer/sharer.php?u=https%3A%2F%2Fother.test%2F']), ['facebook.com']);
  assert.deepEqual(hiddenHosts(['https://twitter.com/intent/tweet?text=Hello', 'https://t.me/casino_bonus']), ['t.me', 'twitter.com']);
  assert.deepEqual(hiddenHosts([`https://wa.me/?text=${encodeURIComponent('https://notexample.test/')}`]), ['wa.me'], 'only the site\'s whole name counts');
});

test('isShareLink compares the site by its whole name, with or without www., and ignores a port', () => {
  assert.equal(isShareLink('https://vk.com/share.php?url=https://www.example.test/a', 'vk.com', 'example.test'), true);
  assert.equal(isShareLink('https://vk.com/share.php?url=https://example.test.evil/a', 'vk.com', 'example.test'), false);
  assert.equal(isShareLink('https://vk.com/share.php', 'vk.com', 'example.test'), false);
  assert.equal(isShareLink('https://vk.com:8443/share.php?url=https://example.test/', 'vk.com:8443', 'example.test'), true);
  assert.equal(isShareLink('https://vk.com/share.php?url=%E0%A4%A', 'vk.com', 'example.test'), false, 'a broken escape is read as it is');
});
