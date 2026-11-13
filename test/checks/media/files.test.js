import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LARGE_BYTES, LEGACY_MIN_BYTES } from '../../../plugin/server/src/checks/media/files.js';
import { SITE, makePage } from '../../helpers/factories.js';
import { audit, findingsFor, imageFile, mediaImage, mediaPage, statFor } from './support.js';

const BROKEN = 'media.image.broken';
const LEGACY = 'media.image.legacy_format';
const LARGE = 'media.image.large_file';
const ROBOTS = 'media.image.robots_blocked';
const FILE_CHECKS = [BROKEN, LEGACY, LARGE, ROBOTS];

/** @param {string} path @param {Partial<import('../../../plugin/server/src/types.js').ImageRecord>} [overrides] */
const shown = (path, overrides = {}) => mediaImage({ src: path, url: `${SITE}${path}`, ...overrides });

test('the file checks are skipped, with the collector\'s reason, when image files were not checked', () => {
  const result = audit([mediaPage('/', { images: [shown('/a.jpg')] })], { files: null });
  for (const id of FILE_CHECKS) assert.equal(statFor(result, id).status, 'skipped', id);
  assert.match(statFor(result, BROKEN).skip_reason ?? '', /image files/);
});

test(`${BROKEN} fails a file that answers 404, on the first page that shows it, and lists the other pages`, () => {
  const pages = [
    mediaPage('/b', { images: [shown('/gone.jpg', { line: 12 })] }),
    mediaPage('/a', { images: [shown('/gone.jpg', { line: 5 }), shown('/fine.jpg')] }),
    mediaPage('/c', { images: [shown('/gone.jpg')] }),
  ];
  const result = audit(pages, {
    files: [
      imageFile(`${SITE}/gone.jpg`, { outcome: 'broken', status: 404, reason: 'status_404' }),
      imageFile(`${SITE}/fine.jpg`),
      imageFile(`${SITE}/refused.jpg`, { outcome: 'unverifiable', status: 403 }),
    ],
  });
  const stat = statFor(result, BROKEN);
  assert.deepEqual([stat.applicable, stat.failed], [2, 1], 'a refused file and a file no page shows are not units');
  const [finding] = findingsFor(result, BROKEN);
  assert.deepEqual([finding.url, finding.selector, finding.line], [`${SITE}/a`, 'img[src="/gone.jpg"]', 5]);
  assert.deepEqual(finding.related_urls, [`${SITE}/b`, `${SITE}/c`]);
  assert.deepEqual(finding.evidence.observed, { status: 404, reason: 'status_404' });
});

test(`${BROKEN} does not count a file shown only in hidden images or tracking pixels`, () => {
  const result = audit([mediaPage('/', { images: [shown('/px.gif', { width: '1', height: '1', pixel: true })] })], {
    files: [imageFile(`${SITE}/px.gif`, { outcome: 'broken', status: 404 })],
  });
  assert.equal(statFor(result, BROKEN).applicable, 0);
});

test(`${LEGACY} fails a JPEG, PNG or BMP of 32 KiB or more served to a request that accepts AVIF and WebP`, () => {
  const result = audit([mediaPage('/', { images: [shown('/a.jpg'), shown('/b.png'), shown('/c.webp'), shown('/small.jpg'), shown('/d.gif'), shown('/e.svg')] })], {
    files: [
      imageFile(`${SITE}/a.jpg`, { content_type: 'image/jpeg', bytes: LEGACY_MIN_BYTES, vary: 'Accept-Encoding' }),
      imageFile(`${SITE}/b.png`, { content_type: 'image/x-png', bytes: 200_000 }),
      imageFile(`${SITE}/c.webp`, { content_type: 'image/webp', bytes: 200_000 }),
      imageFile(`${SITE}/small.jpg`, { content_type: 'image/jpeg', bytes: LEGACY_MIN_BYTES - 1 }),
      imageFile(`${SITE}/d.gif`, { content_type: 'image/gif', bytes: 900_000 }),
      imageFile(`${SITE}/e.svg`, { content_type: 'image/svg+xml', bytes: 900_000 }),
    ],
  });
  const stat = statFor(result, LEGACY);
  assert.deepEqual([stat.applicable, stat.failed], [3, 2], 'small files, GIF and SVG are not units; WebP passes');
  const [jpeg] = findingsFor(result, LEGACY);
  assert.deepEqual(jpeg.evidence.observed, { content_type: 'image/jpeg', bytes: LEGACY_MIN_BYTES, vary: 'Accept-Encoding' });
  assert.equal(jpeg.confidence, 'likely');
});

test(`${LEGACY} leaves out a file whose server says it varies by Accept or User-Agent: browsers can get another format`, () => {
  const result = audit([mediaPage('/', { images: [shown('/a.jpg'), shown('/b.jpg'), shown('/c.jpg')] })], {
    files: [
      imageFile(`${SITE}/a.jpg`, { content_type: 'image/jpeg', bytes: 100_000, vary: 'Accept' }),
      imageFile(`${SITE}/b.jpg`, { content_type: 'image/jpeg', bytes: 100_000, vary: 'Accept-Encoding, User-Agent' }),
      imageFile(`${SITE}/c.jpg`, { content_type: 'image/jpeg', bytes: 100_000, vary: 'accept-encoding' }),
    ],
  });
  assert.deepEqual([statFor(result, LEGACY).applicable, statFor(result, LEGACY).failed], [1, 1]);
  assert.equal(findingsFor(result, LEGACY)[0].selector, 'img[src="/c.jpg"]');
});

