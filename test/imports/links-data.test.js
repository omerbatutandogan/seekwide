// The Links report of Search Console, read from exports shaped like the real
// downloads of 2026-11-24, stored and checked like any import.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { linkTables } from '../../plugin/server/src/imports/links-data.js';
import { LINK_IMPORT_SCHEMA_VERSION, linkImportProblem } from '../../plugin/server/src/imports/links-record.js';
import { readTables } from '../../plugin/server/src/imports/parse.js';
import { SITE, bingAiPagesCsv, csv, googleLatestLinksCsv, googleTopLinkedCsv } from '../helpers/exports.js';

/** @param {string|Buffer} bytes @param {import('../../plugin/server/src/imports/links-data.js').LinkSource} source */
const read = async (bytes, source) => linkTables((await readTables(Buffer.from(bytes))).tables, source);

/** @param {import('../../plugin/server/src/imports/links-data.js').LinkTables} tables @param {import('../../plugin/server/src/imports/links-data.js').LinkSource} source */
const record = (tables, source) => ({
  schema_version: LINK_IMPORT_SCHEMA_VERSION,
  source,
  imported_at: '2026-11-24T09:00:00.000Z',
  file: { path: 'links.csv', format: 'csv', bytes: 100, sha256: 'a'.repeat(64) },
  ...tables,
});

describe('linkTables', () => {
  it('reads the top linked pages, most incoming links first, and leaves out a row with no address', async () => {
    const data = await read(googleTopLinkedCsv(), 'google_search_console_links');
    assert.deepEqual(data.targets.map((row) => [row.url, row.links, row.sites]), [
      [`${SITE}/`, 30, 12], [`${SITE}/pricing`, 4, 2], [`${SITE}/old-page`, 3, 3], [`${SITE}/gone`, 2, 1],
    ]);
    assert.deepEqual(data.linking, []);
    assert.deepEqual(data.counts, { tables: 1, other_tables: 0, skipped_rows: 1, merged_rows: 0 });
  });

  it('combines two rows that name one address, and refuses more linking sites than incoming links', async () => {
    const data = await read(csv(['Target page', 'Incoming links', 'Linking sites'], [[`${SITE}/a`, 2, 2], [`${SITE}/a#top`, 3, 1]]), 'google_search_console_links');
    assert.deepEqual([data.targets, data.counts.merged_rows], [[{ url: `${SITE}/a`, links: 5, sites: 2 }], 1]);
    await assert.rejects(read(csv(['Target page', 'Incoming links', 'Linking sites'], [[`${SITE}/a`, 1, 2]]), 'google_search_console_links'), /more linking sites than incoming links/);
  });

  it('reads Latest links newest first, keeps the newest day of an address, and reads an address broken over lines', async () => {
    const data = await read(googleLatestLinksCsv(), 'google_search_console_latest_links');
    assert.deepEqual(data.linking.map((row) => row.last_crawled), ['2026-11-15', '2026-10-28', '2026-10-20', '2026-06-14']);
    assert.equal(data.linking[0].url, 'https://blog.other.test/post');
    assert.match(data.linking[1].url, /^https:\/\/directory\.other\.test\/list\?employees%5B3%5D=50.*page=7$/);
    assert.doesNotMatch(data.linking[1].url, /[\r\n ]/);
    assert.deepEqual([data.targets, data.counts.merged_rows], [[], 1]);
  });

  it('refuses another table, a date it cannot read, and a table with no usable address', async () => {
    await assert.rejects(read(bingAiPagesCsv(), 'google_search_console_links'), /Target page, Incoming links and Linking sites/);
    await assert.rejects(read(googleTopLinkedCsv(), 'google_search_console_latest_links'), /Linking page and Last crawled/);
    await assert.rejects(read(csv(['Linking page', 'Last crawled'], [['https://a.test/', '11/15/2026']]), 'google_search_console_latest_links'), /row 2 has no date written YYYY-MM-DD/);
    await assert.rejects(read(csv(['Target page', 'Incoming links', 'Linking sites'], [['nothing', 1, 1]]), 'google_search_console_links'), /names no page/);
  });
});

describe('linkImportProblem', () => {
  it('accepts what the parser returns, for each source', async () => {
    assert.equal(linkImportProblem(record(await read(googleTopLinkedCsv(), 'google_search_console_links'), 'google_search_console_links'), 'google_search_console_links'), null);
    assert.equal(linkImportProblem(record(await read(googleLatestLinksCsv(), 'google_search_console_latest_links'), 'google_search_console_latest_links'), 'google_search_console_latest_links'), null);
  });

  it('refuses a damaged file: another source, an extra field, rows out of order, an address with a line break', async () => {
    const good = record(await read(googleTopLinkedCsv(), 'google_search_console_links'), 'google_search_console_links');
    assert.match(String(linkImportProblem(good, 'google_search_console_latest_links')), /source does not match/);
    assert.match(String(linkImportProblem({ ...good, extra: 1 }, 'google_search_console_links')), /fields/);
    assert.match(String(linkImportProblem({ ...good, targets: [...good.targets].reverse() }, 'google_search_console_links')), /not in order/);
    assert.match(String(linkImportProblem({ ...good, targets: [{ url: `${SITE}/a\nb`, links: 1, sites: 1 }] }, 'google_search_console_links')), /normalized/);
    assert.match(String(linkImportProblem({ ...good, linking: [{ url: `${SITE}/`, last_crawled: '2026-11-01' }] }, 'google_search_console_links')), /linking is not a list/);
  });
});
