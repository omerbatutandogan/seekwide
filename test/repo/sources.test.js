// Findings mapped to source files, on real crawls of local test servers.

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { buildContext, runChecks } from '../../server/src/checks/engine.js';
import { allChecks } from '../../server/src/checks/registry.js';
import { attachSources, loadProjectSources } from '../../server/src/repo/sources.js';
import { RepoError } from '../../server/src/repo/scan.js';
import { HTML_FIXTURE, NEXT_FIXTURE, crawlLocal, makeTree, startServer, staticRoutes } from '../helpers/repo.js';

/** @import { CrawlResult, Finding } from '../../server/src/types.js' */

/** @type {string} */
let dataDir;
before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'seekwide-sources-'));
});
after(() => rm(dataDir, { recursive: true, force: true }));

/** @param {CrawlResult} crawl */
const audit = (crawl) => runChecks(allChecks(), buildContext(crawl, {}), { detectedAt: '2026-11-11T00:00:00.000Z' }).findings;

/**
 * Crawl what `routes` serve, run every check and map the findings to `projectDir`.
 * @param {Parameters<typeof startServer>[0]} routes
 * @param {string} projectDir
 * @param {string} [sourceDir]
 */
async function auditProject(routes, projectDir, sourceDir) {
  const server = await startServer(routes);
  try {
    const crawl = await crawlLocal(server.origin, dataDir);
    const plain = audit(crawl);
    const mapped = await attachSources(plain, crawl, await loadProjectSources(projectDir, sourceDir));
    /** The source of the finding of `checkId` on `pathname`. @param {string} checkId @param {string} pathname */
    const source = (checkId, pathname) => {
      const found = mapped.findings.filter((f) => f.check_id === checkId && f.url !== null && new URL(f.url).pathname === pathname);
      assert.equal(found.length, 1, `${checkId} on ${pathname}: ${found.length} findings`);
      return found[0].source;
    };
    return { crawl, plain, ...mapped, source };
  } finally {
    await server.close();
  }
}

describe('plain HTML: the fixture site', () => {
  /** @type {Awaited<ReturnType<typeof auditProject>>} */
  let run;
  before(async () => {
    run = await auditProject(await staticRoutes(HTML_FIXTURE), HTML_FIXTURE);
  });

  it('names the file and the line of the element for findings that have an element', () => {
    assert.deepEqual(run.source('links.internal.broken', '/services.html'), { file: 'services.html', line: 17, route: '/services.html' });
    assert.deepEqual(run.source('links.anchor.empty', '/services.html'), { file: 'services.html', line: 18, route: '/services.html' });
    assert.deepEqual(run.source('seo.canonical.outside_head', '/contact.html'), { file: 'contact.html', line: 10, route: '/contact.html' });
    assert.deepEqual(run.source('seo.h1.multiple', '/contact.html'), { file: 'contact.html', line: 15, route: '/contact.html' });
    assert.deepEqual(run.source('seo.structured_data.invalid_json', '/blog/'), { file: 'blog/index.html', line: 9, route: '/blog/' });
  });

  it('names the line of the element a finding is about when the finding itself has no line', () => {
    assert.deepEqual(run.source('seo.title.duplicate', '/contact.html'), { file: 'contact.html', line: 6, route: '/contact.html' });
    assert.deepEqual(run.source('seo.title.duplicate', '/services.html'), { file: 'services.html', line: 6, route: '/services.html' });
    assert.deepEqual(run.source('seo.html.lang_missing', '/blog/'), { file: 'blog/index.html', line: 2, route: '/blog/' });
  });

  it('names the head for an element that is missing, because that is where it belongs', () => {
    assert.deepEqual(run.source('seo.title.missing', '/about.html'), { file: 'about.html', line: 3, route: '/about.html' });
    assert.deepEqual(run.source('seo.meta_description.missing', '/about.html'), { file: 'about.html', line: 3, route: '/about.html' });
    assert.deepEqual(run.source('seo.canonical.missing', '/contact.html'), { file: 'contact.html', line: 3, route: '/contact.html' });
  });

  it('names the file without a line when no one line is the place', () => {
    assert.deepEqual(run.source('seo.content.thin', '/about.html'), { file: 'about.html', line: null, route: '/about.html' });
  });

  it('gives no source to findings about the server or the whole site', () => {
    const https = run.findings.find((f) => f.check_id === 'seo.https.site_not_https');
    const sitemap = run.findings.find((f) => f.check_id === 'seo.sitemap.missing');
    assert.ok(https && sitemap);
    assert.equal('source' in https, false);
    assert.equal('source' in sitemap, false);
  });

  it('changes nothing else: same findings, same ids, same order', () => {
    assert.deepEqual(run.findings.map((f) => f.id), run.plain.map((f) => f.id));
    assert.deepEqual(run.findings.map(({ source, ...rest }) => rest), run.plain);
    assert.equal(new Set(run.plain.map((f) => f.id)).size, run.plain.length);
  });

  it('summarizes what it did', () => {
    assert.deepEqual(run.summary, {
      framework: 'html', label: 'Plain HTML', source_dir: '.',
      findings_with_source: run.findings.filter((f) => f.source).length, pages_matched: 5, pages_total: 5,
    });
    assert.ok(run.summary.findings_with_source >= 20);
    assert.deepEqual(run.notes, []);
  });
});

