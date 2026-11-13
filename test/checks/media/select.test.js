import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContext, runChecks } from '../../../plugin/server/src/checks/engine.js';
import { checks } from '../../../plugin/server/src/checks/media/index.js';
import { selectImageFiles } from '../../../plugin/server/src/checks/media/select.js';
import { SITE, makeCrawl } from '../../helpers/factories.js';
import { NOW, imageFile, mediaImage, mediaPage } from './support.js';

/** CPU time this process has used, in milliseconds. */
const cpuMs = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

/** @param {string} url */
const shown = (url) => mediaImage({ src: url, url });

test('image files are chosen round by round over the pages in crawl order: every first image before any second one', () => {
  const crawl = makeCrawl({
    pages: [
      mediaPage('/', { images: [shown(`${SITE}/logo.svg`), shown(`${SITE}/home-1.jpg`), shown(`${SITE}/home-2.jpg`)] }),
      mediaPage('/b', { images: [shown(`${SITE}/logo.svg`), shown(`${SITE}/b-1.jpg`)] }),
      mediaPage('/c', { images: [shown('https://cdn.test/c-1.jpg'), shown(`${SITE}/logo.svg`)] }),
    ],
  });
  assert.deepEqual(selectImageFiles(crawl, 4), {
    urls: [`${SITE}/logo.svg`, `${SITE}/b-1.jpg`, 'https://cdn.test/c-1.jpg', `${SITE}/home-1.jpg`],
    images: 5,
  });
  assert.deepEqual(selectImageFiles(crawl, 100).urls.length, 5);
});

test('only rendered images with an http(s) URL on html pages are chosen; a local crawl keeps its own origin', () => {
  const crawl = makeCrawl({
    options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true },
    pages: [
      mediaPage('/', {
        images: [
          shown(`${SITE}/a.jpg`), shown('https://cdn.test/b.jpg'), mediaImage({ src: 'data:image/gif;base64,R0', url: null }),
          mediaImage({ src: '/px.gif', url: `${SITE}/px.gif`, pixel: true }), mediaImage({ src: '/h.jpg', url: `${SITE}/h.jpg`, hidden: true }),
        ],
      }),
      mediaPage('/404', { status: 404, images: [shown(`${SITE}/err.jpg`)] }),
    ],
  });
  assert.deepEqual(selectImageFiles(crawl), { urls: [`${SITE}/a.jpg`], images: 2 });
});

test('a site that refused the crawler gets no image request on any host of its organisation or under its name (security review F6)', () => {
  // Before 0.1.1 only the exact host was left out: the apex, the subdomains and another port still got requests.
  const site = ['https://www.example.test/a.jpg', 'https://example.test/b.jpg', 'https://static.example.test/c.jpg', 'https://www.example.test:8443/d.jpg'];
  const crawl = makeCrawl({
    site_host: 'www.example.test', site_origin: 'https://www.example.test',
    pages: [mediaPage('/', { images: [...site, 'https://cdn.test/e.jpg', 'https://example.xyz/f.jpg'].map(shown) })],
  });
  // The same name under another ending may be the same organisation's server, linked or not: it is left alone too.
  assert.deepEqual(selectImageFiles(crawl, 50, true), { urls: ['https://cdn.test/e.jpg'], images: 6 });
  assert.deepEqual(selectImageFiles(crawl, 50, false).urls.length, 6);
});

test('the media checks stay fast on 500 pages of 2,000 images each', () => {
  const images = Array.from({ length: 2000 }, (_, i) => mediaImage({ src: `/i/${i}.jpg`, url: `${SITE}/i/${i}.jpg`, alt: i % 2 === 0 ? null : 'IMG_1' }));
  const pages = Array.from({ length: 500 }, (_, i) => mediaPage(`/p/${i}`, { images }));
  const crawl = makeCrawl({ pages });
  const start = cpuMs();
  const { urls } = selectImageFiles(crawl);
  const files = urls.map((url) => imageFile(url, { content_type: 'image/jpeg', bytes: 900_000 }));
  const result = runChecks(checks, buildContext(crawl, { imageFiles: new Map(files.map((file) => [file.url, file])) }), { modules: ['media'], detectedAt: NOW });
  const spent = cpuMs() - start;
  assert.equal(urls.length, 50);
  assert.equal(result.findings.filter((finding) => finding.check_id === 'media.image.alt_missing').length, 500);
  assert.ok(spent < 15_000, `took ${spent} ms of CPU time`);
});
