import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildNextRoutes, matchNextRoute, pathSegments } from '../../server/src/repo/next-routes.js';
import { listFiles } from '../../server/src/repo/scan.js';
import { NEXT_FIXTURE } from '../helpers/repo.js';

/**
 * @param {string[]} files
 * @param {string[]} [publicFiles]
 * @param {string} [appDir]
 */
function router(files, publicFiles = [], appDir = 'app') {
  const routes = buildNextRoutes(files.map((file) => `${appDir}/${file}`), appDir);
  /** @param {string} pathname */
  const match = (pathname) => matchNextRoute(routes, new Set(publicFiles), pathname);
  /** @param {string} pathname */
  const file = (pathname) => match(pathname)?.file ?? null;
  return { routes, match, file };
}

describe('the Next.js fixture', () => {
  it('maps every URL of the fixture to the file that answers it', async () => {
    const app = await listFiles(NEXT_FIXTURE, 'app');
    const pub = await listFiles(NEXT_FIXTURE, 'public');
    const routes = buildNextRoutes(app.files, 'app');
    const publicFiles = new Set(pub.files.map((file) => file.slice('public/'.length)));
    /** @param {string} pathname */
    const at = (pathname) => {
      const found = matchNextRoute(routes, publicFiles, pathname);
      return found === null ? null : [found.file, found.route, found.kind];
    };

    assert.deepEqual(at('/'), ['app/page.jsx', '/', 'page']);
    assert.deepEqual(at('/about'), ['app/(marketing)/about/page.jsx', '/about', 'page']);
    assert.deepEqual(at('/pricing'), ['app/(marketing)/pricing/page.jsx', '/pricing', 'page']);
    assert.deepEqual(at('/blog'), ['app/blog/page.jsx', '/blog', 'page']);
    assert.deepEqual(at('/blog/first-post'), ['app/blog/[slug]/page.jsx', '/blog/[slug]', 'page']);
    assert.deepEqual(at('/blog/missing-post'), ['app/blog/[slug]/page.jsx', '/blog/[slug]', 'page']);
    assert.deepEqual(at('/docs'), ['app/docs/[[...path]]/page.jsx', '/docs/[[...path]]', 'page']);
    assert.deepEqual(at('/docs/getting-started/install'), ['app/docs/[[...path]]/page.jsx', '/docs/[[...path]]', 'page']);
    assert.deepEqual(at('/api/health'), ['app/api/health/route.js', '/api/health', 'handler']);
    assert.deepEqual(at('/robots.txt'), ['app/robots.js', '/robots.txt', 'metadata']);
    assert.deepEqual(at('/sitemap.xml'), ['app/sitemap.js', '/sitemap.xml', 'metadata']);
    assert.deepEqual(at('/legacy.html'), ['public/legacy.html', '/legacy.html', 'public']);
    assert.equal(at('/nope'), null);
    assert.equal(at('/blog/first-post/comments'), null);
    assert.equal(at('/_components/nav'), null);
  });

  it('names the root layout of every page route', async () => {
    const routes = buildNextRoutes((await listFiles(NEXT_FIXTURE, 'app')).files, 'app');
    for (const route of routes.filter((r) => r.kind === 'page')) assert.equal(route.rootLayout, 'app/layout.jsx', route.file);
  });
});

describe('buildNextRoutes: file conventions', () => {
  it('accepts js, jsx, ts, tsx, md and mdx page files and nothing else', () => {
    const { file } = router(['a/page.js', 'b/page.jsx', 'c/page.ts', 'd/page.tsx', 'e/page.mdx', 'f/page.css', 'g/Page.tsx', 'h/pages.tsx', 'i/page.md', 'j/route.mdx']);
    assert.deepEqual(['/a', '/b', '/c', '/d', '/e', '/f', '/g', '/h', '/i', '/j'].map(file), ['app/a/page.js', 'app/b/page.jsx', 'app/c/page.ts', 'app/d/page.tsx', 'app/e/page.mdx', null, null, null, 'app/i/page.md', null]);
  });

  it('does not hand an mdx page to the dynamic route next to it', () => {
    const { file } = router(['blog/hello/page.mdx', 'blog/[slug]/page.tsx']);
    assert.equal(file('/blog/hello'), 'app/blog/hello/page.mdx');
  });

  it('leaves route groups out of the URL', () => {
    const { match } = router(['(shop)/(sale)/cart/page.tsx']);
    assert.deepEqual(match('/cart'), { file: 'app/(shop)/(sale)/cart/page.tsx', route: '/cart', kind: 'page', rootLayout: null, exact: true });
    assert.equal(match('/(shop)/cart'), null);
  });

  it('makes no route from private folders, slots and intercepting routes', () => {
    const { routes } = router(['_lib/page.tsx', 'a/_parts/page.tsx', '@modal/login/page.tsx', 'feed/(..)photo/page.tsx', 'feed/(.)photo/page.tsx', 'feed/(...)photo/page.tsx', 'feed/(..)(..)photo/page.tsx']);
    assert.deepEqual(routes, []);
  });

  it('reads %5F at the start of a folder name as an underscore', () => {
    const { file } = router(['%5Finternal/page.tsx']);
    assert.equal(file('/_internal'), 'app/%5Finternal/page.tsx');
    assert.equal(file('/%5Finternal'), 'app/%5Finternal/page.tsx');
    assert.equal(file('/internal'), null);
  });

  it('ignores a catch-all segment that is not the last one', () => {
    assert.deepEqual(router(['[...all]/more/page.tsx', '[[...all]]/more/page.tsx']).routes, []);
  });

  it('uses the app folder it is given', () => {
    const routes = buildNextRoutes(['src/app/about/page.tsx', 'app/other/page.tsx'], 'src/app');
    assert.deepEqual(routes.map((r) => [r.file, r.route]), [['src/app/about/page.tsx', '/about']]);
  });

  it('finds the outermost layout above a route, through route groups', () => {
    const { routes } = router(['(site)/layout.tsx', '(site)/blog/layout.tsx', '(site)/blog/page.tsx', '(app)/layout.tsx', '(app)/dash/page.tsx', 'bare/page.tsx']);
    assert.deepEqual(routes.map((r) => [r.route, r.rootLayout]), [
      ['/dash', 'app/(app)/layout.tsx'], ['/blog', 'app/(site)/layout.tsx'], ['/bare', null],
    ]);
  });
});

