// Reading the sheets of an Excel workbook (.xlsx, ECMA-376 Office Open XML
// SpreadsheetML) from a ZIP archive: the package relationships, the workbook's
// sheet list, shared strings, cell styles (only to know which numbers are
// dates) and each worksheet's cells. Formulas are never evaluated: a cell is
// its stored value, as text or as a number.

/** @import { ZipReader } from './zip.js' */

import { ImportError, malformed, overLimit } from './errors.js';
import { TABLE_LIMITS, decodeText } from './csv.js';
import { dateStyles } from './xlsx-styles.js';
import { walkXml } from './xml.js';

/** @typedef {string|number} Cell */
/** @typedef {{name: string, rows: Cell[][]}} Sheet */

const MAX_SHEETS = 32;
const DAY_MS = 86_400_000;
const EPOCH_1900 = Date.UTC(1899, 11, 30);
const EPOCH_1904 = Date.UTC(1904, 0, 1);
/** How SpreadsheetML writes a number (xsd:double without INF and NaN); Number() would also take " 7 " and "0x1F". */
const NUMBER = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/;

/**
 * A part of the package as text, or null when the archive has no such part.
 * @param {ZipReader} zip
 * @param {string} name
 * @returns {Promise<string|null>}
 */
async function part(zip, name) {
  const bytes = await zip.read(name);
  return bytes === null ? null : decodeText(bytes);
}

/**
 * Resolve a relationship target against the folder of the part that names it.
 * @param {string} base  Folder of the source part, '' for the package root.
 * @param {string} target
 * @returns {string}
 */
function resolveTarget(base, target) {
  const segments = target.startsWith('/') ? [] : base.split('/').filter(Boolean);
  for (const segment of target.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment !== '' && segment !== '.') segments.push(segment);
  }
  return segments.join('/');
}

/**
 * The relationships of a part: id → {type, target}.
 * @param {string|null} xml
 * @param {string} base
 */
function relationships(xml, base) {
  /** @type {Map<string, {type: string, target: string}>} */
  const map = new Map();
  if (xml === null) return map;
  walkXml(xml, {
    open(name, a) {
      if (name === 'Relationship' && a.Id && a.Target && a.TargetMode !== 'External') map.set(a.Id, { type: a.Type ?? '', target: resolveTarget(base, a.Target) });
    },
  });
  return map;
}

/**
 * @param {Map<string, {type: string, target: string}>} rels
 * @param {string} kind  The last segment of the relationship type.
 * @returns {string|null}
 */
const targetOf = (rels, kind) => [...rels.values()].find((rel) => rel.type.endsWith(`/${kind}`))?.target ?? null;

/**
 * @param {string|null} xml
 * @returns {string[]}
 */
function sharedStrings(xml) {
  /** @type {string[]} */
  const strings = [];
  if (xml === null) return strings;
  let current = '';
  let inText = false;
  let phonetic = 0;
  walkXml(xml, {
    open(name) {
      if (name === 'si') current = '';
      else if (name === 't') inText = true;
      else if (name === 'rPh') phonetic += 1;
    },
    close(name) {
      if (name === 'si') strings.push(current);
      else if (name === 't') inText = false;
      else if (name === 'rPh') phonetic -= 1;
    },
    text(value) {
      if (inText && phonetic === 0) current += value;
    },
  });
  return strings;
}

/**
 * The 0-based column of a cell reference such as "C12"; null when it has none.
 * @param {string|undefined} ref
 * @returns {number|null}
 */