describe('plain HTML: a server that is not a plain file server', () => {
  it('still finds the right lines when the server adds a script above them', async () => {
    const routes = await staticRoutes(HTML_FIXTURE, (_, body) => body.replace('<head>', '<head>\n<script src="/livereload.js">\n</script>'));
    const run = await auditProject(routes, HTML_FIXTURE);
    assert.deepEqual(run.source('links.internal.broken', '/services.html'), { file: 'services.html', line: 17, route: '/services.html' });
    assert.deepEqual(run.source('seo.h1.multiple', '/contact.html'), { file: 'contact.html', line: 15, route: '/contact.html' });
    assert.deepEqual(run.source('seo.title.duplicate', '/contact.html'), { file: 'contact.html', line: 6, route: '/contact.html' });
    assert.equal(run.findings.find((f) => f.check_id === 'links.internal.broken')?.line, 19);
  });

  it('names no source for a page whose file differs from what was served, and says so', async () => {
    const routes = await staticRoutes(HTML_FIXTURE, (file, body) => (file === 'services.html' ? body.replace('<h1>Services</h1>', '<h1>Our services</h1>') : body));
    const run = await auditProject(routes, HTML_FIXTURE);
    assert.equal(run.source('links.internal.broken', '/services.html'), undefined);
    assert.equal(run.source('seo.title.duplicate', '/services.html'), undefined);
    assert.deepEqual(run.source('seo.title.duplicate', '/contact.html'), { file: 'contact.html', line: 6, route: '/contact.html' });
    assert.equal(run.notes.length, 1);
    assert.match(run.notes[0], /^1 file differs from what the server sent for the same address, so findings on that page name no source file\./);
  });

  it('says so when no crawled page belongs to the project', async () => {
    const tree = await makeTree({ 'index.html': '<title>Another site</title>', 'other.html': '' });
    try {
      const routes = { '/': { body: '<!doctype html><html><head></head><body><h1>Hello</h1><a href="/page">x</a></body></html>' }, '/page': { body: '<!doctype html><title>Page</title><p>text</p>' } };
      const run = await auditProject(routes, tree.dir);
      assert.equal(run.summary.findings_with_source, 0);
      assert.deepEqual([run.summary.pages_matched, run.summary.pages_total], [1, 2]);
      assert.equal(run.findings.every((f) => !('source' in f)), true);
      assert.match(run.notes.join(' '), /1 file differs/);

      const none = await auditProject({ '/': { redirect: '/home' }, '/home': { body: '<!doctype html><title>Home</title><p>text</p>' } }, tree.dir);
      assert.deepEqual([none.summary.pages_matched, none.summary.pages_total], [0, 1]);
      assert.match(none.notes[0], /^No crawled page matches a file of this project, so no finding names a source file\. Check that the server at http:\/\/127\.0\.0\.1:\d+ serves the project in this folder\.$/);
    } finally {
      await tree.remove();
    }
  });

  it('does not read a page through a symbolic link, even one the server follows', async () => {
    const outside = await makeTree({ 'secret.html': '<!doctype html><html><head></head><body><p>secret</p></body></html>' });
    const tree = await makeTree({ 'index.html': '<!doctype html><html lang="en"><head><title>Home page of the site</title></head><body><a href="/secret.html">s</a></body></html>' });
    try {
      await symlink(path.join(outside.dir, 'secret.html'), path.join(tree.dir, 'secret.html'));
      const routes = await staticRoutes(tree.dir);
      routes['/secret.html'] = { body: await readFile(path.join(outside.dir, 'secret.html'), 'utf8') };
      const run = await auditProject(routes, tree.dir);
      const onSecret = run.findings.filter((f) => f.url?.endsWith('/secret.html'));
      assert.ok(onSecret.length > 0);
      assert.equal(onSecret.every((f) => !('source' in f)), true);
      assert.equal(run.source('seo.meta_description.missing', '/')?.file, 'index.html');
    } finally {
      await tree.remove();
      await outside.remove();
    }
  });

  it('names no source when the file is replaced by a link after the project was read', async () => {
    const outside = await makeTree({ 'page.html': '<!doctype html><html><head></head><body><p>one</p></body></html>' });
    const tree = await makeTree({ 'index.html': '<!doctype html><html><head></head><body><p>one</p></body></html>' });
    const server = await startServer(await staticRoutes(tree.dir));
    try {
      const crawl = await crawlLocal(server.origin, dataDir);
      const sources = await loadProjectSources(tree.dir);
      await unlink(path.join(tree.dir, 'index.html'));
      await symlink(path.join(outside.dir, 'page.html'), path.join(tree.dir, 'index.html'));
      const mapped = await attachSources(audit(crawl), crawl, sources);
      assert.equal(mapped.summary.findings_with_source, 0);
    } finally {
      await server.close();
      await tree.remove();
      await outside.remove();
    }
  });
});

