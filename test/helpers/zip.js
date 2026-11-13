// Writing ZIP archives and Excel workbooks for tests, including broken and
// hostile ones: every field of an entry can be overridden.

import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../../plugin/server/src/imports/zip.js';

/**
 * @typedef {Object} ZipInput
 * @property {string} name
 * @property {Buffer|string} data
 * @property {0|8|number} [method]     8 (deflate) by default.
 * @property {number} [size]           The unpacked size to state; the real one by default.
 * @property {number} [crc]            The checksum to state; the real one by default.
 * @property {number} [flags]          General purpose flags; 0x800 (UTF-8 name) by default.
 * @property {Buffer} [packed]         Packed bytes to store instead of compressing `data`.
 */

/**
 * A ZIP archive of the given entries, in order.
 * @param {ZipInput[]} entries
 * @param {{comment?: string}} [options]
 * @returns {Buffer}
 */
export function makeZip(entries, { comment = '' } = {}) {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const method = entry.method ?? 8;
    const packed = entry.packed ?? (method === 8 ? deflateRawSync(data) : data);
    const name = Buffer.from(entry.name, 'utf8');
    const flags = entry.flags ?? 0x800;
    const crc = entry.crc ?? crc32(data);
    const size = entry.size ?? data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const commentBytes = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return Buffer.concat([...locals, directory, end, commentBytes]);
}

/** @param {string} value */
const xmlText = (value) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * @param {number} index  0-based column.
 * @returns {string}
 */
function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/**
 * An .xlsx workbook with one sheet per table. Strings go into the shared
 * strings part, numbers are stored as numbers, and a value given as
 * `{date: serial}` is a number with the built-in date format 14.
 * @param {{name: string, rows: (string|number|{date: number})[][]}[]} sheets
 * @param {{date1904?: boolean, extra?: {name: string, data: string}[]}} [options]
 * @returns {Buffer}
 */
export function makeXlsx(sheets, { date1904 = false, extra = [] } = {}) {
  /** @type {string[]} */
  const strings = [];
  const sheetXml = sheets.map(({ rows }) => {
    const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => {
      const ref = `${columnName(c)}${r + 1}`;
      if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
      if (typeof value === 'object') return `<c r="${ref}" s="1"><v>${value.date}</v></c>`;
      strings.push(value);
      return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  });
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return makeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: '_rels/.rels', data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><workbookPr${date1904 ? ' date1904="1"' : ''}/><sheets>${sheets.map((sheet, i) => `<sheet name="${xmlText(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rS" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="rT" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((s) => `<si><t xml:space="preserve">${xmlText(s)}</t></si>`).join('')}</sst>` },
    { name: 'xl/styles.xml', data: '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>' },
    ...sheetXml.map((data, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data })),
    ...extra,
  ]);
}
