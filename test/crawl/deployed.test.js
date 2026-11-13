// A local crawl that knows where the project is deployed: canonicals, robots.txt
// Sitemap lines and sitemap entries on that address count as local ones.

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

import { deployedOriginOf, localizeRecord, localizeUrls, toLocalUrl } from '../../plugin/server/src/crawl/deployed.js';
import { siteIdentity } from '../../plugin/server/src/util/site-identity.js';
import { createCrawlManager } from '../../plugin/server/src/crawl/manager.js';
import { safeFetch } from '../../plugin/server/src/net/safe-fetch.js';
import { makePage } from '../helpers/factories.js';
import { startServer } from '../helpers/http-server.js';
import { removeTempDirs, tempDir } from './harness.js';

after(removeTempDirs);

const DEPLOYED = 'https://www.example.com';
const LOCAL = 'http://localhost:3000';

describe('deployedOriginOf', () => {
  it('gives the origin of an http or https URL', () => {
    assert.equal(deployedOriginOf('https://www.example.com/shop?x=1'), DEPLOYED);
    assert.equal(deployedOriginOf('http://example.com:8080'), 'http://example.com:8080');
  });

  it('rejects anything else with a TypeError that says what to pass', () => {
    for (const value of ['example', 'ftp://example.com/', '', null, 7]) {
      assert.throws(() => deployedOriginOf(value), (error) => error instanceof TypeError && /deployed at, such as https:\/\/www\.example\.com/.test(error.message));
    }
  });

  it('drops the trailing dot of a fully qualified host name, so the origin is the one the pages name', () => {
    assert.equal(deployedOriginOf('https://www.example.com.'), DEPLOYED);
    assert.equal(deployedOriginOf('HTTPS://WWW.Example.COM./shop?x=1'), DEPLOYED);
    assert.equal(deployedOriginOf('http://example.com.:8080/'), 'http://example.com:8080');
    assert.equal(toLocalUrl(`${DEPLOYED}/about`, deployedOriginOf('https://www.example.com.'), LOCAL), `${LOCAL}/about`);
  });

  it('keeps a host name without a trailing dot as it is, and refuses one with an empty label', () => {
    assert.equal(deployedOriginOf('https://example.com'), 'https://example.com');
    assert.equal(deployedOriginOf('https://1.2.3.4./'), 'https://1.2.3.4');
    for (const value of ['https://example.com..', 'https://./']) {
      assert.throws(() => deployedOriginOf(value), (error) => error instanceof TypeError && /empty label/.test(error.message), value);
    }
  });
});

describe('toLocalUrl', () => {
  it('moves a URL on the deployed origin to the local server, keeping path and query', () => {
    assert.equal(toLocalUrl('https://www.example.com/about?ref=a', DEPLOYED, LOCAL), 'http://localhost:3000/about?ref=a');
    assert.equal(toLocalUrl('https://www.example.com', DEPLOYED, LOCAL), 'http://localhost:3000/');
  });

  it('leaves every other origin alone: another host, scheme or port is another site', () => {
    for (const url of ['https://example.com/about', 'http://www.example.com/about', 'https://www.example.com:8443/about', 'https://www.example.com.evil.test/', 'not a url']) {
      assert.equal(toLocalUrl(url, DEPLOYED, LOCAL), url);
    }
  });

  it('localizeUrls keeps the order and drops repeats', () => {
    assert.deepEqual(localizeUrls(['https://www.example.com/a', `${LOCAL}/a`, 'https://other.test/b'], DEPLOYED, LOCAL), [`${LOCAL}/a`, 'https://other.test/b']);
  });
});