/** A page as the Next.js fixture would send it: no lang attribute, the layout's navigation, then the page. */
const nextPage = (/** @type {{title: string, description?: string, body: string}} */ { title, description, body }) => ({
  body: `<!DOCTYPE html><html><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title>${
    description ? `<meta name="description" content="${description}"/>` : ''
  }</head><body><nav><a href="/">Home</a> <a href="/about">About</a> <a href="/pricing">Pricing</a> <a href="/blog">Blog</a> <a href="/docs">Docs</a> <a href="/legacy.html">Legacy page</a></nav>${body}</body></html>`,
});
const WORDS = 'word '.repeat(120);

/** What the dev server of fixtures/next-app answers, written out by hand so the test needs no Next.js. */
async function nextRoutes() {
  return {
    '/': nextPage({ title: 'Fixture Co: tools for testing audits', description: 'The home page.', body: `<h1>Tools</h1><p>${WORDS} home</p>` }),
    '/about': nextPage({ title: 'Fixture Co', description: 'A small site.', body: `<h1>About</h1><p>${WORDS} about</p>` }),
    '/pricing': nextPage({ title: 'Fixture Co', description: 'Plans and prices.', body: `<h2>Plans</h2><p>${WORDS} pricing</p>` }),
    '/blog': nextPage({ title: 'Blog', description: 'Posts.', body: `<h1>Blog</h1><p>${WORDS} blog</p><a href="/blog/first-post">First</a> <a href="/blog/missing-post">Deleted</a>` }),
    '/blog/first-post': nextPage({ title: 'The first post | Fixture Co blog', description: 'First.', body: `<h1>First</h1><p>${WORDS} first</p>` }),
    '/blog/missing-post': { status: 404, ...nextPage({ title: '404: This page could not be found.', body: '<h1>404</h1>' }) },
    '/docs': nextPage({ title: 'Documentation | Fixture Co docs', description: 'Docs.', body: `<h1>Docs</h1><p>${WORDS} docs</p><a href="/docs/getting-started">Start</a>` }),
    '/docs/getting-started': nextPage({ title: 'getting-started | Fixture Co docs', description: 'Start.', body: `<h1>Start</h1><p>${WORDS} start</p>` }),
    '/legacy.html': { body: await readFile(path.join(NEXT_FIXTURE, 'public', 'legacy.html'), 'utf8') },
    '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-Agent: *\nDisallow: /\n\nSitemap: {origin}/sitemap.xml\n' },
    '/sitemap.xml': {
      headers: { 'content-type': 'application/xml' },
      body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/about', '/blog/missing-post'].map((p) => `<url><loc>{origin}${p}</loc></url>`).join('')}</urlset>`,
    },
  };
}