test(`${LEGACY} passes a legacy file that a page offers in WebP or AVIF through <picture>`, () => {
  const result = audit([
    mediaPage('/', { images: [shown('/a.jpg', { modern_source: true, has_srcset: true, picture_sources: true })] }),
    mediaPage('/other', { images: [shown('/a.jpg')] }),
  ], { files: [imageFile(`${SITE}/a.jpg`, { content_type: 'image/jpeg', bytes: 100_000 })] });
  assert.deepEqual([statFor(result, LEGACY).applicable, statFor(result, LEGACY).failed], [1, 0]);
});

test(`${LARGE} lists files over 500 KiB that are shown without srcset, and does not score`, () => {
  const result = audit([mediaPage('/', { images: [shown('/huge.jpg'), shown('/ok.jpg'), shown('/responsive.jpg', { has_srcset: true })] })], {
    files: [
      imageFile(`${SITE}/huge.jpg`, { content_type: 'image/jpeg', bytes: LARGE_BYTES + 1 }),
      imageFile(`${SITE}/ok.jpg`, { content_type: 'image/jpeg', bytes: LARGE_BYTES }),
      imageFile(`${SITE}/responsive.jpg`, { content_type: 'image/jpeg', bytes: 5_000_000 }),
      imageFile(`${SITE}/unknown.jpg`, { bytes: null }),
    ],
  });
  const stat = statFor(result, LARGE);
  assert.deepEqual([stat.applicable, stat.failed], [2, 1]);
  const [finding] = findingsFor(result, LARGE);
  assert.equal(finding.severity, 'info');
  assert.match(finding.evidence.detail ?? '', /501 KiB/);
});

test(`${ROBOTS} fails a file robots.txt keeps from Googlebot or Googlebot-Image, even one the crawler could not request`, () => {
  const result = audit([mediaPage('/', { images: [shown('/a.jpg'), shown('/b.jpg'), shown('/c.jpg'), shown('/d.jpg')] })], {
    files: [
      imageFile(`${SITE}/a.jpg`, { google: 'disallowed', google_agent: 'Googlebot-Image', google_host: 'cdn.example.test' }),
      imageFile(`${SITE}/b.jpg`, { outcome: 'disallowed', google: 'disallowed', google_agent: 'Googlebot', google_host: 'example.test' }),
      imageFile(`${SITE}/c.jpg`),
      imageFile(`${SITE}/d.jpg`, { outcome: 'unverifiable', google: null }),
    ],
  });
  const stat = statFor(result, ROBOTS);
  assert.deepEqual([stat.applicable, stat.failed], [3, 2], 'a file whose robots.txt could not be read is not a unit');
  const [a] = findingsFor(result, ROBOTS);
  assert.deepEqual(a.evidence.observed, { crawler: 'Googlebot-Image', robots_host: 'cdn.example.test' });
  assert.equal(a.confidence, 'likely');
});

test(`${ROBOTS} counts only images on the site's own domain, whose robots.txt the owner can change`, () => {
  const cdn = 'https://images.example.test/a.jpg';
  const other = 'https://photos.thirdparty.test/b.jpg';
  const result = audit([mediaPage('/', { images: [mediaImage({ src: cdn, url: cdn }), mediaImage({ src: other, url: other })] })], {
    files: [
      imageFile(cdn, { google: 'disallowed', google_agent: 'Googlebot', google_host: 'images.example.test' }),
      imageFile(other, { google: 'disallowed', google_agent: 'Googlebot', google_host: 'photos.thirdparty.test' }),
    ],
  });
  assert.deepEqual([statFor(result, ROBOTS).applicable, statFor(result, ROBOTS).failed], [1, 1]);
  assert.equal(findingsFor(result, ROBOTS)[0].selector, `img[src="${cdn}"]`);
});

test(`${ROBOTS} on a shared hosting domain counts only the site's own host, not another customer's or the service's`, () => {
  const site = 'https://acme.vercel.app';
  const own = `${site}/a.jpg`;
  const others = ['https://photos.vercel.app/b.jpg', 'https://vercel.com/c.jpg'];
  const result = audit([makePage({ url: `${site}/`, images: [own, ...others].map((url) => mediaImage({ src: url, url })) })], {
    crawl: { start_url: `${site}/`, site_origin: site, site_host: 'acme.vercel.app' },
    files: [own, ...others].map((url) => imageFile(url, { google: 'disallowed', google_agent: 'Googlebot', google_host: new URL(url).host })),
  });
  assert.deepEqual([statFor(result, ROBOTS).applicable, statFor(result, ROBOTS).failed], [1, 1]);
  assert.equal(findingsFor(result, ROBOTS)[0].selector, `img[src="${own}"]`);
});

test(`${ROBOTS} leaves out a file shown only in the page's frame, such as a badge in the footer`, () => {
  const result = audit([
    mediaPage('/', { images: [shown('/badge.png', { chrome: true })] }),
    mediaPage('/b', { images: [shown('/badge.png', { chrome: true }), shown('/photo.jpg')] }),
  ], {
    files: [
      imageFile(`${SITE}/badge.png`, { google: 'disallowed', google_agent: 'Googlebot', google_host: 'example.test' }),
      imageFile(`${SITE}/photo.jpg`, { google: 'disallowed', google_agent: 'Googlebot', google_host: 'example.test' }),
    ],
  });
  assert.deepEqual([statFor(result, ROBOTS).applicable, statFor(result, ROBOTS).failed], [1, 1]);
  assert.equal(findingsFor(result, ROBOTS)[0].selector, 'img[src="/photo.jpg"]');
});
