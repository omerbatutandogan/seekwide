import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { ImportError } from '../../plugin/server/src/imports/errors.js';
import { ZIP_LIMITS, crc32, looksLikeZip, openZip } from '../../plugin/server/src/imports/zip.js';
import { makeZip } from '../helpers/zip.js';

/** CPU time of a call, in milliseconds: user and system time of this process, not wall-clock time. */
async function cpuMs(/** @type {() => Promise<unknown>} */ call) {
  const start = process.cpuUsage();
  await call().catch(() => {});
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
}

/** @param {string} code @param {RegExp} [message] */
const importError = (code, message) => (/** @type {unknown} */ error) =>
  error instanceof ImportError && error.code === code && (message === undefined || message.test(error.message));

describe('crc32', () => {
  it('gives the checksum ZIP stores (the check value of CRC-32)', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
    assert.equal(crc32(Buffer.alloc(0)), 0);
  });
});

describe('openZip', () => {
  it('reads deflated and stored entries by name, and only those asked for', async () => {
    const zip = openZip(makeZip([{ name: 'a.csv', data: 'one,two\n' }, { name: 'b.csv', data: 'stored', method: 0 }]));
    assert.deepEqual(zip.names, ['a.csv', 'b.csv']);
    assert.equal((await zip.read('a.csv'))?.toString(), 'one,two\n');
    assert.equal((await zip.read('b.csv'))?.toString(), 'stored');
    assert.equal(await zip.read('missing.csv'), null);
  });

  it('reads an archive with a comment, and a name that is not UTF-8 byte by byte', async () => {
    const zip = openZip(makeZip([{ name: 'Ülkeler.csv', data: 'x', flags: 0 }], { comment: 'exported' }));
    assert.equal(zip.names.length, 1);
    assert.match(zip.names[0], /\.csv$/);
  });

  it('knows an archive by its first bytes, an empty one included, and nothing else', () => {
    assert.equal(looksLikeZip(makeZip([{ name: 'a', data: 'b' }])), true);
    assert.equal(looksLikeZip(makeZip([])), true);
    assert.equal(looksLikeZip(Buffer.from('Top pages,Clicks\n')), false);
    assert.equal(looksLikeZip(Buffer.from('PK')), false);
  });

  it('refuses a file that is cut short, has no end record, or a damaged directory', () => {
    const good = makeZip([{ name: 'a.csv', data: 'hello' }]);
    assert.throws(() => openZip(good.subarray(0, 10)), importError('MALFORMED', /too short/));
    assert.throws(() => openZip(good.subarray(0, good.length - 1)), importError('MALFORMED', /end record/));
    const damaged = Buffer.from(good);
    damaged.writeUInt32LE(0, damaged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])));
    assert.throws(() => openZip(damaged), importError('MALFORMED', /directory is damaged/));
  });

  it('refuses encryption, ZIP64 markers, a name listed twice and other compression methods', async () => {
    assert.throws(() => openZip(makeZip([{ name: 'a.csv', data: 'x', flags: 0x801 }])), importError('UNSUPPORTED', /encrypted/));
    assert.throws(() => openZip(makeZip([{ name: 'a.csv', data: 'x', size: 0xffffffff }])), importError('UNSUPPORTED', /ZIP64/));
    assert.throws(() => openZip(makeZip([{ name: 'a.csv', data: 'x' }, { name: 'a.csv', data: 'y' }])), importError('MALFORMED', /twice/));
    const bzip = openZip(makeZip([{ name: 'a.csv', data: 'x', method: 12, packed: Buffer.from('BZh') }]));
    await assert.rejects(bzip.read('a.csv'), importError('UNSUPPORTED', /deflate/));
  });

  it('refuses an archive that lists more entries than it reads', () => {
    const many = makeZip(Array.from({ length: ZIP_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `f${i}.csv`, data: '', method: 0 })));
    assert.throws(() => openZip(many), importError('LIMIT', /lists 201 files/));
  });

  it('refuses an entry whose checksum or size does not match what it unpacks to', async () => {
    await assert.rejects(openZip(makeZip([{ name: 'a.csv', data: 'hello', crc: 1 }])).read('a.csv'), importError('MALFORMED', /checksum/));
    await assert.rejects(openZip(makeZip([{ name: 'a.csv', data: 'hello', size: 3 }])).read('a.csv'), importError('MALFORMED', /size the archive states/));
    await assert.rejects(openZip(makeZip([{ name: 'a.csv', data: 'hello', size: 9 }])).read('a.csv'), importError('MALFORMED', /size the archive states/));
    await assert.rejects(openZip(makeZip([{ name: 'a.csv', data: 'x', packed: Buffer.from([0xff, 0xff, 0xff]) }])).read('a.csv'), importError('MALFORMED'));
  });

  describe('a compression bomb', () => {
    // 64 MiB of zeros deflate to about 64 KiB.
    const zeros = Buffer.alloc(64 * 1024 * 1024);
    const bomb = deflateRawSync(zeros);

    it('is refused before unpacking when its stated size is over the limit', async () => {
      const zip = openZip(makeZip([{ name: 'a.csv', data: zeros.subarray(0, 1), packed: bomb, size: zeros.length, crc: 0 }]));
      await assert.rejects(zip.read('a.csv'), importError('LIMIT', /unpacks to 64 MB, more than the 20 MB/));
      assert.ok((await cpuMs(() => zip.read('a.csv'))) < 20, 'refused without unpacking');
    });

    it('stops unpacking at its stated size when it claims to be small', async () => {
      const zip = openZip(makeZip([{ name: 'a.csv', data: zeros.subarray(0, 1024), packed: bomb, size: 1024 }]));
      await assert.rejects(zip.read('a.csv'), importError('MALFORMED', /does not unpack to the size/));
      const ms = await cpuMs(() => openZip(makeZip([{ name: 'b.csv', data: zeros.subarray(0, 1024), packed: bomb, size: 1024 }])).read('b.csv'));
      assert.ok(ms < 20, `took ${ms} ms of CPU; unpacking the whole bomb takes far longer`);
    });

    it('cannot unpack more than the total budget through entries that point at the same data', async () => {
      const block = Buffer.alloc(15 * 1024 * 1024, 0x41);
      const archive = makeZip([{ name: 'a.csv', data: block }]);
      // Three directory entries that all point at the one entry's data, each within the per-entry limit.
      const directory = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      const record = archive.subarray(directory, directory + 46 + 5);
      const end = archive.subarray(directory + record.length);
      const names = ['b.csv', 'c.csv'].map((name) => Buffer.concat([record.subarray(0, 46), Buffer.from(name)]));
      const endRecord = Buffer.from(end);
      endRecord.writeUInt16LE(3, 8);
      endRecord.writeUInt16LE(3, 10);
      endRecord.writeUInt32LE(record.length * 3, 12);
      const overlapping = Buffer.concat([archive.subarray(0, directory), record, ...names, endRecord]);
      const zip = openZip(overlapping);
      assert.equal((await zip.read('a.csv'))?.length, block.length);
      assert.equal((await zip.read('b.csv'))?.length, block.length);
      await assert.rejects(zip.read('c.csv'), importError('LIMIT', /more than the 40 MB/));
    });
  });
});
