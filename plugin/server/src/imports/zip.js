// Reading a ZIP archive without a dependency (PKWARE APPNOTE.TXT 6.3.10,
// sections 4.3.6 to 4.3.16): the end of central directory record, the central
// directory, and entries that are stored or deflated. Search Console's CSV
// download and every Excel workbook are such archives. ZIP64, encryption and
// archives split over several disks are refused. Nothing is written to disk:
// an entry is unpacked into memory, and only when its name is asked for.

import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { ImportError, malformed, overLimit } from './errors.js';

const inflateRaw = promisify(zlib.inflateRaw);

export const ZIP_LIMITS = Object.freeze({
  /** Entries one archive may list. Search Console's download holds seven files, a workbook a few dozen. */
  maxEntries: 200,
  /** Unpacked size of one entry that is read. */
  maxEntryBytes: 20 * 1024 * 1024,
  /** Unpacked bytes read from one archive in all, however its entries overlap. */
  maxTotalBytes: 40 * 1024 * 1024,
});

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END_SIZE = 22;
const MAX_COMMENT = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/**
 * The CRC-32 of `bytes` as ZIP stores it (APPNOTE 4.4.7).
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Whether `bytes` starts like a ZIP archive: a local file header, or the end
 * record of an archive with no entries.
 * @param {Buffer} bytes
 * @returns {boolean}
 */
export function looksLikeZip(bytes) {
  return bytes.length >= 4 && (bytes.readUInt32LE(0) === LOCAL || bytes.readUInt32LE(0) === END);
}

/** @typedef {{name: string, method: number, crc: number, compressedSize: number, size: number, offset: number}} ZipEntry */

/**
 * The offset of the end record: the one whose comment ends exactly at the end
 * of the file, searched from the end.
 * @param {Buffer} bytes
 * @returns {number} -1 when there is none.
 */
function findEnd(bytes) {
  const last = bytes.length - END_SIZE;
  for (let at = last; at >= Math.max(0, last - MAX_COMMENT); at -= 1) {
    if (bytes.readUInt32LE(at) === END && at + END_SIZE + bytes.readUInt16LE(at + 20) === bytes.length) return at;
  }
  return -1;
}

/**
 * The entries the central directory lists, checked against the file: each
 * record inside the directory, no name twice, no encryption, no ZIP64 marker.
 * @param {Buffer} bytes
 * @param {{maxEntries: number}} limits
 * @returns {ZipEntry[]}
 */
function readDirectory(bytes, limits) {
  if (bytes.length < END_SIZE) throw malformed('it is too short to be a ZIP archive');
  const end = findEnd(bytes);
  if (end === -1) throw malformed('it has no ZIP end record');
  const total = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0 || bytes.readUInt16LE(end + 8) !== total) {
    throw new ImportError('UNSUPPORTED', 'The archive is split over several files. Download the export again as one file.');
  }
  if (total === 0xffff || size === 0xffffffff || start === 0xffffffff) throw new ImportError('UNSUPPORTED', 'The archive is a ZIP64 archive, which Seekwide does not read. An export is far smaller.');
  if (total > limits.maxEntries) throw overLimit(`the archive lists ${total} files, more than the ${limits.maxEntries} Seekwide reads`);
  if (start + size > end) throw malformed('its ZIP directory lies outside the file');
  /** @type {ZipEntry[]} */
  const entries = [];
  const names = new Set();
  let at = start;
  for (let index = 0; index < total; index += 1) {
    if (at + 46 > start + size || bytes.readUInt32LE(at) !== CENTRAL) throw malformed('its ZIP directory is damaged');
    const flags = bytes.readUInt16LE(at + 8);
    const nameEnd = at + 46 + bytes.readUInt16LE(at + 28);
    const next = nameEnd + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    if (next > start + size) throw malformed('its ZIP directory is damaged');
    if (flags & 0x1) throw new ImportError('UNSUPPORTED', 'The archive is encrypted. Download the export again without a password.');
    // Bit 11 marks a UTF-8 name; anything else is read byte by byte, which keeps an ASCII extension readable.
    const name = bytes.toString(flags & 0x800 ? 'utf8' : 'latin1', at + 46, nameEnd);
    if (names.has(name)) throw malformed('its ZIP directory names one file twice');
    names.add(name);
    const entry = {
      name,
      method: bytes.readUInt16LE(at + 10),
      crc: bytes.readUInt32LE(at + 16),
      compressedSize: bytes.readUInt32LE(at + 20),
      size: bytes.readUInt32LE(at + 24),
      offset: bytes.readUInt32LE(at + 42),
    };
    if (entry.compressedSize === 0xffffffff || entry.size === 0xffffffff || entry.offset === 0xffffffff) {
      throw new ImportError('UNSUPPORTED', 'The archive is a ZIP64 archive, which Seekwide does not read. An export is far smaller.');
    }
    entries.push(entry);
    at = next;
  }
  return entries;
}

