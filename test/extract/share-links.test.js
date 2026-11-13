// A share link is left out of the hidden-link check only when it is a share
// service's own share endpoint and the address it shares is on the site. Any
// other page of the same service (a channel, a profile, a chat with a phone
// number) counts like any link, whatever its query holds: an injected link can
// name the site in its query as easily as a share button does (security
// reviews of 2026-11-12).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractPage } from '../../plugin/server/src/extract/page.js';
import { SHARE_ENDPOINTS, SHARE_SERVICES, isShareLink } from '../../plugin/server/src/extract/share-links.js';
import { siteIdentity } from '../../plugin/server/src/util/site-identity.js';
import { makeFetch, makeInput } from './fetch-result.js';

/** @import { PageSecurity } from '../../plugin/server/src/types.js' */

const PAGE = encodeURIComponent('https://example.test/page');
/** A share link of each endpoint, in the form its share button writes, for the page https://example.test/page. */
const SHARES = [
  `https://www.facebook.com/dialog/share?app_id=1&href=${PAGE}`,
  `https://www.facebook.com/dialog/feed?app_id=1&link=${PAGE}`,
  `https://www.facebook.com/sharer/sharer.php?u=${PAGE}&t=Read`,
  `https://m.facebook.com/sharer.php?u=${PAGE}`,
  `https://twitter.com/intent/tweet?url=${PAGE}&text=Read`,
  `https://x.com/intent/post?url=${PAGE}`,
  `https://twitter.com/share?text=Read&url=${PAGE}&via=acme`,
  `https://twitter.com/intent/tweet?text=${encodeURIComponent('Read https://example.test/page.')}`,
  `https://www.linkedin.com/sharing/share-offsite/?url=${PAGE}`,
  `https://www.linkedin.com/shareArticle?mini=true&url=${PAGE}&title=Read`,
  `https://www.linkedin.com/cws/share?url=${PAGE}`,
  `https://www.pinterest.com/pin/create/button/?url=${PAGE}&media=x`,
  `https://wa.me/?text=Read%20this%20${PAGE}`,
  `https://api.whatsapp.com/send?text=${PAGE}`,
  `https://web.whatsapp.com/send?text=${PAGE}`,
  `https://t.me/share/url?url=${PAGE}&text=Read`,
  `https://telegram.me/share/url?url=${PAGE}`,
  `https://www.tumblr.com/widgets/share/tool?canonicalUrl=${PAGE}`,
  `https://vk.com/share.php?url=${PAGE}`,
  `https://www.reddit.com/submit?url=${PAGE}&title=Read`,
  `https://mastodonshare.com/?text=Read&url=${PAGE}`,
  // Older forms that share-button code still writes.
  `https://www.facebook.com/share.php?u=${PAGE}`,
  `https://mobile.twitter.com/intent/tweet?url=${PAGE}`,
  `https://twitter.com/home?status=${encodeURIComponent('Read https://example.test/page')}`,
  `https://www.tumblr.com/share/link?url=${PAGE}`,
];

/**
 * @param {string[]} hrefs  Links inside a share menu that the page hides.
 * @param {{siteHost?: string, url?: string, deployedOrigin?: string}} [options]
 */
function hiddenHosts(hrefs, options = {}) {
  const html = `<body><p>Article</p><div class="share-menu" style="display:none">${hrefs.map((href) => `<a href="${href.replace(/&/g, '&amp;')}">Share</a>`).join('')}</div></body>`;
  const input = { ...makeInput(makeFetch({ html, ...(options.url ? { url: options.url } : {}) }), { siteHost: options.siteHost }), deployedOrigin: options.deployedOrigin };
  return /** @type {PageSecurity} */ (extractPage(input).security).hidden_links.map((link) => link.host).sort();
}

const SITE = siteIdentity({ siteHost: 'example.test' });

test('a hidden share menu of every endpoint, sharing a page of the site, is not a hidden link to another site', () => {
  const hosts = new Set(SHARES.map((href) => new URL(href).host.replace(/^www\./, '')));
  assert.deepEqual([...hosts].sort(), [...SHARE_SERVICES].sort(), 'every service has a case here');
  for (const endpoint of SHARE_ENDPOINTS) {
    assert.ok(SHARES.some((href) => isShareLink(href, SITE) && endpoint.hosts.includes(new URL(href).host.replace(/^www\./, ''))), endpoint.paths[0]);
  }
  for (const href of SHARES) assert.equal(isShareLink(href, SITE), true, href);
  assert.deepEqual(hiddenHosts(SHARES), []);
});