describe('matchNextRoute: which route wins', () => {
  const { file, match } = router(['page.tsx', 'blog/page.tsx', 'blog/new/page.tsx', 'blog/[slug]/page.tsx', 'blog/[slug]/edit/page.tsx', 'shop/[...parts]/page.tsx', 'shop/sale/page.tsx', '[[...rest]]/page.tsx']);

  it('prefers a fixed segment to a dynamic one, a dynamic one to a catch-all, and a catch-all to an optional catch-all', () => {
    assert.equal(file('/'), 'app/page.tsx');
    assert.equal(file('/blog'), 'app/blog/page.tsx');
    assert.equal(file('/blog/new'), 'app/blog/new/page.tsx');
    assert.equal(file('/blog/hello'), 'app/blog/[slug]/page.tsx');
    assert.equal(file('/blog/hello/edit'), 'app/blog/[slug]/edit/page.tsx');
    assert.equal(file('/shop/sale'), 'app/shop/sale/page.tsx');
    assert.equal(file('/shop/a/b/c'), 'app/shop/[...parts]/page.tsx');
    assert.equal(file('/shop'), 'app/[[...rest]]/page.tsx');
    assert.equal(file('/anything/else'), 'app/[[...rest]]/page.tsx');
    assert.equal(file('/blog/hello/other'), 'app/[[...rest]]/page.tsx');
  });

  it('ignores the trailing slash and repeated slashes, and compares decoded segments exactly', () => {
    assert.equal(file('/blog/'), 'app/blog/page.tsx');
    assert.equal(file('//blog//new/'), 'app/blog/new/page.tsx');
    assert.equal(file('/%62log'), 'app/blog/page.tsx');
    assert.equal(match('/Blog')?.route, '/[[...rest]]');
  });

  it('answers nothing for a path that cannot be decoded', () => {
    assert.equal(match('/blog/%E0%A4%A'), null);
    assert.equal(pathSegments('/%'), null);
    assert.deepEqual(pathSegments('/a%20b/c/'), ['a b', 'c']);
  });

  it('requires a catch-all to match one segment or more, and an optional one to match none or more', () => {
    const { file: only } = router(['docs/[...path]/page.tsx', 'help/[[...path]]/page.tsx']);
    assert.equal(only('/docs'), null);
    assert.equal(only('/docs/a'), 'app/docs/[...path]/page.tsx');
    assert.equal(only('/help'), 'app/help/[[...path]]/page.tsx');
    assert.equal(only('/help/a/b'), 'app/help/[[...path]]/page.tsx');
  });
});