describe('Next.js App Router: the fixture project', () => {
  /** @type {Awaited<ReturnType<typeof auditProject>>} */
  let run;
  before(async () => {
    const routes = await nextRoutes();
    // The crawler must be allowed in; the robots.txt finding is made below from a second crawl.
    routes['/robots.txt'].body = 'User-Agent: *\nAllow: /\n\nSitemap: {origin}/sitemap.xml\n';
    run = await auditProject(routes, NEXT_FIXTURE);
  });

  it('names the page file of the route, through route groups and dynamic segments, without a line', () => {
    assert.deepEqual(run.source('seo.title.duplicate', '/about'), { file: 'app/(marketing)/about/page.jsx', line: null, route: '/about' });
    assert.deepEqual(run.source('seo.title.duplicate', '/pricing'), { file: 'app/(marketing)/pricing/page.jsx', line: null, route: '/pricing' });
    assert.deepEqual(run.source('seo.h1.missing', '/pricing'), { file: 'app/(marketing)/pricing/page.jsx', line: null, route: '/pricing' });
    assert.deepEqual(run.source('links.internal.broken', '/blog'), { file: 'app/blog/page.jsx', line: null, route: '/blog' });
    assert.deepEqual(run.source('seo.html.lang_missing', '/blog/first-post'), { file: 'app/layout.jsx', line: null, route: '/blog/[slug]' });
    // A deleted post answers 404: the dynamic route could match it, but nothing says the fix is in that file.
    assert.equal(run.source('seo.sitemap.url_not_ok', '/blog/missing-post'), undefined);
    assert.deepEqual(run.source('seo.canonical.missing', '/docs/getting-started'), { file: 'app/docs/[[...path]]/page.jsx', line: null, route: '/docs/[[...path]]' });
  });

  it('names the root layout for findings about the document itself', () => {
    assert.deepEqual(run.source('seo.html.lang_missing', '/about'), { file: 'app/layout.jsx', line: null, route: '/about' });
    assert.deepEqual(run.source('seo.html.lang_missing', '/blog/first-post'), { file: 'app/layout.jsx', line: null, route: '/blog/[slug]' });
  });

  it('names a file in public/ with its lines, like a plain HTML file', () => {
    assert.deepEqual(run.source('seo.html.lang_missing', '/legacy.html'), { file: 'public/legacy.html', line: 2, route: '/legacy.html' });
    assert.deepEqual(run.source('seo.meta_description.missing', '/legacy.html'), { file: 'public/legacy.html', line: 3, route: '/legacy.html' });
  });

  it('gives no source to findings about the server, and keeps every id', () => {
    assert.equal(run.findings.find((f) => f.check_id === 'seo.https.site_not_https')?.source, undefined);
    assert.deepEqual(run.findings.map((f) => f.id), run.plain.map((f) => f.id));
  });

  it('explains what a Next.js source file means', () => {
    assert.equal(run.summary.framework, 'next-app');
    assert.deepEqual([run.summary.pages_matched, run.summary.pages_total], [8, 8]);
    assert.equal(run.notes.length, 1);
    assert.match(run.notes[0], /^For a Next\.js project the source file is the page file of the route/);
  });

  it('names the metadata file behind a robots.txt finding', async () => {
    const blocked = await startServer(await nextRoutes());
    try {
      const manager = (await import('../../server/src/crawl/manager.js')).createCrawlManager({ dataDir, sleep: async () => {} });
      const job = await manager.start({ url: `${blocked.origin}/`, maxPages: 5, allowLoopback: true });
      assert.equal((await manager.wait(job.id, 30_000))?.status, 'blocked');
      const crawl = /** @type {CrawlResult} */ (await manager.result(job.id));
      const mapped = await attachSources(audit(crawl), crawl, await loadProjectSources(NEXT_FIXTURE));
      const finding = mapped.findings.find((f) => f.check_id === 'seo.robots.disallow_all');
      assert.deepEqual(finding?.source, { file: 'app/robots.js', line: null, route: '/robots.txt' });
    } finally {
      await blocked.close();
    }
  });
});