test('another page of a share service is a hidden link like any other, whatever its query names (security review F1)', () => {
  // Each case was let through by the host-only rule of 0.1.0.
  const bypasses = [
    'https://t.me/casino_bonus_scam?ref=example.test',
    'https://t.me/casino_bonus_scam?url=https%3A%2F%2Fexample.test%2F',
    'https://wa.me/905551112233?text=https%3A%2F%2Fexample.test%2F',
    'https://api.whatsapp.com/send?phone=905551112233&text=https%3A%2F%2Fexample.test%2F',
    'https://www.facebook.com/cheap.pills.pharmacy?ref=example.test',
    'https://www.facebook.com/cheap.pills.pharmacy?u=https%3A%2F%2Fexample.test%2F',
    'https://www.reddit.com/r/buyviagra?utm=example.test',
    'https://www.reddit.com/r/buyviagra/submit?url=https%3A%2F%2Fexample.test%2F',
    'https://vk.com/club123456?from=example.test',
    'https://twitter.com/spam_account?url=https%3A%2F%2Fexample.test%2F',
    'https://www.linkedin.com/company/pills?url=https%3A%2F%2Fexample.test%2F',
  ];
  for (const href of bypasses) assert.equal(isShareLink(href, SITE), false, href);
  assert.deepEqual(hiddenHosts(bypasses), ['api.whatsapp.com', 'facebook.com', 'linkedin.com', 'reddit.com', 't.me', 'twitter.com', 'vk.com', 'wa.me']);
});

test('a share endpoint counts only when every address it carries is on the site', () => {
  const cases = {
    'another site': `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://other.test/')}`,
    'no address': 'https://twitter.com/intent/tweet?text=Hello',
    'the site\'s name, not an address': 'https://vk.com/share.php?url=example.test',
    'a name that only starts like the site\'s': `https://wa.me/?text=${encodeURIComponent('https://example.test.evil/')}`,
    'the site and another address in the text': `https://twitter.com/intent/tweet?url=${PAGE}&text=${encodeURIComponent('Buy at https://pills.test/')}`,
    'the address in another parameter': `https://www.facebook.com/sharer/sharer.php?ref=${PAGE}`,
    'a subdomain of the service': `https://pills.tumblr.com/widgets/share/tool?canonicalUrl=${PAGE}`,
    'a port': `https://vk.com:8443/share.php?url=${PAGE}`,
    'a broken escape': 'https://vk.com/share.php?url=%E0%A4%A',
    'not an http address': 'https://vk.com/share.php?url=javascript:alert(1)',
    // Review of 2026-11-12: every value of a repeated parameter, one address per parameter, and hosts written with www.
    'a repeated parameter with another site last': `https://www.facebook.com/sharer/sharer.php?u=${PAGE}&u=https%3A%2F%2Fspam.test%2F`,
    'two addresses in one parameter': `https://twitter.com/intent/tweet?url=${PAGE}%20https%3A%2F%2Fspam.test%2F`,
    'another host written with www. in the text': `https://wa.me/?text=${encodeURIComponent('https://example.test/page buy at www.spam.test')}`,
  };
  for (const [name, href] of Object.entries(cases)) assert.equal(isShareLink(href, SITE), false, name);
  assert.equal(isShareLink('not a url', SITE), false);
});

test('the shared address is the site with or without www., on any port or scheme, or with a trailing dot', () => {
  for (const page of ['https://www.example.test/a', 'http://example.test:8080/a', 'https://example.test./a']) {
    assert.equal(isShareLink(`https://vk.com/share.php?url=${encodeURIComponent(page)}`, SITE), true, page);
  }
  assert.equal(isShareLink(`https://vk.com/share.php?url=${encodeURIComponent('https://blog.example.test/a')}`, SITE), false, 'a subdomain is not the page\'s site');
  const withSubdomains = siteIdentity({ siteHost: 'example.test', includeSubdomains: true });
  assert.equal(isShareLink(`https://vk.com/share.php?url=${encodeURIComponent('https://blog.example.test/a')}`, withSubdomains), true, 'unless the crawl includes subdomains');
});

test('in a crawl of a local server, a share link of the deployed address is the site\'s (code review A4)', () => {
  const local = { siteHost: 'localhost:3000', url: 'http://localhost:3000/post' };
  const share = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent('https://www.acme.example/post')}`;
  assert.deepEqual(hiddenHosts([share], local), ['facebook.com'], 'without the deployed address the share is of another site');
  assert.deepEqual(hiddenHosts([share], { ...local, deployedOrigin: 'https://www.acme.example' }), []);
  assert.deepEqual(hiddenHosts(['https://t.me/casino?ref=acme.example'], { ...local, deployedOrigin: 'https://www.acme.example' }), ['t.me']);
});