describe('SiteIdentity.isDeployed', () => {
  const onDeployedHost = (/** @type {string} */ url, /** @type {string} */ origin) => siteIdentity({ siteHost: 'localhost:3000', deployedOrigin: origin }).isDeployed(url);
  it('is true for every address of the deployed site: other scheme, other port, www or not, trailing dot', () => {
    for (const url of ['https://www.example.com/a', 'http://www.example.com/a', 'https://example.com/a', 'https://www.example.com:8443/a', 'https://www.example.com./a', 'https://WWW.Example.com/a']) {
      assert.equal(onDeployedHost(url, DEPLOYED), true, url);
    }
    assert.equal(onDeployedHost('https://www.example.com/a', 'https://example.com'), true);
  });

  it('is false for another host, a subdomain and anything that is not a URL', () => {
    for (const url of ['https://sub.www.example.com/a', 'https://other.example.org/a', 'https://example.com.evil.test/a', 'not a url']) {
      assert.equal(onDeployedHost(url, DEPLOYED), false, url);
    }
  });
});

describe('localizeRecord', () => {
  const url = `${LOCAL}/about`;
  const deployedCanonical = { href: 'https://www.example.com/about', url: 'https://www.example.com/about', source: /** @type {const} */ ('html'), in_head: true, line: 4 };

  it('reads a canonical on the deployed origin as the local page and makes the page indexable again', () => {
    const record = makePage({ url, canonicals: [deployedCanonical], indexability: { indexable: false, reasons: ['canonical_elsewhere'] } });
    const local = localizeRecord(record, DEPLOYED, LOCAL);
    assert.deepEqual(local.canonicals, [{ ...deployedCanonical, url }]);
    assert.deepEqual(local.indexability, { indexable: true, reasons: [] });
    // The record it was given is not changed, and the page's own text stays in href.
    assert.equal(record.canonicals[0].url, 'https://www.example.com/about');
  });

  it('keeps a canonical that names another page of the deployed site as pointing elsewhere', () => {
    const record = makePage({ url, canonicals: [{ ...deployedCanonical, href: 'https://www.example.com/', url: 'https://www.example.com/' }] });
    const local = localizeRecord(record, DEPLOYED, LOCAL);
    assert.equal(local.canonicals[0].url, `${LOCAL}/`);
    assert.deepEqual(local.indexability, { indexable: false, reasons: ['canonical_elsewhere'] });
  });

  it('keeps the other reasons a page is not indexable', () => {
    const record = makePage({ url, meta_robots: ['noindex'], canonicals: [deployedCanonical], indexability: { indexable: false, reasons: ['noindex_meta', 'canonical_elsewhere'] } });
    assert.deepEqual(localizeRecord(record, DEPLOYED, LOCAL).indexability, { indexable: false, reasons: ['noindex_meta'] });
  });

  it('reads a link on the deployed origin as an internal link to the local page, keeping what the page sent', () => {
    const link = { href: 'https://www.example.com/pricing?plan=a', url: 'https://www.example.com/pricing?plan=a', text: 'Pricing', aria_label: null, title_attr: null, rel: [], internal: false, has_onclick: false, line: 7 };
    const other = { ...link, href: 'http://www.example.com/x', url: 'http://www.example.com/x' };
    const record = makePage({ url, links: [link, other] });
    const local = localizeRecord(record, DEPLOYED, LOCAL);
    assert.deepEqual(local.links[0], { ...link, url: `${LOCAL}/pricing?plan=a`, internal: true });
    assert.equal(local.links[1], other, 'another scheme is another site');
    assert.equal(local.indexability, record.indexability, 'links do not change whether the page is indexable');
    assert.equal(record.links[0].url, link.url, 'the record it was given is not changed');
  });

  it('returns a record without such a canonical as it is', () => {
    const record = makePage({ url, canonicals: [{ href: 'https://other.test/x', url: 'https://other.test/x', source: 'html', in_head: true, line: 1 }, { href: '::', url: null, source: 'html', in_head: true, line: 2 }] });
    assert.equal(localizeRecord(record, DEPLOYED, LOCAL), record);
  });
});

