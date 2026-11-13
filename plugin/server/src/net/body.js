// Reading a response body with decompression and a size limit. Used by safe-fetch.

import { Transform } from 'node:stream';
import zlib from 'node:zlib';

/** @import { IncomingMessage } from 'node:http' */

/**
 * A deflate decoder that accepts both zlib-wrapped and raw deflate streams,
 * because servers send both under `Content-Encoding: deflate`.
 * @returns {Transform}
 */
function createDeflateDecoder() {
  /** @type {zlib.Inflate|zlib.InflateRaw|null} */
  let inner = null;
  const outer = new Transform({
    transform(chunk, _encoding, callback) {
      if (inner === null) {
        // A zlib header has compression method 8 in the low nibble and a header checksum divisible by 31.
        const wrapped = chunk.length >= 2 && (chunk[0] & 0x0f) === 8 && ((chunk[0] << 8) | chunk[1]) % 31 === 0;
        inner = wrapped ? zlib.createInflate() : zlib.createInflateRaw();
        inner.on('data', (data) => outer.push(data));
        inner.on('error', (error) => outer.destroy(error));
      }
      inner.write(chunk, callback);
    },
    flush(callback) {
      if (inner === null) {
        callback();
        return;
      }
      inner.once('end', () => callback());
      inner.end();
    },
  });
  outer.on('close', () => inner?.destroy());
  return outer;
}

/**
 * @param {string|undefined} contentEncoding
 * @returns {import('node:stream').Duplex|null} A decoder, or null when the body is used as it is.
 */
function createDecoder(contentEncoding) {
  const encoding = (contentEncoding ?? '').trim().toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return zlib.createGunzip();
  if (encoding === 'deflate') return createDeflateDecoder();
  if (encoding === 'br') return zlib.createBrotliDecompress();
  return null;
}

/**
 * Read the (decompressed) body of `res`, keeping at most `maxBytes`.
 *
 * Resolves with the body and whether it was cut. Rejects with the underlying
 * error when the connection breaks or the compressed data is invalid, and with
 * `signal.reason` when the signal aborts. Always releases the socket.
 *
 * @param {IncomingMessage} res
 * @param {number} maxBytes
 * @param {AbortSignal} signal
 * @returns {Promise<{body: Buffer, truncated: boolean}>}
 */
export function readBody(res, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    const decoder = createDecoder(res.headers['content-encoding']);
    const source = decoder ?? res;
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    let settled = false;

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      if (decoder) {
        res.unpipe(decoder);
        decoder.destroy();
      }
      res.destroy();
    };
    /** @param {boolean} truncated */
    const finish = (truncated) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ body: Buffer.concat(chunks, total), truncated });
    };
    /** @param {unknown} error */
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(signal.reason);

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort);

    source.on('data', (/** @type {Buffer} */ chunk) => {
      if (settled) return;
      if (total + chunk.length > maxBytes) {
        const room = maxBytes - total;
        if (room > 0) chunks.push(chunk.subarray(0, room));
        total += Math.max(0, room);
        finish(true);
        return;
      }
      chunks.push(chunk);
      total += chunk.length;
    });
    source.on('end', () => finish(false));
    source.on('error', fail);
    if (decoder) {
      res.on('error', fail);
      res.on('aborted', () => fail(new Error('connection closed before the body was complete')));
      res.pipe(decoder);
    } else {
      res.on('aborted', () => fail(new Error('connection closed before the body was complete')));
    }
  });
}
