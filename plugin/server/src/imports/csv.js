// Reading CSV text (RFC 4180): quoted fields with doubled quotes, line breaks
// inside quotes, CRLF, LF or CR line ends. The delimiter is the comma, the
// semicolon or the tab, whichever the first record uses most, because a
// spreadsheet saved in a locale that writes decimal commas uses semicolons.
// Every cell stays a string; nothing in a cell is evaluated.

import { overLimit, malformed } from './errors.js';

export const TABLE_LIMITS = Object.freeze({
  /** Rows of one table, the header included. Search Console exports 1,000 rows of a table. */
  maxRows: 50_000,
  maxColumns: 64,
  /** Characters of one cell. A URL is at most 2,048 characters long. */
  maxCellChars: 4096,
  /** Cells kept from one file, all tables together, so many wide tables cannot fill memory. */
  maxCells: 1_000_000,
});

const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;
const DELIMITERS = [',', ';', '\t'];

/**
 * The text of a file: UTF-8 (with or without a byte order mark), or UTF-16
 * with one. Anything else, and text with a NUL character, is not read.
 * @param {Buffer} bytes
 * @returns {string}
 */
export function decodeText(bytes) {
  /** @type {[string, number]} */
  let encoding = ['utf-8', 0];
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = ['utf-8', 3];
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = ['utf-16le', 2];
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = ['utf-16be', 2];
  let text;
  try {
    text = new TextDecoder(encoding[0], { fatal: true, ignoreBOM: true }).decode(bytes.subarray(encoding[1]));
  } catch {
    throw malformed('it is not UTF-8 or UTF-16 text');
  }
  if (text.includes('\u0000')) throw malformed('it holds NUL characters, so it is not a text file');
  return text;
}

/**
 * The delimiter the first record uses most, counted outside quotes. A tie
 * goes to the comma, then the semicolon.
 * @param {string} text
 * @returns {number}
 */
function detectDelimiter(text) {
  const counts = [0, 0, 0];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === QUOTE) quoted = !quoted;
    else if (!quoted && (c === CR || c === LF)) break;
    else if (!quoted) {
      const index = DELIMITERS.indexOf(text[i]);
      if (index !== -1) counts[index] += 1;
    }
  }
  const best = counts.indexOf(Math.max(...counts));
  return DELIMITERS[best].charCodeAt(0);
}

/**
 * Parse CSV text into rows of strings.
 *
 * Guarantees: an empty line, a line of empty cells, and a line ending the text, add no row; a
 * quoted field ends only at a quote that is not doubled, and only a
 * delimiter, a line end or the end of the text may follow it; a quote inside
 * an unquoted field is kept as a character. More than `maxRows` rows, more
 * than `maxColumns` cells in a row, a cell longer than `maxCellChars` or more
 * than `maxCells` cells kept stops the parse with an `ImportError`, as does a
 * quoted field that never ends. Linear in the length of the text.
 * @param {string} text
 * @param {{maxRows: number, maxColumns: number, maxCellChars: number, maxCells: number}} [limits]
 * @param {number} [used]  Cells the file's other tables already hold; they count toward `maxCells`.
 * @returns {string[][]}
 */
export function parseCsv(text, limits = TABLE_LIMITS, used = 0) {
  const delimiter = detectDelimiter(text);
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  const n = text.length;
  let i = 0;

  /** @param {string} value */
  const pushField = (value) => {
    if (value.length > limits.maxCellChars) throw overLimit(`a cell in row ${rows.length + 1} is longer than ${limits.maxCellChars} characters`);
    row.push(value);
    if (row.length > limits.maxColumns) throw overLimit(`row ${rows.length + 1} has more than ${limits.maxColumns} columns`);
  };
  let cells = used;
  const endRow = () => {
    // A row of empty cells is not kept, so a file of commas costs no memory.
    if (row.some((cell) => cell !== '')) {
      rows.push(row);
      if (rows.length > limits.maxRows) throw overLimit(`a table has more than ${limits.maxRows} rows`);
      cells += row.length;
      if (cells > limits.maxCells) throw overLimit(`the file has more than ${limits.maxCells} cells`);
    }
    row = [];
  };

  while (i < n) {
    if (text.charCodeAt(i) === QUOTE) {
      let value = '';
      let from = i + 1;
      for (;;) {
        const close = text.indexOf('"', from);
        if (close === -1) throw malformed(`a quoted value in row ${rows.length + 1} never ends`);
        value += text.slice(from, close);
        if (value.length > limits.maxCellChars) throw overLimit(`a cell in row ${rows.length + 1} is longer than ${limits.maxCellChars} characters`);
        if (text.charCodeAt(close + 1) === QUOTE) {
          value += '"';
          from = close + 2;
        } else {
          i = close + 1;
          break;
        }
      }
      const next = text.charCodeAt(i);
      if (i < n && next !== delimiter && next !== CR && next !== LF) throw malformed(`text follows a closing quote in row ${rows.length + 1}`);
      pushField(value);
    } else {
      let end = i;
      while (end < n) {
        const c = text.charCodeAt(end);
        if (c === delimiter || c === CR || c === LF) break;
        end += 1;
      }
      pushField(text.slice(i, end));
      i = end;
    }
    if (i >= n) break;
    const c = text.charCodeAt(i);
    if (c === delimiter) {
      i += 1;
      // A delimiter that ends the text leaves an empty last field; before a line end, the loop reads that field.
      if (i === n) pushField('');
      continue;
    }
    i += c === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
    endRow();
  }
  if (row.length > 0) endRow();
  return rows;
}
