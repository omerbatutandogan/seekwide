// Sitemaps built to cost memory or time: each limit has a case it stops and a case it leaves alone.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import zlib from 'node:zlib';

import { loadSitemaps } from '../../plugin/server/src/net/sitemap.js';
import { scanSitemap } from '../../plugin/server/src/net/sitemap-scan.js';
import { fakeFetch } from './fake-fetch.js';

const S = 'https://site.test';
const HEAD = '<?xml version="1.0"?>';

/** CPU time of this process in milliseconds; a busy machine does not change it. */
const cpuMs = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

test('a gzip file that unpacks to more than the protocol allows is not read, a small one is', async () => {
  const bomb = zlib.gzipSync(Buffer.from(`${HEAD}<urlset>${'<a>'.repeat(18 * 1024 * 1024)}`), { level: 9 });
  const small = zlib.gzipSync(Buffer.from(`${HEAD}<urlset><url><loc>${S}/a</loc></url></urlset>`));
  const { fetch } = fakeFetch({ [`${S}/big.xml.gz`]: { body: bomb }, [`${S}/small.xml.gz`]: { body: small } });
  const result = await loadSitemaps([`${S}/big.xml.gz`, `${S}/small.xml.gz`], { fetch });
  assert.equal(result.files[0].type, 'invalid');
  assert.match(String(result.files[0].error), /unpacks to more than 50 MB/);
  assert.deepEqual(result.urls, [`${S}/a`]);
});

test('nested elements in a compressed file stop the scan at once, without the memory they used to take', async () => {
  // 50 MiB of nested elements in a 50 KiB download took 1.2 GB of memory.
  const nested = zlib.gzipSync(Buffer.from(`${HEAD}<urlset>${'<a>'.repeat(16 * 1024 * 1024)}`), { level: 9 });
  const { fetch } = fakeFetch({ [`${S}/nested.xml.gz`]: { body: nested } });
  const before = process.memoryUsage().rss;
  const result = await loadSitemaps([`${S}/nested.xml.gz`], { fetch });
  assert.match(String(result.files[0].error), /nested more than 16 deep/);
  assert.ok(process.memoryUsage().rss - before < 400 * 1024 * 1024);
});

test('a valid compressed sitemap of 50,000 addresses is read', async () => {
  const locs = Array.from({ length: 50_000 }, (_, i) => `<url><loc>${S}/products/item-${i}-${'x'.repeat(150)}</loc></url>`).join('');
  const body = zlib.gzipSync(Buffer.from(`${HEAD}<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs}</urlset>`));
  const { fetch } = fakeFetch({ [`${S}/sitemap.xml.gz`]: { body } });
  const result = await loadSitemaps([`${S}/sitemap.xml.gz`], { fetch });
  assert.deepEqual([result.files[0].type, result.files[0].count, result.urls.length], ['urlset', 50_000, 5000]);
});

test('elements nested deeper than any sitemap make the file invalid', () => {
  assert.match(String(scanSitemap(`${HEAD}<urlset>${'<a>'.repeat(100)}`, { partial: true }).error), /nested more than 16 deep/);
  const images = `${HEAD}<urlset xmlns:image="x"><url><loc>${S}/a</loc><image:image><image:loc>${S}/i.png</image:loc></image:image></url></urlset>`;
  assert.deepEqual(scanSitemap(images).locs, [`${S}/a`]);
});

test('an index that names tens of thousands of files is listed only in part, and quickly', async () => {
  // 97,000 children on other hosts took 5 s and were all kept in the result.
  const children = Array.from({ length: 50_000 }, (_, i) => `<sitemap><loc>https://other${i}.test/s.xml</loc></sitemap>`).join('');
  const { fetch } = fakeFetch({ [`${S}/index.xml`]: { text: `${HEAD}<sitemapindex>${children}</sitemapindex>` } });
  const started = cpuMs();
  const result = await loadSitemaps([`${S}/index.xml`], { fetch, siteHost: 'site.test' });
  assert.ok(cpuMs() - started < 5000, `took ${cpuMs() - started} ms`);
  assert.equal(result.files.length, 100);
  assert.equal(result.truncated, true);
});

test('an index with a few children is read as before', async () => {
  const child = (/** @type {string} */ name) => `<sitemap><loc>${S}/${name}.xml</loc></sitemap>`;
  const { fetch } = fakeFetch({
    [`${S}/index.xml`]: { text: `${HEAD}<sitemapindex>${child('a')}${child('b')}</sitemapindex>` },
    [`${S}/a.xml`]: { text: `${HEAD}<urlset><url><loc>${S}/1</loc></url></urlset>` },
    [`${S}/b.xml`]: { text: `${HEAD}<urlset><url><loc>${S}/2</loc></url></urlset>` },
  });
  const result = await loadSitemaps([`${S}/index.xml`], { fetch });
  assert.deepEqual([result.files.length, result.urls, result.truncated], [3, [`${S}/1`, `${S}/2`], false]);
});

test('a loc too long to be a URL is dropped without keeping its text', () => {
  const scan = scanSitemap(`${HEAD}<urlset><url><loc>${S}/${'x'.repeat(1024 * 1024)}</loc></url><url><loc>${S}/ok</loc></url></urlset>`);
  assert.deepEqual(scan.locs, ['', `${S}/ok`]);
});