describe('a crawl of a local server whose pages name the deployed site', () => {
  const page = (/** @type {string} */ path, /** @type {string[]} */ links = []) => ({
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html lang="en"><head><title>Page ${path}</title><link rel="canonical" href="${DEPLOYED}${path}"></head><body><h1>${path}</h1>${links.map((href) => `<a href="${href}">link</a>`).join('')}</body></html>`,
  });
  const routes = () => ({
    '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: `User-agent: *\nAllow: /\nSitemap: ${DEPLOYED}/sitemap.xml\n` },
    '/sitemap.xml': { headers: { 'content-type': 'application/xml' }, body: `<urlset><url><loc>${DEPLOYED}/</loc></url><url><loc>${DEPLOYED}/only-in-sitemap</loc></url></urlset>` },
    '/': page('/', ['/about']),
    '/about': page('/about'),
    '/only-in-sitemap': page('/only-in-sitemap'),
  });

  /** @param {string} origin @param {object} options */
  async function run(origin, options) {
    const manager = createCrawlManager({ dataDir: await tempDir(), sleep: async () => {} });
    const job = await manager.start({ url: `${origin}/`, allowLoopback: true, ...options });
    const done = await manager.wait(job.id, 30_000);
    assert.equal(done?.status, 'done', done?.error ?? '');
    const result = await manager.result(job.id);
    assert.ok(result);
    return result;
  }

  it('with the deployed address: pages are indexable, the sitemap is read from the local server, and that address is never requested', async () => {
    const server = await startServer(routes());
    try {
      const result = await run(server.origin, { deployedUrl: `${DEPLOYED}/any/page` });
      assert.equal(result.options.deployed_origin, DEPLOYED);
      // Three pages with a canonical on that origin, one Sitemap line, two sitemap entries.
      assert.equal(result.options.deployed_localized, 6);
      assert.deepEqual(result.pages.map((p) => [new URL(p.url).pathname, p.indexability.indexable]), [['/', true], ['/about', true], ['/only-in-sitemap', true]]);
      assert.deepEqual(result.sitemap.files.map((file) => [file.url, file.type]), [[`${server.origin}/sitemap.xml`, 'urlset']]);
      assert.deepEqual(result.sitemap.urls, [`${server.origin}/`, `${server.origin}/only-in-sitemap`]);
      // What robots.txt says is kept as it was sent.
      assert.deepEqual(result.robots.sitemaps, [`${DEPLOYED}/sitemap.xml`]);
      assert.equal(result.pages[1].canonicals[0].href, `${DEPLOYED}/about`);
      assert.ok(server.requests.every((request) => request.headers.host === new URL(server.origin).host));
    } finally {
      await server.close();
    }
  });

  it('with the deployed address: a hidden share menu that shares the deployed page is the site\'s own, a hidden channel is not (code review A4)', async () => {
    const share = encodeURIComponent(`${DEPLOYED}/post`);
    const body = `<!doctype html><html lang="en"><head><title>Post</title></head><body><h1>Post</h1><div class="share" style="display:none">
<a href="https://www.facebook.com/sharer/sharer.php?u=${share}">Facebook</a><a href="https://wa.me/?text=${share}">WhatsApp</a></div>
<div style="display:none"><a href="https://t.me/casino_bonus?ref=www.example.com">t</a></div></body></html>`;
    const server = await startServer({ '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' }, '/': { headers: { 'content-type': 'text/html' }, body } });
    try {
      const hidden = async (/** @type {object} */ options) => (await run(server.origin, options)).pages[0].security?.hidden_links.map((link) => link.host);
      assert.deepEqual(await hidden({ deployedUrl: DEPLOYED }), ['t.me']);
      assert.deepEqual(await hidden({}), ['facebook.com', 'wa.me', 't.me'], 'without the deployed address the menu shares another site');
    } finally {
      await server.close();
    }
  });

  it('with the deployed address written with a trailing dot: the same origin, the same pages read as local', async () => {
    const server = await startServer(routes());
    try {
      const result = await run(server.origin, { deployedUrl: 'https://www.example.com./' });
      assert.equal(result.options.deployed_origin, DEPLOYED);
      assert.equal(result.options.deployed_localized, 6);
      assert.ok(result.pages.every((p) => p.indexability.indexable));
    } finally {
      await server.close();
    }
  });

  it('without it: every page points away from the audited site and the sitemap is on another host', async () => {
    const server = await startServer(routes());
    try {
      const result = await run(server.origin, {});
      assert.equal('deployed_origin' in result.options, false);
      assert.deepEqual(result.pages.map((p) => p.indexability.reasons), [['canonical_elsewhere'], ['canonical_elsewhere']]);
      assert.deepEqual(result.sitemap.files.map((file) => file.type), ['external']);
      assert.deepEqual(result.sitemap.urls, []);
    } finally {
      await server.close();
    }
  });

  it('with an address the pages do not name, nothing is read as local and the crawl says so with a count of 0', async () => {
    const server = await startServer(routes());
    try {
      for (const deployedUrl of ['http://www.example.com', 'https://example.com']) {
        const result = await run(server.origin, { deployedUrl });
        assert.deepEqual([result.options.deployed_origin, result.options.deployed_localized], [deployedUrl, 0]);
        assert.deepEqual(result.pages.map((p) => p.indexability.reasons), [['canonical_elsewhere'], ['canonical_elsewhere']]);
      }
    } finally {
      await server.close();
    }
  });

  it('a robots.txt on the local server that redirects to another host is not followed there', async () => {
    /** @type {string[]} */
    const asked = [];
    const { safeFetch } = await import('../../plugin/server/src/net/safe-fetch.js');
    const server = await startServer({ ...routes(), '/robots.txt': { status: 302, redirect: `${DEPLOYED}/robots.txt` } });
    try {
      const manager = createCrawlManager({
        dataDir: await tempDir(),
        sleep: async () => {},
        fetch: /** @type {typeof safeFetch} */ (async (url, options) => {
          asked.push(url);
          if (!url.startsWith(server.origin)) throw new Error(`request left the local server: ${url}`);
          return safeFetch(url, options);
        }),
      });
      const job = await manager.start({ url: `${server.origin}/`, allowLoopback: true, deployedUrl: DEPLOYED });
      const done = await manager.wait(job.id, 30_000);
      // Nobody could read the rules, so the crawl stops, as it does for any robots.txt that cannot be read.
      assert.deepEqual([done?.status, done?.blocked?.reason], ['blocked', 'robots_unreachable']);
      assert.deepEqual(asked, [`${server.origin}/robots.txt`]);
    } finally {
      await server.close();
    }
  });

  it('a sitemap on the local server that redirects to another host is not followed there either', async () => {
    /** @type {string[]} */
    const asked = [];
    const { safeFetch } = await import('../../plugin/server/src/net/safe-fetch.js');
    const server = await startServer({ ...routes(), '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' }, '/sitemap.xml': { status: 301, redirect: 'https://cdn.example.net/sitemap.xml' } });
    try {
      const manager = createCrawlManager({
        dataDir: await tempDir(),
        sleep: async () => {},
        fetch: /** @type {typeof safeFetch} */ (async (url, options) => {
          asked.push(url);
          if (!url.startsWith(server.origin)) throw new Error(`request left the local server: ${url}`);
          return safeFetch(url, options);
        }),
      });
      const job = await manager.start({ url: `${server.origin}/`, allowLoopback: true });
      assert.equal((await manager.wait(job.id, 30_000))?.status, 'done');
      assert.ok(asked.length > 0 && asked.every((url) => url.startsWith(server.origin)));
    } finally {
      await server.close();
    }
  });

  it('naming the local server itself changes nothing', async () => {
    const server = await startServer(routes());
    try {
      const result = await run(server.origin, { deployedUrl: server.origin });
      assert.equal('deployed_origin' in result.options, false);
    } finally {
      await server.close();
    }
  });
});

describe('deployedUrl on start', () => {
  it('is refused for a crawl that is not of a local site, and for a value that is not a URL', async () => {
    const manager = createCrawlManager({ dataDir: await tempDir(), sleep: async () => {} });
    await assert.rejects(async () => manager.start({ url: 'https://example.test/', deployedUrl: DEPLOYED }), (error) => error instanceof TypeError && /deployedUrl is for a crawl of a site on this machine/.test(error.message));
    await assert.rejects(async () => manager.start({ url: 'http://127.0.0.1:9/', allowLoopback: true, deployedUrl: 'nonsense' }), (error) => error instanceof TypeError && /is not an http or https URL/.test(error.message));
  });
});

describe('links to the deployed address in a crawl of a local server', () => {
  const html = (/** @type {string} */ path, /** @type {string[]} */ links) => ({
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: `<!doctype html><html lang="en"><head><title>Page ${path}</title></head><body><h1>${path}</h1>${links.map((href) => `<a href="${href}">link</a>`).join('')}</body></html>`,
  });
  const routes = () => ({
    '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' },
    '/': html('/', [`${DEPLOYED}/linked-in-full`, 'http://www.example.com/other-scheme', 'https://example.com/no-www', 'https://www.example.com:8443/other-port']),
    '/linked-in-full': html('/linked-in-full', ['/']),
    '/other-scheme': html('/other-scheme', []),
    '/no-www': html('/no-www', []),
    '/other-port': html('/other-port', []),
  });

  /** Crawl with the real fetch, recording every URL the crawl asks it for. @param {string} origin @param {object} options */
  async function run(origin, options) {
    /** @type {string[]} */
    const requested = [];
    /** @type {typeof safeFetch} */
    const fetch = (url, fetchOptions) => {
      requested.push(url);
      return safeFetch(url, fetchOptions);
    };
    const manager = createCrawlManager({ dataDir: await tempDir(), sleep: async () => {}, fetch });
    const job = await manager.start({ url: `${origin}/`, allowLoopback: true, ...options });
    const done = await manager.wait(job.id, 30_000);
    assert.equal(done?.status, 'done', done?.error ?? '');
    const result = await manager.result(job.id);
    assert.ok(result);
    return { result, requested };
  }

  it('with the deployed address: a page linked only by its full deployed URL is crawled as a local page, and nothing else is requested', async () => {
    const server = await startServer(routes());
    try {
      const { result, requested } = await run(server.origin, { deployedUrl: DEPLOYED });
      assert.deepEqual(result.pages.map((p) => new URL(p.url).pathname), ['/', '/linked-in-full']);
      const home = result.pages[0];
      assert.deepEqual(home.links.map((link) => [link.href, link.url, link.internal]), [
        [`${DEPLOYED}/linked-in-full`, `${server.origin}/linked-in-full`, true],
        ['http://www.example.com/other-scheme', 'http://www.example.com/other-scheme', false],
        ['https://example.com/no-www', 'https://example.com/no-www', false],
        ['https://www.example.com:8443/other-port', 'https://www.example.com:8443/other-port', false],
      ]);
      assert.equal(result.pages[1].depth, 1);
      assert.equal(result.options.deployed_localized, 1, 'the home page named the deployed address');
      assert.ok(requested.length > 0 && requested.every((url) => url.startsWith(`${server.origin}/`)), requested.join(' '));
    } finally {
      await server.close();
    }
  });

  it('without it: that page is not crawled and the link stays a link to another site', async () => {
    const server = await startServer(routes());
    try {
      const { result, requested } = await run(server.origin, {});
      assert.deepEqual(result.pages.map((p) => new URL(p.url).pathname), ['/']);
      assert.deepEqual(result.pages[0].links.map((link) => link.internal), [false, false, false, false]);
      assert.ok(requested.every((url) => url.startsWith(`${server.origin}/`)), requested.join(' '));
    } finally {
      await server.close();
    }
  });
});
