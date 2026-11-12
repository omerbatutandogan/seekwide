// links.internal.nofollow reports only pages a page withholds (validation of
// 2026-11-12, fix 3). The links model what real sites sent: WordPress comment
// reply and cancel links (`?replytocom=…#respond`, `#respond`), Jetpack share
// buttons (`?share=…`), a store's add-to-cart, a file download, a wiki's
// special pages that robots.txt disallows, and a mobile menu that repeats the
// main menu's links with nofollow.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makeLink, makePage } from '../../helpers/factories.js';
import { audit, findingsFor, statFor } from './support.js';

const post = `${SITE}/2026/06/a-post/`;

test('action links, links to the page itself and links robots.txt disallows are not units', () => {
  const page = makePage({
    url: post,
    links: [
      makeLink({ url: `${post}?replytocom=101`, href: `${post}?replytocom=101#respond`, rel: ['nofollow'], text: 'Reply' }),
      makeLink({ url: post, href: '/2026/06/a-post/#respond', rel: ['nofollow'], text: 'Cancel reply' }),
      makeLink({ url: `${post}?share=tumblr&nb=1`, href: '?share=tumblr&nb=1', rel: ['nofollow', 'noopener'], text: 'Share' }),
      makeLink({ url: `${SITE}/cart/?add-to-cart=7`, href: '/cart/?add-to-cart=7', rel: ['nofollow'], text: 'Add to cart' }),
      makeLink({ url: `${SITE}/files/menu.pdf`, href: '/files/menu.pdf', rel: ['nofollow'], text: 'Menu (PDF)' }),
      makeLink({ url: `${SITE}/wiki/Special:Changes/A_post`, href: '/wiki/Special:Changes/A_post', rel: ['nofollow'], text: 'Related changes' }),
      makeLink({ url: `${SITE}/tags/x`, href: '/tags/x', rel: ['nofollow'], text: 'x' }),
    ],
  });
  const { result } = audit([page], { crawl: { disallowed_links: [`${SITE}/wiki/Special:Changes/A_post`], robots_blocked: [`${SITE}/tags/x`] } });
  const stat = statFor(result, 'links.internal.nofollow');
  assert.equal(stat.applicable, 0);
});

test('a nofollowed copy of a link the page also has without nofollow passes; a page linked only with nofollow fails', () => {
  // A news site's mobile menu repeats the footer's links with nofollow.
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/about`, href: '/about', rel: ['nofollow'], text: 'About', line: 3 }),
      makeLink({ url: `${SITE}/privacy`, href: '/privacy', rel: ['nofollow'], text: 'Privacy', line: 4 }),
      makeLink({ url: `${SITE}/about`, href: '/about', text: 'About us', line: 90 }),
    ],
  });
  const { result } = audit([home]);
  const stat = statFor(result, 'links.internal.nofollow');
  assert.equal(stat.applicable, 2);
  assert.deepEqual(findingsFor(result, 'links.internal.nofollow').map((finding) => finding.selector), ['a[href="/privacy"]']);
});

test('a page whose only link to /about is nofollow still fails, with or without a record of /about, in a crawl made before disallowed_links existed', () => {
  const page = makePage({ url: `${SITE}/`, links: [makeLink({ url: `${SITE}/about`, href: '/about', rel: ['nofollow'] })] });
  for (const pages of [[page], [page, makePage({ url: `${SITE}/about` })]]) {
    const { result } = audit(pages, { crawl: { disallowed_links: undefined } });
    assert.equal(statFor(result, 'links.internal.nofollow').failed, 1);
  }
});
