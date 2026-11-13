import assert from 'node:assert/strict';
import { test } from 'node:test';

import { placeholderReason } from '../../../plugin/server/src/checks/media/alt.js';
import { reservesSpace } from '../../../plugin/server/src/checks/media/layout.js';
import { SITE, makePage } from '../../helpers/factories.js';
import { audit, findingsFor, mediaImage, mediaPage, statFor } from './support.js';

const MISSING = 'media.image.alt_missing';
const PLACEHOLDER = 'media.image.alt_placeholder';
const SIZE = 'media.image.dimensions_missing';
const LAZY = 'media.image.lazy_priority';

test(`${MISSING} fails a page with an image that has no alt and no other name, and passes one whose images all have one`, () => {
  const result = audit([
    mediaPage('/', { images: [mediaImage({ alt: 'Acme' }), mediaImage({ src: '/logo.svg', alt: null, line: 7 }), mediaImage({ src: '/b.jpg', alt: null })] }),
    mediaPage('/about', { images: [mediaImage({ alt: '' }), mediaImage({ alt: 'Team' })] }),
    mediaPage('/empty', { images: [] }),
  ]);
  const stat = statFor(result, MISSING);
  assert.deepEqual([stat.applicable, stat.failed], [2, 1], 'a page without images is not a unit; an empty alt is a choice');
  const [finding] = findingsFor(result, MISSING);
  assert.deepEqual([finding.url, finding.selector, finding.line], [`${SITE}/`, 'img:not([alt])', 7]);
  assert.deepEqual(finding.evidence.observed, { without_alt: 2, images: 3, examples: ['/logo.svg', '/b.jpg'] });
});

test(`${MISSING} leaves out images that are named otherwise, captioned, hidden from assistive technology, hidden or tracking pixels`, () => {
  const excused = [
    mediaImage({ alt: null, named: true }),
    mediaImage({ alt: null, figure_caption: true }),
    mediaImage({ alt: null, aria_hidden: true }),
    mediaImage({ alt: null, role: 'presentation' }),
    mediaImage({ alt: null, role: 'none' }),
    mediaImage({ alt: null, hidden: true }),
    mediaImage({ alt: null, width: '1', height: '1', pixel: true }),
    mediaImage({ alt: null, width: '0', height: '0', pixel: true }),
  ];
  const result = audit([mediaPage('/', { images: excused })]);
  assert.deepEqual([statFor(result, MISSING).applicable, statFor(result, MISSING).failed], [1, 0]);
  const unexcused = audit([mediaPage('/', { images: [mediaImage({ alt: null, role: 'img' }), mediaImage({ alt: null, chrome: true })] })]);
  assert.equal(findingsFor(unexcused, MISSING)[0].evidence.observed.without_alt, 2, 'another role, and a logo in the header, still need alt');
});

test('records made before the media module are not units of its checks', () => {
  const old = makePage({ images: [mediaImage({ alt: null })] });
  delete old.videos;
  const result = audit([old]);
  for (const id of [MISSING, PLACEHOLDER, SIZE, LAZY]) assert.equal(statFor(result, id).applicable, 0, id);
});

test(`${PLACEHOLDER} fails alt text that is a file name, a number or a placeholder, and passes a description`, () => {
  const result = audit([
    mediaPage('/', { images: [mediaImage({ alt: 'Sales in October' }), mediaImage({ src: '/c.jpg', alt: ' Chart.JPG ', line: 3 })] }),
    mediaPage('/fine', { images: [mediaImage({ alt: 'Team' }), mediaImage({ alt: '' })] }),
  ]);
  const stat = statFor(result, PLACEHOLDER);
  assert.deepEqual([stat.applicable, stat.failed], [2, 1]);
  const [finding] = findingsFor(result, PLACEHOLDER);
  assert.deepEqual([finding.selector, finding.line], ['img[alt]', 3]);
  assert.deepEqual(finding.evidence.observed, { placeholder_alts: 1, images_with_alt: 2, examples: [{ src: '/c.jpg', alt: 'Chart.JPG' }] });
  assert.match(finding.evidence.detail ?? '', /a file name/);
});

test('placeholder alt text follows WCAG F30 and the file name rule', () => {
  /** @param {string} alt @param {string} [src] */
  const reason = (alt, src = '/img/photo.jpg') => placeholderReason(mediaImage({ alt, src, url: `${SITE}${src}` }));
  for (const alt of ['image', 'Picture 1', 'picture-2', 'spacer', 'PHOTO', 'alt text', 'img_0001']) assert.equal(reason(alt), 'a placeholder', alt);
  for (const alt of ['0001', '2']) assert.equal(reason(alt), 'a number', alt);
  for (const alt of ['Oct.jpg', 'sales\\oct\\top3.jpg', 'banner.webp']) assert.equal(reason(alt), 'a file name', alt);
  assert.equal(reason('DSC_0423', '/uploads/DSC_0423.jpeg'), 'the file name');
  // A brand name written as a brand is not the file name, even when the file is named after it.
  assert.equal(reason('Coca-Cola', '/logos/coca-cola.svg'), null);
  assert.equal(reason('7-Eleven', '/logos/7-eleven.svg'), null);
  assert.equal(reason('3M', '/logos/3m.svg'), null);
  assert.equal(reason('coca-cola', '/logos/coca-cola.svg'), 'the file name', 'the file name copied as it is');
  assert.equal(reason('IMG_0423', '/uploads/IMG_0423.jpeg'), 'a placeholder', 'a camera name that starts with a placeholder word is caught first');
  assert.equal(reason('hero-banner-2', '/hero-banner-2.png?w=800'), 'the file name');
  assert.equal(reason('Team', '/team.jpg'), null, 'a readable file name is a fair alt');
  assert.equal(reason('Photo of the team at the 2024 summit'), null);
  assert.equal(reason('Images and words'), null);
  assert.equal(reason('hero', '/hero-banner-2.png'), null);
});