/**
 * The packed bytes of one entry, from its local header.
 * @param {Buffer} bytes
 * @param {ZipEntry} entry
 * @returns {Buffer}
 */
function packedData(bytes, entry) {
  if (entry.offset + 30 > bytes.length || bytes.readUInt32LE(entry.offset) !== LOCAL) throw malformed('a file inside the archive has no valid header');
  const start = entry.offset + 30 + bytes.readUInt16LE(entry.offset + 26) + bytes.readUInt16LE(entry.offset + 28);
  if (start + entry.compressedSize > bytes.length) throw malformed('a file inside the archive is cut short');
  return bytes.subarray(start, start + entry.compressedSize);
}

/**
 * @typedef {Object} ZipReader
 * @property {string[]} names  Entry names in directory order. They are data from the file.
 * @property {(name: string) => Promise<Buffer|null>} read  The unpacked entry, or null when the archive has none of that name.
 */

/**
 * Open a ZIP archive held in memory.
 *
 * Guarantees: the directory is read and checked at once; an entry is unpacked
 * only when it is read, to at most the size the directory gives it, which must
 * be within `maxEntryBytes`; all entries read from one archive together unpack
 * to at most `maxTotalBytes`, so an archive whose entries overlap or claim small
 * sizes cannot unpack to more; an unpacked entry must have exactly its stated
 * size and checksum. Every problem is an `ImportError` with a fixed message.
 * @param {Buffer} bytes
 * @param {{maxEntries: number, maxEntryBytes: number, maxTotalBytes: number}} [limits]
 * @returns {ZipReader}
 */
export function openZip(bytes, limits = ZIP_LIMITS) {
  const entries = readDirectory(bytes, limits);
  let budget = limits.maxTotalBytes;
  return {
    names: entries.map((entry) => entry.name),
    async read(name) {
      const entry = entries.find((candidate) => candidate.name === name);
      if (!entry) return null;
      if (entry.size > limits.maxEntryBytes) throw overLimit(`a file inside the archive unpacks to ${Math.ceil(entry.size / 1048576)} MB, more than the ${limits.maxEntryBytes / 1048576} MB Seekwide reads`);
      if (entry.size > budget) throw overLimit(`the archive unpacks to more than the ${limits.maxTotalBytes / 1048576} MB Seekwide reads`);
      budget -= entry.size;
      const packed = packedData(bytes, entry);
      /** @type {Buffer} */
      let data;
      if (entry.method === 0) {
        data = packed;
      } else if (entry.method === 8) {
        try {
          // The output is capped at the stated size: a stream that would unpack to more stops there and fails.
          data = await inflateRaw(packed, { maxOutputLength: Math.max(1, entry.size) });
        } catch {
          throw malformed('a file inside the archive does not unpack to the size the archive states');
        }
      } else {
        throw new ImportError('UNSUPPORTED', 'The archive uses a compression method other than deflate. Download the export again from Search Console or Bing.');
      }
      if (data.length !== entry.size) throw malformed('a file inside the archive does not unpack to the size the archive states');
      if (crc32(data) !== entry.crc) throw malformed('a file inside the archive fails its checksum');
      return data;
    },
  };
}