describe('Next.js: what the server sent decides whether a route is named', () => {
  const FILES = { 'package.json': JSON.stringify({ dependencies: { next: '15' } }), 'app/layout.tsx': '', 'app/page.tsx': '', 'app/[slug]/page.tsx': '', 'app/fixed/page.tsx': '' };
  const page = (/** @type {string} */ body) => nextPage({ title: 'A page title of its own', description: 'Text.', body });
  /** @param {Record<string, string>} [extra] */
  async function run(extra = {}) {
    const tree = await makeTree({ ...FILES, ...extra });
    try {
      return await auditProject({
        '/': page(`<h1>Home</h1><p>${WORDS}</p><a href="/old">old</a> <a href="/gone">gone</a> <a href="/post">post</a> <a href="/fixed">fixed</a> <a href="/moved">moved</a>`),
        '/old': { status: 308, redirect: '/post' },
        '/moved': { status: 307, redirect: '/moved2' },
        '/moved2': { status: 307, redirect: '/post' },
        '/post': page(`<h2>Post</h2><p>${WORDS} post</p>`),
        '/fixed': { status: 500, ...page('<h1>Error</h1>') },
      }, tree.dir);
    } finally {
      await tree.remove();
    }
  }

  it('names the dynamic route for a URL that answered 200', async () => {
    assert.deepEqual((await run()).source('seo.h1.missing', '/post'), { file: 'app/[slug]/page.tsx', line: null, route: '/[slug]' });
  });

  it('names no file for a URL that redirected: the redirect is not in the page file', async () => {
    const result = await run();
    assert.equal(result.source('seo.redirect.chain', '/moved'), undefined);
    const linking = result.findings.filter((f) => f.check_id === 'links.internal.redirect');
    assert.ok(linking.length > 0);
    assert.equal(linking.every((f) => f.source?.file === 'app/page.tsx'), true);
  });

  it('names no file for a 404 that only a dynamic route could match', async () => {
    const result = await run();
    assert.equal(result.crawl.pages.find((p) => p.url.endsWith('/gone'))?.status, 404);
    // A finding on the 404 URL itself, as a sitemap check would make it.
    const tree = await makeTree(FILES);
    try {
      const onGone = { ...result.plain[0], check_id: 'seo.sitemap.url_not_ok', url: `${result.crawl.site_origin}/gone` };
      const onPost = { ...onGone, url: `${result.crawl.site_origin}/post` };
      const mapped = await attachSources([onGone, onPost], result.crawl, await loadProjectSources(tree.dir));
      assert.deepEqual(mapped.findings.map((f) => f.source?.file), [undefined, 'app/[slug]/page.tsx']);
    } finally {
      await tree.remove();
    }
    const linking = result.findings.filter((f) => f.check_id === 'links.internal.broken' && f.url?.endsWith('/'));
    assert.ok(linking.length > 0);
    assert.equal(linking.every((f) => f.source?.file === 'app/page.tsx'), true);
  });

  it('names a fixed route that answered with a server error', async () => {
    assert.deepEqual((await run()).source('seo.http.server_error', '/fixed'), { file: 'app/fixed/page.tsx', line: null, route: '/fixed' });
  });

  it('names no dynamic route for a sitemap file that failed', async () => {
    const tree = await makeTree(FILES);
    const server = await startServer({ '/': page(`<h1>Home</h1><p>${WORDS}</p>`), '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\nSitemap: {origin}/sitemap.xml\n' }, '/sitemap.xml': { status: 500, body: 'error' } });
    try {
      const crawl = await crawlLocal(server.origin, dataDir);
      const mapped = await attachSources(audit(crawl), crawl, await loadProjectSources(tree.dir));
      const finding = mapped.findings.find((f) => f.check_id === 'seo.sitemap.file_error');
      assert.ok(finding);
      assert.equal('source' in finding, false);
    } finally {
      await server.close();
      await tree.remove();
    }
  });

  it('says which next.config settings it does not know, and nothing when there are none', async () => {
    const plain = await run({ 'next.config.mjs': 'export default { htmlLimitedBots: /seekwide/i };' });
    assert.equal(plain.notes.some((note) => note.startsWith('next.config mentions')), false);
    const based = await run({ 'next.config.mjs': "export default { basePath: '/shop', async rewrites() { return []; } };" });
    assert.match(based.notes.join('\n'), /^next\.config mentions basePath, rewrites\. The plugin does not read that file's settings, so a URL they change gets no source file, and routes with a dynamic segment are not named at all\./m);
  });

  it('names no dynamic route when basePath or rewrites may have changed the URL, and still names fixed routes', async () => {
    const based = await run({ 'next.config.mjs': "export default { basePath: '/shop' };" });
    assert.equal(based.source('seo.h1.missing', '/post'), undefined);
    assert.equal(based.source('seo.http.server_error', '/fixed')?.file, 'app/fixed/page.tsx');
    const extensions = await run({ 'next.config.mjs': "export default { pageExtensions: ['tsx', 'mdx'] };" });
    assert.equal(extensions.source('seo.h1.missing', '/post')?.file, 'app/[slug]/page.tsx');
  });

  it('names no dynamic route for a path in a dot folder, which may be a public file the listing leaves out', async () => {
    const result = await run();
    const tree = await makeTree({ ...FILES, 'public/.well-known/page.html': '' });
    try {
      const sources = await loadProjectSources(tree.dir);
      const crawl = { ...result.crawl, pages: [...result.crawl.pages, { ...result.crawl.pages[0], url: `${result.crawl.site_origin}/.well-known/page.html` }] };
      const finding = { ...result.plain[0], check_id: 'seo.title.missing', url: `${result.crawl.site_origin}/.well-known/page.html` };
      // [slug] takes one segment only; a two-segment path needs a catch-all, so check the one-segment form too.
      const dot = { ...finding, url: `${result.crawl.site_origin}/.hidden` };
      const dotCrawl = { ...crawl, pages: [...crawl.pages, { ...result.crawl.pages[0], url: dot.url }] };
      assert.equal(sources.resolve('/.hidden')?.file, 'app/[slug]/page.tsx');
      assert.deepEqual((await attachSources([dot], dotCrawl, sources)).findings.map((f) => 'source' in f), [false]);
      assert.deepEqual((await attachSources([finding], crawl, sources)).findings.map((f) => 'source' in f), [false]);
    } finally {
      await tree.remove();
    }
  });
});

