// YouTube Studio's traffic sources and YouTube search terms, read from exports
// shaped like the real download of 2026-11-24, stored and checked like any import.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readTables } from '../../plugin/server/src/imports/parse.js';
import { youtubeTables } from '../../plugin/server/src/imports/youtube-data.js';
import { YOUTUBE_IMPORT_SCHEMA_VERSION, youtubeImportProblem } from '../../plugin/server/src/imports/youtube-record.js';
import { bingAiPagesCsv, csv, youtubeSearchTermsZip, youtubeTrafficSourcesZip } from '../helpers/exports.js';

/** @param {Buffer|string} bytes @param {import('../../plugin/server/src/imports/youtube-data.js').YoutubeSource} source */
const read = async (bytes, source) => youtubeTables((await readTables(Buffer.from(bytes))).tables, source);

/** @param {import('../../plugin/server/src/imports/youtube-data.js').YoutubeTables} tables @param {import('../../plugin/server/src/imports/youtube-data.js').YoutubeSource} source */
const record = (tables, source) => ({
  schema_version: YOUTUBE_IMPORT_SCHEMA_VERSION,
  source,
  imported_at: '2026-11-24T09:00:00.000Z',
  file: { path: 'yt.zip', format: /** @type {const} */ ('zip'), bytes: 100, sha256: 'a'.repeat(64) },
  ...tables,
});

describe('youtubeTables', () => {
  it('reads the search terms: the total, the terms most views first, the stated row limit and the days of the chart', async () => {
    const data = await read(youtubeSearchTermsZip(), 'youtube_search_terms');
    assert.deepEqual(data.total, { views: 91, watch_hours: 1.5 });
    assert.deepEqual(data.rows, [{ name: 'example widgets', views: 40, watch_hours: 0.75 }, { name: 'widget repair', views: 30, watch_hours: 0.5 }, { name: 'blue widget', views: 21, watch_hours: 0.25 }]);
    assert.equal(data.truncated_at, 3);
    assert.deepEqual(data.period, { start: '2026-10-27', end: '2026-10-29' });
    assert.deepEqual(data.counts, { tables: 3, other_tables: 2, skipped_rows: 0, merged_rows: 0 });
  });

  it('reads the traffic sources', async () => {
    const data = await read(youtubeTrafficSourcesZip(), 'youtube_traffic_sources');
    assert.deepEqual(data.rows.map((row) => [row.name, row.views]), [['Shorts feed', 250], ['YouTube search', 91], ['Browse features', 59]]);
    assert.equal(data.truncated_at, null);
  });

  it('says which source to use when the view is the other one', async () => {
    await assert.rejects(read(youtubeSearchTermsZip(), 'youtube_traffic_sources'), /import it with source youtube_search_terms/);
    await assert.rejects(read(youtubeTrafficSourcesZip(), 'youtube_search_terms'), /no Source title column/);
  });

  it('reads a table saved as one CSV, combines a repeated term, and refuses a table without a total or of another tool', async () => {
    const header = ['Traffic source', 'Source type', 'Source title', 'Views'];
    const data = await read(csv(header, [['Total', '', '', 5], ['YT_SEARCH.a', '', 'a', 2], ['YT_SEARCH.a ', '', 'a ', 3]]), 'youtube_search_terms');
    assert.deepEqual([data.rows, data.period, data.counts.merged_rows], [[{ name: 'a', views: 5, watch_hours: null }], null, 1]);
    await assert.rejects(read(csv(header, [['YT_SEARCH.a', '', 'a', 2]]), 'youtube_search_terms'), /no Total row/);
    await assert.rejects(read(bingAiPagesCsv(), 'youtube_search_terms'), /Traffic source and Views/);
  });
});

describe('youtubeImportProblem', () => {
  it('accepts what the parser returns, and refuses rows out of order, a term with a line break or an extra field', async () => {
    const good = record(await read(youtubeSearchTermsZip(), 'youtube_search_terms'), 'youtube_search_terms');
    assert.equal(youtubeImportProblem(good, 'youtube_search_terms'), null);
    assert.match(String(youtubeImportProblem({ ...good, rows: [...good.rows].reverse() }, 'youtube_search_terms')), /not in order/);
    assert.match(String(youtubeImportProblem({ ...good, rows: [{ name: 'a\nb', views: 1, watch_hours: null }] }, 'youtube_search_terms')), /not valid/);
    assert.match(String(youtubeImportProblem({ ...good, extra: true }, 'youtube_search_terms')), /fields/);
    assert.match(String(youtubeImportProblem(good, 'youtube_traffic_sources')), /source does not match/);
  });
});
