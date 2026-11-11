#!/usr/bin/env node
// Draws the plugin icon (.claude-plugin/icon.png) without an image library, so
// the icon has a readable source and can be regenerated or restyled.
//
// Usage: node scripts/make-icon.js
//
// The icon is a 512 x 512 PNG: a lens with a handle on a dark square.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const SIZE = 512;
const SAMPLES = 4; // 4 x 4 samples per pixel for smooth edges

const BACKGROUND = [15, 23, 42]; // slate
const FOREGROUND = [248, 250, 252]; // near white
const ACCENT = [45, 212, 191]; // teal

const LENS = { x: 226, y: 226, radius: 118, stroke: 44 };
const PUPIL = { x: 226, y: 226, radius: 36 };
const HANDLE = { x1: 322, y1: 322, x2: 408, y2: 408, radius: 25 };

/**
 * Distance from a point to a line segment.
 * @param {number} px @param {number} py
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @returns {number}
 */
function segmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/**
 * Color of one sample point.
 * @param {number} x @param {number} y
 * @returns {number[]} RGB
 */
function colorAt(x, y) {
  if (Math.hypot(x - PUPIL.x, y - PUPIL.y) <= PUPIL.radius) return ACCENT;
  const ring = Math.abs(Math.hypot(x - LENS.x, y - LENS.y) - LENS.radius) <= LENS.stroke / 2;
  const handle = segmentDistance(x, y, HANDLE.x1, HANDLE.y1, HANDLE.x2, HANDLE.y2) <= HANDLE.radius;
  return ring || handle ? FOREGROUND : BACKGROUND;
}

// One filter byte per row, then RGBA for every pixel.
const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (1 + SIZE * 4);
  raw[rowStart] = 0;
  for (let x = 0; x < SIZE; x += 1) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let sy = 0; sy < SAMPLES; sy += 1) {
      for (let sx = 0; sx < SAMPLES; sx += 1) {
        const color = colorAt(x + (sx + 0.5) / SAMPLES, y + (sy + 0.5) / SAMPLES);
        r += color[0];
        g += color[1];
        b += color[2];
      }
    }
    const offset = rowStart + 1 + x * 4;
    const count = SAMPLES * SAMPLES;
    raw[offset] = Math.round(r / count);
    raw[offset + 1] = Math.round(g / count);
    raw[offset + 2] = Math.round(b / count);
    raw[offset + 3] = 255;
  }
}

/**
 * One PNG chunk: length, type, data, CRC of type and data.
 * @param {string} type Four-letter chunk type.
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
header[10] = 0; // deflate
header[11] = 0; // adaptive filtering
header[12] = 0; // no interlace

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.claude-plugin', 'icon.png');
writeFileSync(target, png);
process.stdout.write(`Wrote ${target} (${png.length} bytes)\n`);
