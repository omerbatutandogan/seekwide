// The AI reports of Search Console and Bing, read from exports shaped like the
// real downloads of 2026-11-23 and 2026-11-24, stored and checked like any import.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { aiTables, parseBingDate } from '../../plugin/server/src/imports/ai-data.js';
import { aiImportProblem } from '../../plugin/server/src/imports/ai-record.js';
import { readTables } from '../../plugin/server/src/imports/parse.js';
import { SITE, bingAiOverviewCsv, bingAiPagesCsv, bingPagesCsv, googleAiXlsx, googleAiZip, googleZipEnglish } from '../helpers/exports.js';

/** @param {string|Buffer} bytes @param {import('../../plugin/server/src/imports/ai-data.js').AiSource} source */
const read = async (bytes, source) => aiTables((await readTables(Buffer.from(bytes))).tables, source);

describe('aiTables', () => {
  it('reads Search Console\'s generative AI report: impressions by day and by page, and the filters, from the zip and the Excel file', async () => {
    const zip = await read(googleAiZip(), 'google_search_console_ai');
    assert.deepEqual(zip.dates, [{ date: '2026-10-01', impressions: 3 }, { date: '2026-10-02', impressions: 0 }, { date: '2026-10-03', impressions: 9 }]);
    assert.deepEqual(zip.pages, [{ url: `${SITE}/`, impressions: 8 }, { url: `${SITE}/about`, impressions: 4 }, { url: `${SITE}/pricing`, impressions: 1 }]);
    assert.deepEqual(zip.filters, [{ name: 'Search type', value: 'Web (text-based)' }, { name: 'Date', value: 'Last 3 months' }]);
    assert.deepEqual(zip.totals, { impressions: 12 });
    assert.deepEqual(zip.counts, { tables: 5, other_tables: 2, skipped_pages: 0 });
    const xlsx = await read(googleAiXlsx(), 'google_search_console_ai');
    assert.deepEqual([xlsx.totals, xlsx.pages.length], [{ impressions: 12 }, 2]);
  });

  it('refuses the Performance report as the AI report, and says which source to use', async () => {
    await assert.rejects(read(googleZipEnglish(), 'google_search_console_ai'), /import it with source google_search_console/i);
  });

  it('reads the overview of Bing\'s AI Performance report: citations and cited pages by day, with Bing\'s US dates', async () => {
    const data = await read(bingAiOverviewCsv(), 'bing_ai_performance');
    assert.deepEqual(data.dates, [{ date: '2026-09-30', citations: 0, cited_pages: 0 }, { date: '2026-10-01', citations: 3, cited_pages: 2 }, { date: '2026-10-02', citations: 1, cited_pages: 1 }]);
    assert.deepEqual(data.totals, { citations: 4, peak_cited_pages: 2, days_cited: 2 });
    assert.deepEqual(data.pages, []);
  });

  it('reads the table of pages of Bing\'s AI Performance report, most citations first', async () => {
    const data = await read(bingAiPagesCsv(), 'bing_ai_pages');
    assert.deepEqual(data.pages, [{ url: `${SITE}/`, citations: 3 }, { url: `${SITE}/about`, citations: 1 }]);
    assert.deepEqual(data.totals, { citations: 4, pages_cited: 2 });
  });

  it('refuses another table for each Bing source, without quoting the file', async () => {
    await assert.rejects(read(bingPagesCsv(), 'bing_ai_performance'), /Date, Citations and Cited Pages/);
    await assert.rejects(read(bingAiOverviewCsv(), 'bing_ai_pages'), /Page and Citations/);
  });

  it('reads only dates that cannot be misread', () => {
    assert.equal(parseBingDate('8/23/2026 12:00:00 AM'), '2026-08-23');
    assert.equal(parseBingDate('12/1/2026'), '2026-12-01');
    assert.equal(parseBingDate('2026-08-23'), '2026-08-23');
    for (const text of ['23/8/2026', '8/23/2026 3:00:00 PM', '2/30/2026', '23.08.2026']) assert.equal(parseBingDate(text), null, text);
  });
});

describe('aiImportProblem', () => {
  /** @param {any} data @param {any} source */
  const record = (data, source, period = data.dates.length > 0 ? { start: data.dates[0].date, end: data.dates.at(-1).date, from: 'file' } : null) => ({
    schema_version: 1, source, imported_at: '2026-11-24T00:00:00.000Z', file: { path: 'ai.zip', format: 'zip', bytes: 10, sha256: 'a'.repeat(64) }, period, ...data,
  });

  it('accepts what the import writes, for each source', async () => {
    assert.equal(aiImportProblem(record(await read(googleAiZip(), 'google_search_console_ai'), 'google_search_console_ai'), 'google_search_console_ai'), null);
    assert.equal(aiImportProblem(record(await read(bingAiOverviewCsv(), 'bing_ai_performance'), 'bing_ai_performance'), 'bing_ai_performance'), null);
    assert.equal(aiImportProblem(record(await read(bingAiPagesCsv(), 'bing_ai_pages'), 'bing_ai_pages', { start: '2026-08-23', end: '2026-11-23', from: 'user' }), 'bing_ai_pages'), null);
  });

  it('refuses any other form, naming the field', async () => {
    const good = record(await read(googleAiZip(), 'google_search_console_ai'), 'google_search_console_ai');
    /** @type {[string, (value: any) => void][]} */
    const cases = [
      ['fields', (value) => { value.extra = true; }],
      ['source', (value) => { value.source = 'bing_ai_pages'; }],
      ['totals', (value) => { value.totals.impressions += 1; }],
      ['order', (value) => { value.pages.reverse(); }],
      ['normalized', (value) => { value.pages[0].url = 'javascript:alert(1)'; }],
      ['period', (value) => { value.period.end = '2027-01-01'; }],
    ];
    for (const [expected, change] of cases) {
      const value = structuredClone(good);
      change(value);
      const problem = aiImportProblem(value, 'google_search_console_ai');
      assert.ok(problem !== null && problem.includes(expected), `${expected}: ${problem}`);
    }
  });
});
