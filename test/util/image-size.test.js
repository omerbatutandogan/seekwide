import assert from 'node:assert/strict';
import { test } from 'node:test';

import { imageSize } from '../../plugin/server/src/util/image-size.js';

/** @param {number[]} bytes */
const b = (bytes) => Uint8Array.from(bytes);
/** @param {string} text */
const ascii = (text) => [...text].map((char) => char.charCodeAt(0));
/** @param {number} value */
const be32 = (value) => [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255];
/** @param {number} value */
const le16 = (value) => [value & 255, (value >>> 8) & 255];
/** @param {number} value */
const le24 = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255];

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

test('PNG: the size is in the IHDR chunk, the first after the signature', () => {
  const head = b([...PNG, ...be32(13), ...ascii('IHDR'), ...be32(1200), ...be32(630), 8, 6, 0, 0, 0]);
  assert.deepEqual(imageSize(head), { format: 'png', width: 1200, height: 630 });
  assert.equal(imageSize(b([...PNG, ...be32(13), ...ascii('IDAT'), ...be32(1), ...be32(1)])), null, 'IHDR must come first');
  assert.equal(imageSize(b([...PNG, ...be32(13), ...ascii('IHDR'), ...be32(1200)])), null, 'a cut header');
});

test('GIF: the logical screen size follows the signature, little-endian', () => {
  assert.deepEqual(imageSize(b([...ascii('GIF89a'), ...le16(640), ...le16(480), 0, 0, 0])), { format: 'gif', width: 640, height: 480 });
  assert.deepEqual(imageSize(b([...ascii('GIF87a'), ...le16(16), ...le16(16)])), { format: 'gif', width: 16, height: 16 });
  assert.equal(imageSize(b([...ascii('GIF89a'), ...le16(0), ...le16(10)])), null, 'a side of 0 is no size');
});

test('WebP: extended (VP8X), lossless (VP8L) and lossy (VP8 ) headers', () => {
  const riff = (/** @type {string} */ chunk) => [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), 0, 0, 0, 0];
  assert.deepEqual(imageSize(b([...riff('VP8X'), 0, 0, 0, 0, ...le24(1199), ...le24(629)])), { format: 'webp', width: 1200, height: 630 });
  // VP8L: signature 0x2f, then 14 bits of width - 1 and 14 bits of height - 1.
  const bits = (1199 & 0x3fff) | ((629 & 0x3fff) << 14);
  assert.deepEqual(imageSize(b([...riff('VP8L'), 0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, (bits >>> 24) & 255])), { format: 'webp', width: 1200, height: 630 });
  // VP8: a 3-byte frame tag, the start code 9d 01 2a, then 14-bit width and height (the top 2 bits are a scale).
  assert.deepEqual(imageSize(b([...riff('VP8 '), 0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...le16(1200 | 0x4000), ...le16(630)])), { format: 'webp', width: 1200, height: 630 });
  assert.equal(imageSize(b([...riff('VP8 '), 0x10, 0x02, 0x00, 0x00, 0x00, 0x00, ...le16(1200), ...le16(630)])), null, 'no start code');
  assert.equal(imageSize(b([...riff('VP8L'), 0x00, 0, 0, 0, 0])), null, 'no lossless signature');
});

/** A JPEG start: SOI, an APP1 (EXIF) segment of `appLength` bytes, then a frame header. */
function jpeg(/** @type {number} */ marker, /** @type {number} */ width, /** @type {number} */ height, appLength = 20) {
  const app = [0xff, 0xe1, ...[(appLength >>> 8) & 255, appLength & 255], ...new Array(appLength - 2).fill(0)];
  return b([0xff, 0xd8, ...app, 0xff, 0xff, marker, 0x00, 0x11, 0x08, ...[(height >>> 8) & 255, height & 255], ...[(width >>> 8) & 255, width & 255], 0x03]);
}

test('JPEG: the frame header after any application segments and fill bytes gives the size', () => {
  assert.deepEqual(imageSize(jpeg(0xc0, 1200, 630)), { format: 'jpeg', width: 1200, height: 630 });
  assert.deepEqual(imageSize(jpeg(0xc2, 800, 418, 4000)), { format: 'jpeg', width: 800, height: 418 }, 'progressive, after a long EXIF segment');
  assert.equal(imageSize(jpeg(0xc4, 1200, 630)), null, 'DHT is not a frame header');
  assert.equal(imageSize(jpeg(0xc0, 1200, 0)), null, 'zero lines: a later marker gives them');
  assert.equal(imageSize(jpeg(0xc0, 1200, 630).subarray(0, 30)), null, 'the frame header is past the bytes given');
  assert.equal(imageSize(b([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0])), null, 'a scan before any frame header');
  assert.equal(imageSize(b([0xff, 0xd8, 0x00, 0x00])), null, 'not a marker');
});

test('anything else has no size, and nothing past the bytes is read', () => {
  assert.equal(imageSize(b(ascii('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'))), null);
  assert.equal(imageSize(b([])), null);
  assert.equal(imageSize(/** @type {any} */ ('GIF89a')), null);
  assert.equal(imageSize(b([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])), null, 'a length past the end');
});
