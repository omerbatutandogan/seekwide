import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { extractPage } from '../../plugin/server/src/extract/page.js';
import { anchorLine, htmlAnchors, sameDocument, sourceLine } from '../../plugin/server/src/repo/html-lines.js';
import { isHtmlFile, matchHtmlFile } from '../../plugin/server/src/repo/html-routes.js';

const FILES = new Set(['index.html', 'about.html', 'contact/index.html', 'old.htm', 'docs/index.htm', 'robots.txt', 'notes', 'a b.html', 'blog/post.html']);
/** @param {string} pathname */
const file = (pathname) => matchHtmlFile(FILES, pathname);

describe('matchHtmlFile', () => {
  it('answers / with index.html', () => {
    assert.equal(file('/'), 'index.html');
    assert.equal(matchHtmlFile(new Set(['index.htm']), '/'), 'index.htm');
    assert.equal(matchHtmlFile(new Set(['about.html']), '/'), null);
  });

  it('answers a path with the file itself, then .html, then the folder index', () => {
    assert.equal(file('/about.html'), 'about.html');
    assert.equal(file('/about'), 'about.html');
    assert.equal(file('/old'), 'old.htm');
    assert.equal(file('/contact'), 'contact/index.html');
    assert.equal(file('/contact/'), 'contact/index.html');
    assert.equal(file('/docs/'), 'docs/index.htm');
    assert.equal(file('/blog/post'), 'blog/post.html');
    assert.equal(file('/robots.txt'), 'robots.txt');
    assert.equal(file('/notes'), 'notes');
  });

  it('answers nothing for a path without a file', () => {
    assert.equal(file('/missing'), null);
    assert.equal(file('/about/team'), null);
    assert.equal(file('/blog/'), null);
    assert.equal(file('/About.html'), null);
  });

  it('decodes the path', () => {
    assert.equal(file('/a%20b.html'), 'a b.html');
    assert.equal(file('/a%20b'), 'a b.html');
    assert.equal(file('/%'), null);
  });

  it('cannot name a file outside the project', () => {
    const outside = new Set(['index.html', '../secret.html', '/etc/passwd']);
    for (const pathname of ['/../secret.html', '/%2e%2e/secret.html', '/..%2fsecret.html', '/x/..%5csecret.html', '/%2Fetc%2Fpasswd', '/./index.html', '/a%00b']) {
      assert.equal(matchHtmlFile(outside, pathname), null, pathname);
    }
  });

  it('knows an HTML file by its extension', () => {
    assert.deepEqual(['a.html', 'a.HTM', 'a.htm', 'robots.txt', 'html', 'a.html.bak'].map(isHtmlFile), [true, true, true, false, false, false]);
  });
});

