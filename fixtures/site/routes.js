// A small website with known problems, for the integration tests. It is served
// by test/helpers/http-server.js, which replaces "{origin}" with the server's
// own origin.
//
// Every page exists to trigger one or more checks, or to prove that a check
// stays quiet. test/integration/audit.test.js lists what is expected, so when
// you change a page here, change the expectation there in the same commit.

/**
 * About 110 words of body text that differ from page to page, so that pages do
 * not count as duplicates or as thin content unless a test wants them to.
 * @param {string} topic
 */
function paragraph(topic) {
  return [
    `This page is about ${topic}.`,
    `It explains what ${topic} means for visitors of the fixture site and why the topic has a page of its own.`,
    'The text is long enough to count as real content, so the page is not reported as thin by accident.',
    `Readers who came for ${topic} find a short introduction first, then the details, and finally a pointer to related pages.`,
    'Nothing here is meant to be read by people; the words only give the crawler something to count and to hash.',
    `If two pages share this paragraph word for word, the audit calls them duplicates, which is why ${topic} appears in several places.`,
    'A handful of extra sentences follow to push the count over one hundred words.',
    'The site has a home page, a blog, two products and a few pages that are broken on purpose.',
  ].join(' ');
}

/**
 * @param {{title?: string|null, description?: string|null, canonical?: string|null, h1?: string|null,
 *          body?: string, head?: string, lang?: string|null, viewport?: boolean, afterBody?: string}} options
 */
function page({ title, description, canonical, h1, body = '', head = '', lang = 'en', viewport = true, afterBody = '' }) {
  const parts = ['<!doctype html>', lang ? `<html lang="${lang}">` : '<html>', '<head>', '<meta charset="utf-8">'];
  if (viewport) parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  if (title !== null && title !== undefined) parts.push(`<title>${title}</title>`);
  if (description) parts.push(`<meta name="description" content="${description}">`);
  if (canonical) parts.push(`<link rel="canonical" href="${canonical}">`);
  if (head) parts.push(head);
  parts.push('</head>', '<body>');
  if (h1) parts.push(`<h1>${h1}</h1>`);
  parts.push(body, afterBody, '</body>', '</html>');
  return parts.join('\n');
}

const SHARED_ARTICLE = `<p>${paragraph('a shared article')}</p>\n<p><a href="/blog/">Back to the blog</a></p>`;