describe('Next.js: metadata streamed into the body', () => {
  const STREAMED = '<title>Late title for this page</title><meta name="description" content="Late."/><link rel="canonical" href="{origin}/late"/>';
  const FLIGHT = '<script>self.__next_f.push([1,"5:[]"])</script>';
  /** @param {boolean} inBody @param {boolean} [flight] */
  const routes = (inBody, flight = true) => ({
    '/': nextPage({ title: 'Home page of the site', description: 'Home.', body: `<h1>Home</h1><p>${WORDS}</p><a href="/late">Late</a>` }),
    '/late': { body: `<!DOCTYPE html><html lang="en"><head><meta name="viewport" content="width=device-width"/>${inBody ? '' : STREAMED}</head><body><h1>Late</h1><p>${WORDS} late</p>${flight ? FLIGHT : ''}${inBody ? STREAMED : ''}</body></html>` },
  });
  const TREE = { 'package.json': JSON.stringify({ dependencies: { next: '15' } }), 'app/layout.jsx': '', 'app/page.jsx': '', 'app/late/page.jsx': '' };

  it('reports a streamed canonical as a likely finding with its file, and not as outside the head or missing', async () => {
    const tree = await makeTree(TREE);
    try {
      const run = await auditProject(routes(true), tree.dir);
      const late = run.findings.filter((f) => f.url?.endsWith('/late')).map((f) => f.check_id);
      assert.ok(late.includes('seo.canonical.streamed_in_body'));
      assert.equal(late.includes('seo.canonical.outside_head') || late.includes('seo.canonical.missing'), false);
      assert.equal(run.findings.find((f) => f.check_id === 'seo.canonical.streamed_in_body')?.confidence, 'likely');
      assert.deepEqual(run.source('seo.canonical.streamed_in_body', '/late'), { file: 'app/late/page.jsx', line: null, route: '/late' });
    } finally {
      await tree.remove();
    }
  });

  it('still reports a canonical in the body of a page without Next.js data scripts as outside the head', async () => {
    const tree = await makeTree(TREE);
    try {
      const run = await auditProject(routes(true, false), tree.dir);
      assert.deepEqual(run.source('seo.canonical.outside_head', '/late'), { file: 'app/late/page.jsx', line: null, route: '/late' });
      assert.equal(run.findings.some((f) => f.check_id === 'seo.canonical.streamed_in_body'), false);
    } finally {
      await tree.remove();
    }
  });

  it('says nothing when every canonical is in the head', async () => {
    const tree = await makeTree({ 'package.json': JSON.stringify({ dependencies: { next: '15' } }), 'app/layout.jsx': '', 'app/page.jsx': '', 'app/late/page.jsx': '' });
    try {
      const run = await auditProject(routes(false), tree.dir);
      assert.equal(run.findings.some((f) => f.check_id === 'seo.canonical.outside_head' || f.check_id === 'seo.canonical.streamed_in_body'), false);
      assert.equal(run.notes.length, 1);
    } finally {
      await tree.remove();
    }
  });

  it('is not said about a plain HTML project, where a canonical in the body is the file\'s own mistake', async () => {
    const run = await auditProject(await staticRoutes(HTML_FIXTURE), HTML_FIXTURE);
    assert.ok(run.findings.some((f) => f.check_id === 'seo.canonical.outside_head'));
    assert.deepEqual(run.notes, []);
  });
});