describe('metadata files', () => {
  it('maps robots, sitemap, manifest and favicon to their fixed URLs', () => {
    const { match } = router(['robots.ts', 'sitemap.ts', 'manifest.ts', 'favicon.ico', 'page.tsx']);
    assert.deepEqual(match('/robots.txt'), { file: 'app/robots.ts', route: '/robots.txt', kind: 'metadata', rootLayout: null, exact: true });
    assert.equal(match('/sitemap.xml')?.file, 'app/sitemap.ts');
    assert.equal(match('/sitemap/2.xml')?.file, 'app/sitemap.ts');
    assert.equal(match('/sitemap/2.xml')?.route, '/sitemap/[id].xml');
    assert.equal(match('/manifest.webmanifest')?.file, 'app/manifest.ts');
    assert.equal(match('/favicon.ico')?.file, 'app/favicon.ico');
    assert.equal(match('/robots'), null);
    assert.equal(match('/sitemap/2.txt'), null);
  });

  it('maps the static forms too', () => {
    const { file } = router(['robots.txt', 'sitemap.xml', 'manifest.json']);
    assert.deepEqual(['/robots.txt', '/sitemap.xml', '/manifest.json', '/manifest.webmanifest', '/sitemap/1.xml'].map(file), ['app/robots.txt', 'app/sitemap.xml', 'app/manifest.json', null, null]);
  });

  it('accepts robots, manifest and favicon only at the top of the app folder', () => {
    const { file } = router(['blog/robots.ts', 'blog/favicon.ico', 'blog/manifest.ts', '(site)/robots.ts', 'blog/sitemap.ts']);
    assert.equal(file('/blog/robots.txt'), null);
    assert.equal(file('/blog/favicon.ico'), null);
    assert.equal(file('/robots.txt'), 'app/(site)/robots.ts');
    assert.equal(file('/blog/sitemap.xml'), 'app/blog/sitemap.ts');
  });

  it('maps image files in any segment: static ones with their extension, generated ones without', () => {
    const { match, file } = router(['opengraph-image.png', 'icon.svg', 'apple-icon.png', 'blog/[slug]/opengraph-image.tsx', 'blog/twitter-image.jpg', 'blog/icon2.png']);
    assert.deepEqual(match('/opengraph-image.png'), { file: 'app/opengraph-image.png', route: '/opengraph-image.png', kind: 'metadata', rootLayout: null, exact: true });
    assert.equal(file('/icon.svg'), 'app/icon.svg');
    assert.equal(file('/apple-icon.png'), 'app/apple-icon.png');
    assert.equal(file('/blog/hello/opengraph-image'), 'app/blog/[slug]/opengraph-image.tsx');
    assert.equal(match('/blog/hello/opengraph-image')?.route, '/blog/[slug]/opengraph-image');
    assert.equal(match('/blog/hello/opengraph-image/2')?.file, 'app/blog/[slug]/opengraph-image.tsx');
    assert.equal(match('/blog/hello/opengraph-image/2')?.route, '/blog/[slug]/opengraph-image/[id]');
    assert.equal(file('/blog/twitter-image.jpg'), 'app/blog/twitter-image.jpg');
    assert.equal(file('/blog/icon2.png'), 'app/blog/icon2.png');
    assert.equal(file('/opengraph-image.jpg'), null);
    assert.equal(file('/opengraph-image'), null);
    assert.equal(file('/blog/hello/opengraph-image.png'), null);
  });

  it('accepts the hash Next.js adds to an image URL inside a route group', () => {
    const { file } = router(['(site)/opengraph-image.png', '(site)/about/twitter-image.tsx']);
    assert.equal(file('/opengraph-image-1ow20b.png'), 'app/(site)/opengraph-image.png');
    assert.equal(file('/about/twitter-image-k3x9z0'), 'app/(site)/about/twitter-image.tsx');
    assert.equal(file('/opengraph-image-toolonghash.png'), null);
  });

  it('refuses image types the convention does not list', () => {
    assert.deepEqual(router(['apple-icon.svg', 'opengraph-image.webp', 'icon.gif', 'banner-image.png']).routes, []);
  });
});

describe('files in public/', () => {
  const { match, file } = router(['page.tsx', 'robots.ts', '[slug]/page.tsx', '[[...rest]]/page.tsx'], ['robots.txt', 'legacy.html', 'img/logo.png', 'about']);

  it('serves a public file at its own path, before any dynamic route', () => {
    assert.deepEqual(match('/legacy.html'), { file: 'public/legacy.html', route: '/legacy.html', kind: 'public', rootLayout: null, exact: true });
    assert.equal(file('/img/logo.png'), 'public/img/logo.png');
    assert.equal(file('/about'), 'public/about');
    assert.equal(file('/other'), 'app/[slug]/page.tsx');
  });

  it('says whether a match is exact or only possible', () => {
    assert.equal(match('/')?.exact, true);
    assert.equal(match('/robots.txt')?.exact, true);
    assert.equal(match('/legacy.html')?.exact, true);
    assert.equal(match('/other')?.exact, false);
    assert.equal(match('/a/b/c')?.exact, false);
  });

  it('lets a public file win over the "[id]" address of a generated sitemap or image', () => {
    const generated = router(['sitemap.ts', 'icon.tsx'], ['sitemap/a.xml', 'icon/big']);
    assert.equal(generated.file('/sitemap/a.xml'), 'public/sitemap/a.xml');
    assert.equal(generated.file('/icon/big'), 'public/icon/big');
    assert.deepEqual([generated.match('/sitemap/b.xml')?.file, generated.match('/sitemap/b.xml')?.exact], ['app/sitemap.ts', false]);
    assert.deepEqual([generated.match('/sitemap.xml')?.exact, generated.match('/icon')?.exact], [true, true]);
  });

  it('lets a route of fixed segments win over a public file', () => {
    assert.equal(file('/robots.txt'), 'app/robots.ts');
    assert.equal(file('/'), 'app/page.tsx');
  });

  it('cannot be led out of public/ by an encoded path', () => {
    for (const pathname of ['/..%2Fpackage.json', '/%2e%2e/package.json', '/img%2Flogo.png', '/img/../legacy.html']) {
      assert.notEqual(match(pathname)?.kind, 'public', pathname);
    }
  });
});
