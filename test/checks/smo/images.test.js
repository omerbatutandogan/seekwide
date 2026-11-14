import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IMAGE_LIMIT_BYTES, LINKEDIN_IMAGE_BYTES } from '../../../plugin/server/src/checks/smo/helpers.js';
import { SITE } from '../../helpers/factories.js';
import { FULL_OG, audit, counts, findingsFor, sharedPage, sharingFile } from './support.js';

const FILE_CHECKS = ['smo.og.image_broken', 'smo.og.image_too_small', 'smo.og.image_heavy', 'smo.og.image_preview_shape'];
/** @param {string} path @param {string} image @param {object} [og] */
const giving = (path, image, og = {}) => sharedPage(path, { og: { ...FULL_OG, url: `${SITE}${path}`, image, ...og } });

test('the file checks are skipped, with the collector\'s reason, when sharing images were not checked', () => {
  const result = audit([giving('/', `${SITE}/a.png`)], { files: null });
  for (const id of FILE_CHECKS) assert.equal(result.checks.find((stat) => stat.id === id)?.status, 'skipped', id);
});

test('smo.og.image_broken fails a 404 on the first page that gives it, lists the others, and leaves refusals out', () => {
  const result = audit([giving('/b', `${SITE}/gone.png`), giving('/a', `${SITE}/gone.png`), giving('/c', `${SITE}/refused.png`)], {
    files: [
      sharingFile(`${SITE}/gone.png`, { outcome: 'broken', status: 404, reason: 'status_404', size: null }),
      sharingFile(`${SITE}/refused.png`, { outcome: 'unverifiable', status: 403, size: null }),
    ],
  });
  assert.deepEqual(counts(result, 'smo.og.image_broken'), [1, 1]);
  const [finding] = findingsFor(result, 'smo.og.image_broken');
  assert.deepEqual([finding.url, finding.selector, finding.related_urls, finding.severity], [`${SITE}/a`, 'meta[property="og:image"]', [`${SITE}/b`], 'high']);
  assert.deepEqual(finding.evidence.observed, { status: 404, reason: 'status_404' });
});

test('a twitter:image is checked when the page has no og:image, and the selector names it', () => {
  const page = sharedPage('/t', { og: { title: 'T' }, twitter: { image: `${SITE}/tw.png` } });
  const result = audit([page], { files: [sharingFile(`${SITE}/tw.png`, { outcome: 'broken', status: 410, size: null })] });
  assert.equal(findingsFor(result, 'smo.og.image_broken')[0].selector, 'meta[property="twitter:image"]');
});

test('smo.og.image_too_small uses the file\'s size first, else the declared pair, and fails under 200 pixels on a side', () => {
  const result = audit([
    giving('/small', `${SITE}/small.png`),
    giving('/declared', `${SITE}/declared.png`, { 'image:width': '150', 'image:height': '150' }),
    giving('/wrong-declared', `${SITE}/big.png`, { 'image:width': '10', 'image:height': '10' }),
    giving('/unknown', `${SITE}/unknown.svg`, { 'image:width': '', 'image:height': '' }),
  ], {
    files: [
      sharingFile(`${SITE}/small.png`, { size: { format: 'png', width: 1200, height: 199 } }),
      sharingFile(`${SITE}/declared.png`, { outcome: 'unverifiable', status: 403, size: undefined }),
      sharingFile(`${SITE}/big.png`),
      sharingFile(`${SITE}/unknown.svg`, { content_type: 'image/svg+xml', size: null }),
    ],
  });
  assert.deepEqual(counts(result, 'smo.og.image_too_small'), [3, 2], 'the file wins over a wrong declaration; an svg without a declaration has no size');
  const findings = findingsFor(result, 'smo.og.image_too_small');
  assert.deepEqual(findings.map((finding) => finding.evidence.observed), [
    { width: 150, height: 150, from: 'og:image:width and og:image:height' },
    { width: 1200, height: 199, from: 'the file' },
  ]);
});

test('smo.og.image_heavy fails a file over 600 KiB and names LinkedIn and Facebook when it is over their limits', () => {
  const result = audit([giving('/a', `${SITE}/a.png`), giving('/b', `${SITE}/b.png`), giving('/c', `${SITE}/c.png`), giving('/d', `${SITE}/d.png`)], {
    files: [
      sharingFile(`${SITE}/a.png`, { bytes: IMAGE_LIMIT_BYTES }),
      sharingFile(`${SITE}/b.png`, { bytes: IMAGE_LIMIT_BYTES + 1 }),
      sharingFile(`${SITE}/c.png`, { bytes: LINKEDIN_IMAGE_BYTES + 1 }),
      sharingFile(`${SITE}/d.png`, { bytes: null }),
    ],
  });
  assert.deepEqual(counts(result, 'smo.og.image_heavy'), [3, 2]);
  const [b, c] = findingsFor(result, 'smo.og.image_heavy');
  assert.doesNotMatch(b.evidence.detail ?? '', /LinkedIn/);
  assert.match(c.evidence.detail ?? '', /over LinkedIn's 5 MB/);
  assert.doesNotMatch(c.evidence.detail ?? '', /Facebook/);
});

test('smo.og.image_preview_shape (info) names how each platform shows a small or oddly shaped image', () => {
  const result = audit([giving('/fine', `${SITE}/fine.png`), giving('/square', `${SITE}/square.png`), giving('/strip', `${SITE}/strip.png`), giving('/tiny', `${SITE}/tiny.png`)], {
    files: [
      sharingFile(`${SITE}/fine.png`, { size: { format: 'png', width: 1200, height: 630 } }),
      sharingFile(`${SITE}/square.png`, { size: { format: 'png', width: 400, height: 400 } }),
      sharingFile(`${SITE}/strip.png`, { size: { format: 'png', width: 2000, height: 400 } }),
      sharingFile(`${SITE}/tiny.png`, { size: { format: 'png', width: 250, height: 250 } }),
    ],
  });
  assert.deepEqual(counts(result, 'smo.og.image_preview_shape'), [4, 3]);
  const details = Object.fromEntries(findingsFor(result, 'smo.og.image_preview_shape').map((finding) => [new URL(/** @type {string} */ (finding.url)).pathname, finding.evidence.detail]));
  assert.match(details['/square'] ?? '', /Facebook .*LinkedIn .*thumbnail.*1\.00:1/);
  assert.match(details['/strip'] ?? '', /width of at most 4 times the height/);
  assert.match(details['/tiny'] ?? '', /WhatsApp asks for 300 pixels/);
  assert.equal(findingsFor(result, 'smo.og.image_preview_shape')[0].weight, 0);
});