const SOURCE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>One</title>
<meta name="description" content="d">
<meta name="robots" content="noindex">
<link rel="canonical" href="/one">
</head>
<body>
<h1>One</h1>
<p><a href="/two">Two</a> <a href="/three">Three</a></p>
<img src="/a.png" alt="">
<h2>More</h2>
<script type="application/ld+json">{"@type":"Thing"}</script>
</body>
</html>
`;

/** @param {string} html @param {Record<string, string>} [headers] */
function record(html, headers = {}) {
  const body = Buffer.from(html);
  return extractPage({
    url: 'http://127.0.0.1:4173/one',
    result: {
      url: 'http://127.0.0.1:4173/one', finalUrl: 'http://127.0.0.1:4173/one', status: 200,
      headers: { 'content-type': 'text/html', ...headers }, headerLines: Object.fromEntries(Object.entries({ 'content-type': 'text/html', ...headers }).map(([k, v]) => [k, [v]])),
      redirectChain: [], body, truncated: false, bytes: body.length, elapsedMs: 0, error: null,
    },
    depth: 0, discoveredVia: ['start'], siteHost: '127.0.0.1:4173',
  });
}

describe('htmlAnchors', () => {
  it('finds the lines of html, head, title and the description and robots meta tags', () => {
    assert.deepEqual(htmlAnchors(SOURCE), { html: 2, head: 3, title: 5, metaDescription: 6, metaRobots: 7 });
  });

  it('gives no line for an element the file does not have', () => {
    assert.deepEqual(htmlAnchors('<p>just text</p>'), { html: null, head: null, title: null, metaDescription: null, metaRobots: null });
    assert.deepEqual(htmlAnchors('<html>\n<head>\n</head></html>'), { html: 1, head: 2, title: null, metaDescription: null, metaRobots: null });
  });

  it('takes the first of several, ignores an SVG title, and reads googlebot as robots', () => {
    const anchors = htmlAnchors('<svg><title>icon</title></svg>\n<title>a</title>\n<title>b</title>\n<meta name="GoogleBot" content="noindex">\n<meta name=" Description " content="x">\n<meta name="description" content="y">');
    assert.deepEqual([anchors.title, anchors.metaRobots, anchors.metaDescription], [2, 4, 5]);
  });

  it('survives very deep nesting', () => {
    assert.equal(htmlAnchors(`${'<div>'.repeat(20_000)}<title>deep</title>`).title, 1);
  });
});

describe('anchorLine', () => {
  const anchors = { html: 2, head: 3, title: 5, metaDescription: 6, metaRobots: 7 };
  const bare = { html: 2, head: 3, title: null, metaDescription: null, metaRobots: null };

  it('points at the element a check is about', () => {
    assert.equal(anchorLine('seo.title.duplicate', anchors), 5);
    assert.equal(anchorLine('seo.meta_description.too_long', anchors), 6);
    assert.equal(anchorLine('seo.indexing.noindex_in_sitemap', anchors), 7);
    assert.equal(anchorLine('seo.html.lang_missing', anchors), 2);
  });

  it('points at the head when the element is missing, because it belongs there', () => {
    assert.equal(anchorLine('seo.title.missing', bare), 3);
    assert.equal(anchorLine('seo.meta_description.missing', bare), 3);
    assert.equal(anchorLine('seo.canonical.missing', bare), 3);
    assert.equal(anchorLine('seo.mobile.viewport_missing', bare), 3);
    assert.equal(anchorLine('seo.social.og_incomplete', bare), 3);
  });

  it('gives no line when there is no one place', () => {
    assert.equal(anchorLine('seo.h1.missing', anchors), null);
    assert.equal(anchorLine('seo.content.thin', anchors), null);
    assert.equal(anchorLine('seo.indexing.homepage_noindex', bare), null);
    assert.equal(anchorLine('links.depth.deep', anchors), null);
  });
});

describe('sameDocument', () => {
  const source = record(SOURCE);

  it('accepts the file itself, and the file with an invisible script added by the server', () => {
    assert.equal(sameDocument(record(SOURCE), source), true);
    assert.equal(sameDocument(record(SOURCE.replace('<head>', '<head>\n<script src="/livereload.js"></script>')), source), true);
    assert.equal(sameDocument(record(SOURCE.replace('</body>', '<!-- injected -->\n<script>ws()</script>\n</body>')), source), true);
  });

  it('accepts a canonical the server adds as a header, which no file can hold', () => {
    assert.equal(sameDocument(record(SOURCE, { link: '<http://127.0.0.1:4173/one>; rel="canonical"' }), source), true);
  });

  it('refuses a page with another title, other text, or another number of elements', () => {
    assert.equal(sameDocument(record(SOURCE.replace('<title>One</title>', '<title>Changed</title>')), source), false);
    assert.equal(sameDocument(record(SOURCE.replace('<title>One</title>', '')), source), false);
    assert.equal(sameDocument(record(SOURCE.replace('<h2>More</h2>', '<h2>Less</h2>')), source), false);
    assert.equal(sameDocument(record(SOURCE.replace('</body>', '<a href="/x"></a></body>')), source), false);
    assert.equal(sameDocument(record(SOURCE.replace('</body>', '<img src="/b.png" alt=""></body>')), source), false);
    assert.equal(sameDocument(record(SOURCE.replace('<link rel="canonical" href="/one">', '')), source), false);
    assert.equal(sameDocument(record(SOURCE.replace(/<script type="application.*<\/script>/, '')), source), false);
  });

  it('refuses a response that is not a 200 HTML page', () => {
    assert.equal(sameDocument({ ...record(SOURCE), status: 404 }, source), false);
    assert.equal(sameDocument({ ...record(SOURCE), is_html: false }, source), false);
    assert.equal(sameDocument(record(SOURCE), { ...source, is_html: false }), false);
  });
});

describe('sourceLine', () => {
  const source = record(SOURCE);

  it('is the same line when the server sends the file as it is', () => {
    const served = record(SOURCE);
    assert.deepEqual([8, 11, 12, 13, 14, 15].map((line) => sourceLine(line, served, source)), [8, 11, 12, 13, 14, 15]);
  });

  it('finds the line in the file when the server added lines above the element', () => {
    const served = record(SOURCE.replace('<head>', '<head>\n<script src="/livereload.js">\n</script>'));
    assert.deepEqual([10, 13, 14, 15, 16, 17].map((line) => sourceLine(line, served, source)), [8, 11, 12, 13, 14, 15]);
    assert.equal(sourceLine(8, served, source), null);
  });

  it('gives no line where no recorded element starts', () => {
    assert.equal(sourceLine(1, record(SOURCE), source), null);
    assert.equal(sourceLine(999, record(SOURCE), source), null);
  });

  it('gives no line when the elements on a served line come from different lines of the file', () => {
    const served = record(SOURCE.replace(/\n/g, ' '));
    assert.equal(sameDocument(served, source), true);
    assert.equal(sourceLine(1, served, source), null);
  });

  it('skips header canonicals when it counts positions', () => {
    const served = record(SOURCE, { link: '<http://127.0.0.1:4173/one>; rel="canonical"' });
    assert.equal(sourceLine(8, served, source), 8);
  });
});