/** @type {Record<string, import('../../test/helpers/http-server.js').RouteHandler>} */
export const siteRoutes = {
  '/robots.txt': {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
    body: 'User-agent: *\nDisallow: /private/\n\nSitemap: {origin}/sitemap.xml\n',
  },

  '/sitemap.xml': {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
    body: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...['/', '/about', '/contact', '/blog/', '/blog/post-1', '/noindex-page', '/old-page', '/orphan', '/gone', '/canonical-away'].map(
        (path) => `  <url><loc>{origin}${path}</loc></url>`,
      ),
      '</urlset>',
    ].join('\n'),
  },

  // Clean for SEO. Carries the link problems.
  '/': {
    body: page({
      title: 'Fixture home: a small site for audit tests',
      description: 'The home page of the fixture site that the audit tests crawl.',
      canonical: '{origin}/',
      h1: 'Fixture home',
      body: [
        `<p>${paragraph('the home page')}</p>`,
        '<nav>',
        '<a href="/about">About the company</a>',
        '<a href="/contact"><img src="/img/icon.png"></a>',
        '<a href="/blog/">Read more</a>',
        '<a href="/products/widget">The widget</a>',
        '<a href="/old-page">An old address</a>',
        '<a href="/missing">A page that does not exist</a>',
        '<a href="/private/secret">A private page</a>',
        '<a href="/files/guide.pdf">Download the guide</a>',
        // A script that opens a page: uncrawlable. The menu toggle after it opens no page and is not counted.
        '<a href="javascript:goTo(\'catalog\')">The catalog</a>',
        '<a href="javascript:void(0)">Open the menu</a>',
        '</nav>',
      ].join('\n'),
    }),
  },

  // No meta description, no canonical, two h1 elements, same title as /contact.
  '/about': {
    body: page({
      title: 'Company information',
      description: null,
      canonical: null,
      h1: 'About us',
      body: [
        '<h1>Our story</h1>',
        `<p>${paragraph('the company')}</p>`,
        '<a href="/">Home page</a>',
        '<a href="/noindex-page">A hidden page</a>',
        '<a href="/chain-1">A link through two redirects</a>',
        '<a href="/x-robots">A page hidden by a header</a>',
        '<a href="/nofollow-target" rel="nofollow">A link we do not vouch for</a>',
      ].join('\n'),
    }),
  },

  // Same title as /about.
  '/contact': {
    body: page({
      title: 'Company information',
      description: 'How to reach the fixture company by post, phone and email.',
      canonical: '{origin}/contact',
      h1: 'Contact',
      body: [
        `<p>${paragraph('contact details')}</p>`,
        '<a href="/">Home page</a>',
        '<a href="/server-error">A page that fails</a>',
        '<a href="/broken-canonical">Broken canonical example</a>',
        '<a href="/multi-canonical">Two canonicals example</a>',
        '<a href="/relative-canonical">Relative canonical example</a>',
      ].join('\n'),
    }),
  },

  '/blog/': {
    body: page({
      title: 'Blog: news from the fixture site',
      description: 'Every article published on the fixture site, newest first.',
      canonical: '{origin}/blog/',
      h1: 'Blog',
      body: [
        `<p>${paragraph('the blog')}</p>`,
        '<a href="/">Home page</a>',
        '<a href="/blog/post-1">First article</a>',
        '<a href="/blog/post-2">Second article</a>',
        '<a href="/blog/post-3">Third article</a>',
        '<a href="/blog/post-4">Fourth article</a>',
        '<a href="/canonical-away">An article that points elsewhere</a>',
      ].join('\n'),
    }),
  },

  // Empty title.
  '/blog/post-1': {
    body: page({
      title: '',
      description: 'The first article on the fixture blog, which has an empty title.',
      canonical: '{origin}/blog/post-1',
      h1: 'First article',
      body: `<p>${paragraph('the first article')}</p>\n<a href="/blog/">Back to the blog</a>`,
    }),
  },

  // Two titles, no h1, no viewport, no lang.
  '/blog/post-2': {
    body: page({
      title: 'Second article on the fixture blog',
      description: 'The second article on the fixture blog, which has two titles.',
      canonical: '{origin}/blog/post-2',
      h1: null,
      lang: null,
      viewport: false,
      head: '<title>Second article, second title</title>',
      body: `<p>${paragraph('the second article')}</p>\n<a href="/blog/">Back to the blog</a>`,
    }),
  },

  // post-3 and post-4 have the same visible text.
  '/blog/post-3': {
    body: page({
      title: 'Third article on the fixture blog',
      description: 'The third article on the fixture blog, a copy of the fourth.',
      canonical: '{origin}/blog/post-3',
      h1: 'A shared article',
      body: SHARED_ARTICLE,
    }),
  },
  '/blog/post-4': {
    body: page({
      title: 'Fourth article on the fixture blog',
      description: 'The fourth article on the fixture blog, a copy of the third.',
      canonical: '{origin}/blog/post-4',
      h1: 'A shared article',
      body: SHARED_ARTICLE,
    }),
  },

  // Canonical points to the gadget, and the JSON-LD block is not valid JSON.
  '/products/widget': {
    body: page({
      title: 'Widget: the smaller product',
      description: 'The widget is the smaller of the two fixture products.',
      canonical: '{origin}/products/gadget',
      h1: 'Widget',
      head: '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "Product", "name": "Widget",}</script>',
      body: `<p>${paragraph('the widget')}</p>\n<a href="/products/gadget">See the gadget</a>`,
    }),
  },

  // Its only canonical is in the body, where search engines ignore it.
  '/products/gadget': {
    body: page({
      title: 'Gadget: the larger product',
      description: 'The gadget is the larger of the two fixture products.',
      canonical: null,
      h1: 'Gadget',
      body: `<link rel="canonical" href="{origin}/products/gadget">\n<p>${paragraph('the gadget')}</p>\n<a href="/">Home page</a>`,
    }),
  },

  // noindex, and listed in the sitemap.
  '/noindex-page': {
    body: page({
      title: 'A page that asks not to be indexed',
      description: 'This page carries a noindex robots tag and is still in the sitemap.',
      canonical: '{origin}/noindex-page',
      h1: 'Hidden page',
      head: '<meta name="robots" content="noindex, follow">',
      body: `<p>${paragraph('a hidden page')}</p>\n<a href="/">Home page</a>`,
    }),
  },

  // noindex through a header, not in the sitemap: legitimate, so no finding.
  '/x-robots': {
    headers: { 'x-robots-tag': 'noindex' },
    body: page({
      title: 'A page hidden through a response header',
      description: 'This page is kept out of the index with an X-Robots-Tag header.',
      canonical: '{origin}/x-robots',
      h1: 'Hidden by header',
      body: `<p>${paragraph('a header-hidden page')}</p>\n<a href="/">Home page</a>`,
    }),
  },

  '/old-page': { status: 301, redirect: '{origin}/new-page' },
  '/chain-1': { status: 301, redirect: '{origin}/chain-2' },
  '/chain-2': { status: 302, redirect: '{origin}/new-page' },

  // Clean.
  '/new-page': {
    body: page({
      title: 'The new address of the old page',
      description: 'The page that the old address and the redirect chain lead to.',
      canonical: '{origin}/new-page',
      h1: 'New page',
      body: `<p>${paragraph('the new page')}</p>\n<a href="/">Home page</a>`,
    }),
  },

  // Clean, in the sitemap, and linked from nowhere.
  '/orphan': {
    body: page({
      title: 'A page nobody links to',
      description: 'This page is listed in the sitemap, and no other page links to it.',
      canonical: '{origin}/orphan',
      h1: 'Orphan page',
      body: `<p>${paragraph('an orphan page')}</p>\n<a href="/">Home page</a>`,
    }),
  },

  // Clean.
  '/nofollow-target': {
    body: page({
      title: 'The target of a nofollow link',
      description: 'A normal page that one internal link points to with rel nofollow.',
      canonical: '{origin}/nofollow-target',
      h1: 'Nofollow target',
      body: `<p>${paragraph('a nofollow target')}</p>\n<a href="/">Home page</a>`,
    }),
  },

  '/server-error': {
    status: 500,
    body: '<!doctype html><html lang="en"><head><title>Server error</title></head><body><h1>Something went wrong</h1></body></html>',
  },

  // Disallowed by robots.txt. The crawler must never request it.
  '/private/secret': {
    body: page({
      title: 'A private page',
      description: 'Robots.txt asks crawlers to stay away from this page.',
      canonical: '{origin}/private/secret',
      h1: 'Private',
      body: `<p>${paragraph('a private page')}</p>`,
    }),
  },

  // Canonical points to /about, and the page is in the sitemap.
  '/canonical-away': {
    body: page({
      title: 'An article whose canonical points elsewhere',
      description: 'This page names the about page as its canonical and is still in the sitemap.',
      canonical: '{origin}/about',
      h1: 'Canonical elsewhere',
      body: `<p>${paragraph('a canonicalized page')}</p>\n<a href="/">Home page</a>`,
    }),
  },

  // Canonical points to a page that answers 404.
  '/broken-canonical': {
    body: page({
      title: 'A page whose canonical is broken',
      description: 'This page names a missing page as its canonical.',
      canonical: '{origin}/missing',
      h1: 'Broken canonical',
      body: `<p>${paragraph('a broken canonical')}</p>\n<a href="/">Home page</a>`,
    }),
  },

  // Two canonicals in the head that disagree.
  '/multi-canonical': {
    body: page({
      title: 'A page with two canonicals',
      description: 'This page declares two different canonical addresses in its head.',
      canonical: '{origin}/multi-canonical',
      h1: 'Two canonicals',
      head: '<link rel="canonical" href="{origin}/about">',
      body: `<p>${paragraph('two canonicals')}</p>\n<a href="/">Home page</a>`,
    }),
  },

  // Canonical is a relative address.
  '/relative-canonical': {
    body: page({
      title: 'A page with a relative canonical',
      description: 'This page writes its canonical as a path instead of a full address.',
      canonical: '/relative-canonical',
      h1: 'Relative canonical',
      body: `<p>${paragraph('a relative canonical')}</p>\n<a href="/">Home page</a>`,
    }),
  },
};
