// The pixel size of an image from the first bytes of its file: PNG, GIF,
// WebP and JPEG. Pure; reads only the bytes it is given.
//
// Layouts, read on 2026-11-13:
// - PNG (https://www.w3.org/TR/png-3/, 5.2 and 11.2.1): an 8-byte signature,
//   then the IHDR chunk first: length (4), type "IHDR" (4), width (4), height
//   (4), big-endian.
// - GIF (https://www.w3.org/Graphics/GIF/spec-gif89a.txt, 17 and 18):
//   "GIF87a" or "GIF89a", then the Logical Screen Width and Height, 2 bytes
//   each, little-endian.
// - WebP (RFC 9649): "RIFF", size, "WEBP", then the first chunk. 'VP8X'
//   (2.7): canvas width and height minus one, 24 bits each, little-endian, at
//   bytes 24 and 27. 'VP8L' (3.2.1): signature 0x2f at byte 20, then 14 bits
//   of width minus one and 14 of height minus one. 'VP8 ': a VP8 key frame
//   (RFC 6386, 9.1): a 3-byte frame tag, the start code 9d 01 2a, then width
//   and height in the low 14 bits of two little-endian 16-bit values.
// - JPEG (ITU-T T.81, B.1.1.2 to B.2.2): markers are 0xFF and a code, any
//   number of 0xFF fill bytes may come before one, and every marker but SOI,
//   EOI, RSTm and TEM is followed by a 2-byte length that counts itself. A
//   start-of-frame marker (C0–C3, C5–C7, C9–CB, CD–CF) has the sample
//   precision (1), the number of lines Y (2) and samples per line X (2). Y = 0
//   means a later marker gives the lines, so the size is not known here.
//   Application segments (EXIF) can come first, which is why more than a few
//   bytes are read.

/**
 * @typedef {Object} ImageSize
 * @property {'png'|'gif'|'webp'|'jpeg'} format
 * @property {number} width   Pixels.
 * @property {number} height  Pixels.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** Start-of-frame markers: every code from C0 to CF except DHT (C4), JPG (C8) and DAC (CC). */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
/** Markers without a length: TEM, RST0–RST7, SOI. */
const NO_LENGTH = new Set([0x01, 0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8]);

/**
 * @param {Uint8Array} bytes @param {number} at @param {string} text
 * @returns {boolean} `text` (ASCII) is at `at`.
 */
const ascii = (bytes, at, text) => bytes.length >= at + text.length && [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0));

/** @param {Uint8Array} b @param {number} at */
const u16le = (b, at) => b[at] | (b[at + 1] << 8);
/** @param {Uint8Array} b @param {number} at */
const u16be = (b, at) => (b[at] << 8) | b[at + 1];
/** @param {Uint8Array} b @param {number} at */
const u24le = (b, at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
/** @param {Uint8Array} b @param {number} at */
const u32be = (b, at) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];

/**
 * @param {'png'|'gif'|'webp'|'jpeg'} format @param {number} width @param {number} height
 * @returns {ImageSize|null}  Null when a side is 0, which no displayable image has.
 */
const size = (format, width, height) => (width > 0 && height > 0 ? { format, width, height } : null);

/** @param {Uint8Array} b @returns {ImageSize|null} */
function png(b) {
  if (b.length < 24 || !ascii(b, 12, 'IHDR')) return null;
  return size('png', u32be(b, 16), u32be(b, 20));
}

/** @param {Uint8Array} b @returns {ImageSize|null} */
function webp(b) {
  if (ascii(b, 12, 'VP8X') && b.length >= 30) return size('webp', u24le(b, 24) + 1, u24le(b, 27) + 1);
  if (ascii(b, 12, 'VP8L') && b.length >= 25 && b[20] === 0x2f) {
    const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
    return size('webp', (bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (ascii(b, 12, 'VP8 ') && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return size('webp', u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  return null;
}

/** @param {Uint8Array} b @returns {ImageSize|null} */
function jpeg(b) {
  let at = 2;
  while (at < b.length) {
    if (b[at] !== 0xff) return null;
    // Fill bytes before a marker.
    while (at < b.length && b[at] === 0xff) at += 1;
    if (at >= b.length) return null;
    const marker = b[at];
    at += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (NO_LENGTH.has(marker)) continue;
    if (at + 2 > b.length) return null;
    const length = u16be(b, at);
    if (length < 2) return null;
    if (SOF.has(marker)) return at + 7 <= b.length ? size('jpeg', u16be(b, at + 5), u16be(b, at + 3)) : null;
    at += length;
  }
  return null;
}

/**
 * The format and pixel size an image file declares in its first bytes, or
 * null when they do not hold it: another format, a damaged or cut header, a
 * side of 0 (a JPEG whose lines a later marker gives), or a frame header past
 * the bytes given. Reads PNG, GIF, WebP (lossy, lossless and extended) and
 * baseline, progressive and lossless JPEG. Never throws, and reads no byte
 * past `bytes.length`.
 * @param {Uint8Array} bytes  The start of the file.
 * @returns {ImageSize|null}
 */
export function imageSize(bytes) {
  if (!(bytes instanceof Uint8Array)) return null;
  if (PNG_SIGNATURE.every((value, i) => bytes[i] === value)) return png(bytes);
  if ((ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')) && bytes.length >= 10) return size('gif', u16le(bytes, 6), u16le(bytes, 8));
  if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return webp(bytes);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpeg(bytes);
  return null;
}