test(`${SIZE} fails a page with an image that reserves no space, and passes one whose images have sizes or a sizing style`, () => {
  const result = audit([
    mediaPage('/', { images: [mediaImage(), mediaImage({ src: '/no-size.jpg', width: null, height: '300', line: 9 })] }),
    mediaPage('/styled', { images: [mediaImage({ width: null, height: null, style_sized: true }), mediaImage({ width: '100px', height: '50' })] }),
  ]);
  const stat = statFor(result, SIZE);
  assert.deepEqual([stat.applicable, stat.failed], [2, 1]);
  const [finding] = findingsFor(result, SIZE);
  assert.deepEqual([finding.url, finding.selector, finding.line, finding.confidence, finding.severity], [`${SITE}/`, 'img:not([width][height])', 9, 'likely', 'info']);
  assert.deepEqual(finding.evidence.observed, { without_size: 1, images: 2, examples: ['/no-size.jpg'] });
});

test(`${SIZE} counts aria-hidden images, which still take space, and leaves out hidden images and pixels`, () => {
  const result = audit([mediaPage('/', { images: [mediaImage({ width: null, aria_hidden: true }), mediaImage({ width: null, hidden: true }), mediaImage({ width: '1', height: '1', pixel: true })] })]);
  assert.deepEqual(findingsFor(result, SIZE)[0].evidence.observed, { without_size: 1, images: 1, examples: ['/img/photo.jpg'] });
  const repeated = audit([mediaPage('/', { images: [mediaImage({ src: '/py.svg', width: null }), mediaImage({ src: '/py.svg', width: null })] })]);
  assert.deepEqual(findingsFor(repeated, SIZE)[0].evidence.observed, { without_size: 2, images: 2, examples: ['/py.svg'] }, 'an image shown twice is one example');
  assert.equal(reservesSpace(mediaImage({ width: 'auto', height: '10' })), false);
  assert.equal(reservesSpace(mediaImage({ width: ' 10', height: '10.5' })), true);
  assert.equal(reservesSpace(mediaImage({ width: null, height: null, class_sized: true })), true);
});

test(`${SIZE} looks only at images in the page's content, not in its navigation, header, footer or sidebar`, () => {
  const result = audit([
    mediaPage('/', { images: [mediaImage({ src: '/logo.svg', width: null, chrome: true }), mediaImage({ src: '/photo.jpg', width: null })] }),
    mediaPage('/chrome-only', { images: [mediaImage({ src: '/logo.svg', width: null, chrome: true })] }),
  ]);
  const stat = statFor(result, SIZE);
  assert.deepEqual([stat.applicable, stat.failed], [1, 1], 'a page whose only images are in its frame is not a unit');
  assert.deepEqual(findingsFor(result, SIZE)[0].evidence.observed, { without_size: 1, images: 1, examples: ['/photo.jpg'] });
});

test(`${LAZY} fails an image marked as the page's main image that is also lazy-loaded`, () => {
  const result = audit([
    mediaPage('/', { images: [mediaImage({ src: '/hero.jpg', fetchpriority: 'high', loading: ' LAZY ', line: 4 }), mediaImage({ loading: 'lazy' })] }),
    mediaPage('/preloaded', { images: [mediaImage({ preloaded: true, loading: 'lazy' })] }),
    mediaPage('/eager', { images: [mediaImage({ fetchpriority: 'high', loading: 'eager' }), mediaImage({ loading: 'lazy' })] }),
    mediaPage('/plain', { images: [mediaImage({ loading: 'lazy' })] }),
  ]);
  const stat = statFor(result, LAZY);
  assert.deepEqual([stat.applicable, stat.failed], [3, 2], 'a page that marks no image as its main one is not a unit');
  const [home, preloaded] = findingsFor(result, LAZY);
  assert.deepEqual([home.url, home.selector, home.line], [`${SITE}/`, 'img[loading=lazy]', 4]);
  assert.deepEqual(home.evidence.observed, { lazy_main_images: 1, examples: [{ src: '/hero.jpg', fetchpriority: 'high', preloaded: false }] });
  assert.match(preloaded.evidence.detail ?? '', /preloading/);
});