function columnOf(ref) {
  const letters = /^([A-Z]{1,3})\d*$/.exec(ref ?? '')?.[1];
  if (!letters) return null;
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

/**
 * A stored number shown with a date format, as an ISO date.
 * @param {number} serial
 * @param {boolean} date1904
 * @returns {string|null}
 */
function serialDate(serial, date1904) {
  if (!(serial >= 1 && serial < 2_958_466)) return null;
  return new Date((date1904 ? EPOCH_1904 : EPOCH_1900) + Math.floor(serial) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The rows of one worksheet, cells placed by their references.
 * @param {string} xml
 * @param {{strings: string[], dates: Set<number>, date1904: boolean, cells: number}} book  `cells` counts the cells kept so far.
 * @param {typeof TABLE_LIMITS} limits
 * @returns {Cell[][]}
 */
function sheetRows(xml, book, limits) {
  /** @type {Cell[][]} */
  const rows = [];
  /** @type {Cell[]} */
  let row = [];
  /** @type {{column: number, type: string, style: number, text: string}|null} */
  let cell = null;
  let capture = false;
  let phonetic = 0;
  let next = 0;
  /** @returns {Cell} */
  const valueOf = (/** @type {NonNullable<typeof cell>} */ c) => {
    if (c.type === 's') {
      const index = Number(c.text);
      if (!Number.isInteger(index) || index < 0 || index >= book.strings.length) throw malformed('a worksheet cell names a shared string that does not exist');
      return book.strings[index];
    }
    if (c.type === 'inlineStr' || c.type === 'str' || c.type === 'e' || c.type === 'd') return c.text;
    if (c.type === 'b') return c.text === '1' ? 'TRUE' : 'FALSE';
    if (c.text === '') return '';
    const number = NUMBER.test(c.text) ? Number(c.text) : Number.NaN;
    if (!Number.isFinite(number)) throw malformed('a worksheet cell marked as a number holds something else');
    return book.dates.has(c.style) ? serialDate(number, book.date1904) ?? number : number;
  };
  walkXml(xml, {
    open(name, a) {
      if (name === 'row') {
        row = [];
        next = 0;
      } else if (name === 'c') {
        const column = columnOf(a.r) ?? next;
        if (column >= limits.maxColumns) throw overLimit(`a worksheet has more than ${limits.maxColumns} columns`);
        cell = { column, type: a.t ?? 'n', style: Number(a.s ?? 0), text: '' };
        next = column + 1;
      } else if ((name === 'v' || name === 't') && cell) {
        capture = true;
      } else if (name === 'rPh') {
        phonetic += 1;
      }
    },
    close(name) {
      if (name === 'v' || name === 't') capture = false;
      else if (name === 'rPh') phonetic -= 1;
      else if (name === 'c' && cell) {
        const value = valueOf(cell);
        if (typeof value === 'string' && value.length > limits.maxCellChars) throw overLimit(`a cell is longer than ${limits.maxCellChars} characters`);
        while (row.length < cell.column) row.push('');
        row[cell.column] = value;
        cell = null;
      } else if (name === 'row' && row.some((value) => value !== '')) {
        // An empty cell that only carries a style is not a value: the row ends at its last value.
        while (row.at(-1) === '') row.pop();
        rows.push(row);
        if (rows.length > limits.maxRows) throw overLimit(`a worksheet has more than ${limits.maxRows} rows`);
        book.cells += row.length;
        if (book.cells > limits.maxCells) throw overLimit(`the file has more than ${limits.maxCells} cells`);
      }
    },
    text(value) {
      if (capture && cell && phonetic === 0) {
        cell.text += value;
        if (cell.text.length > limits.maxCellChars + 16) throw overLimit(`a cell is longer than ${limits.maxCellChars} characters`);
      }
    },
  });
  return rows;
}

/**
 * The sheets of a workbook, in workbook order, each with its name (data from
 * the file) and its rows. Throws an `ImportError` when the archive is not a
 * workbook or a part cannot be read. At most 32 sheets are read.
 * @param {ZipReader} zip
 * @param {typeof TABLE_LIMITS} [limits]
 * @returns {Promise<Sheet[]>}
 */
export async function readWorkbook(zip, limits = TABLE_LIMITS) {
  const rootRels = relationships(await part(zip, '_rels/.rels'), '');
  const workbookPath = targetOf(rootRels, 'officeDocument') ?? 'xl/workbook.xml';
  const workbook = await part(zip, workbookPath);
  if (workbook === null) throw new ImportError('UNSUPPORTED', 'The archive is neither a Search Console download nor an Excel workbook.');
  const folder = workbookPath.includes('/') ? workbookPath.slice(0, workbookPath.lastIndexOf('/')) : '';
  const fileName = workbookPath.slice(folder.length === 0 ? 0 : folder.length + 1);
  const rels = relationships(await part(zip, `${folder ? `${folder}/` : ''}_rels/${fileName}.rels`), folder);
  /** @type {{name: string, id: string}[]} */
  const sheets = [];
  let date1904 = false;
  walkXml(workbook, {
    open(name, a) {
      if (name === 'workbookPr') date1904 = a.date1904 === '1' || a.date1904 === 'true';
      else if (name === 'sheet' && a.id) sheets.push({ name: a.name ?? '', id: a.id });
    },
  });
  if (sheets.length > MAX_SHEETS) throw overLimit(`the workbook has ${sheets.length} sheets, more than the ${MAX_SHEETS} Seekwide reads`);
  const stringsPath = targetOf(rels, 'sharedStrings');
  const stylesPath = targetOf(rels, 'styles');
  const book = {
    strings: sharedStrings(stringsPath === null ? null : await part(zip, stringsPath)),
    dates: dateStyles(stylesPath === null ? null : await part(zip, stylesPath)),
    date1904,
    cells: 0,
  };
  /** @type {Sheet[]} */
  const result = [];
  for (const sheet of sheets) {
    const target = rels.get(sheet.id);
    if (!target || !target.type.endsWith('/worksheet')) continue;
    const xml = await part(zip, target.target);
    if (xml === null) throw malformed('the workbook names a worksheet that the archive does not hold');
    result.push({ name: sheet.name, rows: sheetRows(xml, book, limits) });
  }
  return result;
}