describe('a project in a folder below the project folder', () => {
  it('names files relative to the project folder', async () => {
    const tree = await makeTree({ 'README.md': '' });
    try {
      const { cp } = await import('node:fs/promises');
      await cp(HTML_FIXTURE, path.join(tree.dir, 'sites', 'main'), { recursive: true });
      const run = await auditProject(await staticRoutes(HTML_FIXTURE), tree.dir, path.join(tree.dir, 'sites', 'main'));
      assert.equal(run.summary.source_dir, 'sites/main');
      assert.deepEqual(run.source('seo.title.missing', '/about.html'), { file: 'sites/main/about.html', line: 3, route: '/about.html' });
    } finally {
      await tree.remove();
    }
  });
});

describe('projects that are not supported', () => {
  /** @param {Finding[]} findings */
  const noSources = (findings) => findings.every((f) => !('source' in f));

  it('maps nothing and says why in plain words', async () => {
    const tree = await makeTree({ 'package.json': JSON.stringify({ dependencies: { astro: '5' } }), 'index.html': '<title>x</title>' });
    try {
      const run = await auditProject({ '/': { body: '<!doctype html><title>x</title>' } }, tree.dir);
      assert.equal(noSources(run.findings), true);
      assert.deepEqual(run.findings, run.plain);
      assert.deepEqual(run.summary, { framework: 'unsupported', label: 'Astro', source_dir: '.', findings_with_source: 0, pages_matched: 0, pages_total: 1 });
      assert.deepEqual(run.notes, ['Findings were not mapped to source files. This project uses Astro, which is not supported yet. The site can still be audited by its address; findings then name URLs and not source files.']);
    } finally {
      await tree.remove();
    }
  });

  it('refuses a source folder outside the project folder', async () => {
    await assert.rejects(loadProjectSources(HTML_FIXTURE, NEXT_FIXTURE), RepoError);
  });
});

describe('findings on other origins', () => {
  it('names no source for a URL that is not on the audited site', async () => {
    const server = await startServer(await staticRoutes(HTML_FIXTURE));
    try {
      const crawl = await crawlLocal(server.origin, dataDir);
      const [finding] = audit(crawl).filter((f) => f.check_id === 'seo.title.missing');
      const elsewhere = { ...finding, url: 'https://elsewhere.test/about.html' };
      const garbage = { ...finding, url: 'not a url' };
      const mapped = await attachSources([finding, elsewhere, garbage], crawl, await loadProjectSources(HTML_FIXTURE));
      assert.deepEqual(mapped.findings.map((f) => f.source?.file), ['about.html', undefined, undefined]);
    } finally {
      await server.close();
    }
  });

  it('keeps a file written after the listing out of the mapping', async () => {
    const tree = await makeTree({ 'index.html': '<!doctype html><html><head></head><body><a href="/new.html">n</a></body></html>' });
    const server = await startServer({ ...(await staticRoutes(tree.dir)), '/new.html': { body: '<!doctype html><p>new</p>' } });
    try {
      const sources = await loadProjectSources(tree.dir);
      await writeFile(path.join(tree.dir, 'new.html'), '<!doctype html><p>new</p>');
      const crawl = await crawlLocal(server.origin, dataDir);
      const mapped = await attachSources(audit(crawl), crawl, sources);
      assert.equal(mapped.findings.some((f) => f.source?.file === 'new.html'), false);
    } finally {
      await server.close();
      await tree.remove();
    }
  });
});
