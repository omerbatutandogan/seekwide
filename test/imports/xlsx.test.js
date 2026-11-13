import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ImportError } from '../../plugin/server/src/imports/errors.js';
import { readWorkbook } from '../../plugin/server/src/imports/xlsx.js';
import { isDateFormat } from '../../plugin/server/src/imports/xlsx-styles.js';
import { decodeXmlText, walkXml } from '../../plugin/server/src/imports/xml.js';
import { openZip } from '../../plugin/server/src/imports/zip.js';
import { makeXlsx, makeZip } from '../helpers/zip.js';

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

/** A workbook whose first sheet is `sheet` and whose shared strings are `strings`. */
function workbookWith(/** @type {string} */ sheet, /** @type {string} */ strings = '<sst/>', /** @type {string} */ styles = '<styleSheet/>') {
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  return openZip(makeZip([
    { name: '[Content_Types].xml', data: '<Types/>' },
    { name: 'xl/workbook.xml', data: `<workbook xmlns:r="${rel}"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<Relationships><Relationship Id="rId1" Type="${rel}/worksheet" Target="/xl/worksheets/s.xml"/><Relationship Id="rS" Type="${rel}/sharedStrings" Target="./sharedStrings.xml"/><Relationship Id="rT" Type="${rel}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/sharedStrings.xml', data: strings },
    { name: 'xl/styles.xml', data: styles },
    { name: 'xl/worksheets/s.xml', data: `<worksheet><sheetData>${sheet}</sheetData></worksheet>` },
  ]));
}

describe('readWorkbook', () => {
  it('reads every sheet in order with shared strings, numbers and date-formatted numbers as ISO dates', async () => {
    const sheets = await readWorkbook(openZip(makeXlsx([
      { name: 'Pages', rows: [['Top pages', 'Clicks'], ['https://a.test/', 12]] },
      { name: 'Dates', rows: [['Date', 'Clicks'], [{ date: 46296 }, 3]] },
    ])));
    assert.deepEqual(sheets, [
      { name: 'Pages', rows: [['Top pages', 'Clicks'], ['https://a.test/', 12]] },
      { name: 'Dates', rows: [['Date', 'Clicks'], ['2026-10-01', 3]] },
    ]);
  });

  it('counts dates from 1904 when the workbook says so', async () => {
    const [sheet] = await readWorkbook(openZip(makeXlsx([{ name: 'D', rows: [[{ date: 44834 }]] }], { date1904: true })));
    assert.deepEqual(sheet.rows, [['2026-10-01']]);
  });

  it('places cells by their reference, reads inline strings and rich text without phonetic runs, and never evaluates a formula', async () => {
    const strings = '<sst><si><r><t>Tıklama </t></r><r><t>sayısı</t></r><rPh><t>ignored</t></rPh></si></sst>';
    const sheet = '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>=SUM(A1)</t></is></c></row>' +
      '<row r="2"><c r="B2"><f>1+1</f><v>2</v></c><c r="C2" t="str"><f>A1</f><v>@cmd</v></c><c t="b"><v>1</v></c></row>';
    const [result] = await readWorkbook(workbookWith(sheet, strings));
    assert.deepEqual(result.rows, [['Tıklama sayısı', '', '=SUM(A1)'], ['', 2, '@cmd', 'TRUE']]);
  });

  it('knows a custom date format by its day or year, outside quotes and brackets', async () => {
    const styles = '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="[Red]0.0&quot;d&quot;"/></numFmts>' +
      '<cellXfs><xf numFmtId="0"/><xf numFmtId="164"/><xf numFmtId="165"/></cellXfs></styleSheet>';
    const [result] = await readWorkbook(workbookWith('<row><c s="1"><v>46296</v></c><c s="2"><v>46296</v></c></row>', '<sst/>', styles));
    assert.deepEqual(result.rows, [['2026-10-01', 46296]]);
  });

  it('reads a number only in the form SpreadsheetML writes it, never hex, binary or padded text (review of 2026-11-13)', async () => {
    const [ok] = await readWorkbook(workbookWith('<row><c><v>1.5E-2</v></c><c><v>-3</v></c><c><v>.5</v></c></row>'));
    assert.deepEqual(ok.rows, [[0.015, -3, 0.5]]);
    for (const value of ['0x1F', '0b11', '0o17', ' 7 ', 'Infinity', '1e999']) {
      await assert.rejects(readWorkbook(workbookWith(`<row><c><v>${value}</v></c></row>`)), importError('MALFORMED', /marked as a number/), value);
    }
  });

  it('ends a row at its last value: an empty cell that only carries a style is not one', async () => {
    const [result] = await readWorkbook(workbookWith('<row><c t="inlineStr"><is><t>a</t></is></c><c r="B1" s="1"/><c r="C1" s="1"/></row>'));
    assert.deepEqual(result.rows, [['a']]);
  });

  it('refuses what is not a workbook, a sheet that is missing and a shared string that does not exist', async () => {
    await assert.rejects(readWorkbook(openZip(makeZip([{ name: 'notes.txt', data: 'x' }]))), importError('UNSUPPORTED', /neither/));
    await assert.rejects(readWorkbook(workbookWith('<row><c t="s"><v>7</v></c></row>')), importError('MALFORMED', /shared string/));
    await assert.rejects(readWorkbook(workbookWith('<row><c><v>abc</v></c></row>')), importError('MALFORMED', /marked as a number/));
  });

  it('refuses more columns or rows than it reads', async () => {
    await assert.rejects(readWorkbook(workbookWith('<row><c r="XFD1"><v>1</v></c></row>')), importError('LIMIT', /more than 64 columns/));
    await assert.rejects(readWorkbook(workbookWith('<row><c><v>1</v></c></row>'.repeat(3)), { maxRows: 2, maxColumns: 64, maxCellChars: 10, maxCells: 100 }), importError('LIMIT', /more than 2 rows/));
  });
});

describe('walkXml', () => {
  it('reads attributes in one pass, a ">" inside a quoted value included, and refuses an attribute without a value (review of 2026-11-13)', () => {
    /** @type {Record<string, string>[]} */
    const seen = [];
    walkXml('<a x="1" y = \'[>=100]0\' xmlns:r="ns" r:id="rId1"/>', { open: (_, attributes) => seen.push({ ...attributes }) });
    assert.deepEqual(seen, [{ x: '1', y: '[>=100]0', id: 'rId1' }]);
    // Attributes are read when the visitor asks for elements.
    const visitor = { open() {} };
    assert.throws(() => walkXml('<a x/>', visitor), importError('MALFORMED', /attribute without a value/));
    assert.throws(() => walkXml('<a x=1/>', visitor), importError('MALFORMED', /without quotes/));
    const long = `<a ${'x'.repeat(64_000)}/>`;
    assert.ok(cpuMs(() => walkXml(long, visitor)) < 50, 'a long run of name characters is read once');
    const many = `<r>${`<a ${'x'.repeat(60_000)}="1"/>`.repeat(40)}</r>`;
    assert.ok(cpuMs(() => walkXml(many, visitor)) < 200, 'forty long tags');
  });

  it('refuses a document type declaration, so no entity can be defined or expanded', () => {
    const laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><sst><si><t>&lol2;</t></si></sst>';
    assert.throws(() => walkXml(laughs, {}), importError('MALFORMED', /document type declaration/));
  });

  it('decodes the predefined entities and character references and refuses any other entity', () => {
    assert.equal(decodeXmlText('a &amp; b &lt;c&gt; &quot;d&apos; &#65;&#x42;'), 'a & b <c> "d\' AB');
    assert.throws(() => decodeXmlText('&nbsp;'), importError('MALFORMED', /entity/));
    assert.throws(() => decodeXmlText('&#0;'), importError('MALFORMED', /character reference/));
  });

  it('refuses mismatched, unclosed and too deeply nested elements', () => {
    assert.throws(() => walkXml('<a><b></a></b>', {}), importError('MALFORMED', /does not match/));
    assert.throws(() => walkXml('<a><b>', {}), importError('MALFORMED', /ends inside an element/));
    assert.throws(() => walkXml('<a>'.repeat(40) + '</a>'.repeat(40), {}), importError('MALFORMED', /nested too deeply/));
  });
});

describe('isDateFormat', () => {
  it('finds a day or a year outside quotes, brackets and escapes, in one pass', () => {
    for (const code of ['yyyy-mm-dd', 'd-mmm', '[$-409]d mmm yyyy', 'DD.MM.YYYY']) assert.equal(isDateFormat(code), true, code);
    for (const code of ['0.00', '[Red]0.0"d"', '\\d0', '[h]:mm', '"yy"0', '#,##0']) assert.equal(isDateFormat(code), false, code);
    assert.ok(cpuMs(() => isDateFormat('['.repeat(1_000_000))) < 50, 'a format of unclosed brackets');
  });
});
