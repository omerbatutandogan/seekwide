import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeText, parseCsv, TABLE_LIMITS } from '../../plugin/server/src/imports/csv.js';
import { ImportError } from '../../plugin/server/src/imports/errors.js';

/** CPU time of a call, in milliseconds (user and system), not wall-clock time. */
function cpuMs(/** @type {() => unknown} */ call) {
  const start = process.cpuUsage();
  try {
    call();
  } catch {
    // Only the time matters here.
  }
  const used = process.cpuUsage(start);
  return (used.user + used.system) / 1000;
}

/** @param {string} code @param {RegExp} [message] */
const importError = (code, message) => (/** @type {unknown} */ error) =>
  error instanceof ImportError && error.code === code && (message === undefined || message.test(error.message));

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes and line breaks inside quotes', () => {
    assert.deepEqual(parseCsv('a,"b,c","say ""hi""","two\nlines"\r\n1,2,3,4\r\n'), [['a', 'b,c', 'say "hi"', 'two\nlines'], ['1', '2', '3', '4']]);
  });

  it('accepts CRLF, LF and CR line ends, skips empty lines and adds no row for a final line end', () => {
    assert.deepEqual(parseCsv('a,b\r\n1,2\n\n3,4\r5,6\n'), [['a', 'b'], ['1', '2'], ['3', '4'], ['5', '6']]);
    assert.deepEqual(parseCsv(''), []);
  });

  it('keeps empty fields, a trailing delimiter included', () => {
    assert.deepEqual(parseCsv('a,,c,\n,b,\n'), [['a', '', 'c', ''], ['', 'b', '']]);
    assert.deepEqual(parseCsv('a,'), [['a', '']]);
  });

  it('takes the delimiter the header uses most: semicolon or tab when a locale writes decimal commas', () => {
    assert.deepEqual(parseCsv('Sayfa;Tıklama sayısı;Ortalama konum\nhttps://a.test/;3;4,2\n'), [['Sayfa', 'Tıklama sayısı', 'Ortalama konum'], ['https://a.test/', '3', '4,2']]);
    assert.deepEqual(parseCsv('a\tb\n1,5\t2\n'), [['a', 'b'], ['1,5', '2']]);
    assert.deepEqual(parseCsv('"x,y";z;w\n'), [['x,y', 'z', 'w']]);
  });

  it('keeps a quote inside an unquoted field as a character, and cells that look like formulas as text', () => {
    assert.deepEqual(parseCsv('5" screen,=HYPERLINK("http://x.test"),+1,-2,@SUM(A1)\n'), [['5" screen', '=HYPERLINK("http://x.test")', '+1', '-2', '@SUM(A1)']]);
  });

  it('refuses a quoted field that never ends and text after a closing quote', () => {
    assert.throws(() => parseCsv('a,b\n"open,1\n'), importError('MALFORMED', /quoted value in row 2 never ends/));
    assert.throws(() => parseCsv('"a"b,c\n'), importError('MALFORMED', /text follows a closing quote in row 1/));
  });

  it('keeps no row of empty cells, so a file of commas costs no memory (review of 2026-11-13)', () => {
    assert.deepEqual(parseCsv('a,b\n,,\n,,\n1,2\n'), [['a', 'b'], ['1', '2']]);
    const commas = `${','.repeat(63)}\n`.repeat(50_000);
    const before = process.memoryUsage().heapUsed;
    assert.deepEqual(parseCsv(commas), []);
    assert.ok(process.memoryUsage().heapUsed - before < 50 * 1024 * 1024);
  });

  it('refuses more cells than one file may hold', () => {
    const limits = { maxRows: 100, maxColumns: 10, maxCellChars: 10, maxCells: 6 };
    assert.equal(parseCsv('a,b,c\nd,e,f\n', limits).length, 2);
    assert.throws(() => parseCsv('a,b,c\nd,e,f\ng\n', limits), importError('LIMIT', /more than 6 cells/));
  });

  it('refuses more rows, columns or characters in a cell than it reads', () => {
    const limits = { maxRows: 2, maxColumns: 3, maxCellChars: 5, maxCells: 100 };
    assert.deepEqual(parseCsv('a\nb\n', limits), [['a'], ['b']]);
    assert.throws(() => parseCsv('a\nb\nc\n', limits), importError('LIMIT', /more than 2 rows/));
    assert.throws(() => parseCsv('a,b,c,d\n', limits), importError('LIMIT', /more than 3 columns/));
    assert.throws(() => parseCsv('abcdef\n', limits), importError('LIMIT', /longer than 5 characters/));
    assert.throws(() => parseCsv('"abc""def"\n', limits), importError('LIMIT', /longer than 5 characters/));
  });

  it('stays linear on input built to be slow (CPU time)', () => {
    const quotes = `"${'""'.repeat(2_000_000)}`;
    assert.ok(cpuMs(() => parseCsv(quotes)) < 1000, 'doubled quotes');
    const delimiters = ','.repeat(3_000_000);
    assert.ok(cpuMs(() => parseCsv(delimiters)) < 1000, 'a row of delimiters stops at the column limit');
    const lines = 'a\n'.repeat(TABLE_LIMITS.maxRows + 10);
    assert.ok(cpuMs(() => parseCsv(lines)) < 1000, 'rows stop at the row limit');
    const unclosed = `"${'x'.repeat(5_000_000)}`;
    assert.ok(cpuMs(() => parseCsv(unclosed)) < 1000, 'a quote that never ends');
  });
});

describe('decodeText', () => {
  it('reads UTF-8 with and without a byte order mark, and UTF-16 with one', () => {
    assert.equal(decodeText(Buffer.from('Gösterim sayısı')), 'Gösterim sayısı');
    assert.equal(decodeText(Buffer.from('﻿Clicks')), 'Clicks');
    assert.equal(decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Clicks', 'utf16le')])), 'Clicks');
    const be = Buffer.from('Clicks', 'utf16le').swap16();
    assert.equal(decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), be])), 'Clicks');
  });

  it('refuses bytes that are not UTF-8 and text with NUL characters', () => {
    assert.throws(() => decodeText(Buffer.from([0x47, 0xf6, 0x73])), importError('MALFORMED', /not UTF-8 or UTF-16/));
    assert.throws(() => decodeText(Buffer.from('Clicks', 'utf16le')), importError('MALFORMED', /NUL/));
  });
});
