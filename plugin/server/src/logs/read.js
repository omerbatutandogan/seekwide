// Reading access log files the user names, inside the project folder, with the
// rules of an export file (`imports/read-file.js`): no link followed, no
// network path, a size limit checked before anything is read. A file may be
// plain text or gzip, as log rotation leaves it. Lines are read as a stream,
// so a large log never sits in memory whole, and the event loop is given back
// between chunks, so other tool calls are served meanwhile.

/** @import { LogSummary } from './summary.js' */

import { createInterface } from 'node:readline';
import { Transform, pipeline } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { ImportError } from '../imports/errors.js';
import { openImportFile } from '../imports/read-file.js';
import { parseLogLine } from './parse.js';

/** The largest log file read, compressed or not. */
export const LOG_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** The most a gzip file may unpack to. */
export const LOG_MAX_UNPACKED_BYTES = 8 * 1024 * 1024 * 1024;
/** Files one import reads. */
export const LOG_MAX_FILES = 20;

const WHAT = 'log file';

/**
 * Stops a stream once more than `max` bytes went through it.
 * @param {number} max
 */
function byteLimit(max) {
  let seen = 0;
  return new Transform({
    transform(chunk, _encoding, done) {
      seen += chunk.length;
      if (seen > max) done(new ImportError('LIMIT', `A gzip file unpacks to more than ${max / 1073741824} GB, the most Seekwide reads from one file. Import the files of fewer days.`));
      else done(null, chunk);
    },
  });
}

/**
 * Read one log file into `summary`.
 * @param {string} projectDir
 * @param {string} input  Absolute, or relative to the project folder.
 * @param {LogSummary} summary
 * @returns {Promise<{path: string, bytes: number, gzip: boolean}>}
 * @throws {ImportError}
 */
export async function readLogFile(projectDir, input, summary) {
  const { handle, size, relative } = await openImportFile(projectDir, input, LOG_MAX_BYTES, WHAT);
  let gzip = false;
  try {
    const head = Buffer.alloc(2);
    await handle.read(head, 0, 2, 0);
    gzip = head[0] === 0x1f && head[1] === 0x8b;
    // Read at most the size seen when it was opened, so a file that grows meanwhile cannot pass the limit.
    const raw = handle.createReadStream({ start: 0, end: size - 1, autoClose: false });
    /** @type {Error|null} */
    let failure = null;
    const fail = (/** @type {Error|null|undefined} */ error) => {
      if (error) failure ??= error;
    };
    // pipeline passes an error of any stage on and destroys the others, so the lines below end with it.
    const text = gzip ? pipeline(raw, createGunzip(), byteLimit(LOG_MAX_UNPACKED_BYTES), fail) : raw;
    raw.on('error', fail);
    const lines = createInterface({ input: text, crlfDelay: Infinity });
    text.on('error', (/** @type {Error} */ error) => {
      fail(error);
      lines.close();
    });
    try {
      for await (const line of lines) {
        if (line === '') continue;
        if (summary.full) {
          summary.add(null);
          break;
        }
        summary.add(parseLogLine(line));
      }
    } catch (error) {
      fail(/** @type {Error} */ (error));
    } finally {
      lines.close();
      raw.destroy();
    }
    // Set by the listeners above, which the type checker does not follow.
    const failed = /** @type {Error|null} */ (failure);
    if (failed !== null) {
      if (failed instanceof ImportError) throw failed;
      throw new ImportError('MALFORMED', gzip
        ? `The file ${relative} could not be read: it is not a complete gzip file. Copy the log file again and import the copy.`
        : `The file ${relative} could not be read.`);
    }
  } finally {
    await handle.close();
  }
  return { path: relative, bytes: size, gzip };
}
