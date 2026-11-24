// The reviews report of Play Console, read from files written from the columns
// its help page lists, stored and checked like any import.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readTables } from '../../plugin/server/src/imports/parse.js';
import { reviewTables } from '../../plugin/server/src/imports/reviews-data.js';
import { REVIEW_IMPORT_SCHEMA_VERSION, reviewImportProblem } from '../../plugin/server/src/imports/reviews-record.js';
import { bingAiPagesCsv, csv, playReviewsNovember, playReviewsOctober } from '../helpers/exports.js';
import { makeZip } from '../helpers/zip.js';

/** @param {Buffer|string} bytes */
const read = async (bytes) => reviewTables((await readTables(Buffer.from(bytes))).tables);

/** @param {import('../../plugin/server/src/imports/reviews-data.js').ReviewTables} tables */
const record = (tables) => ({
  schema_version: REVIEW_IMPORT_SCHEMA_VERSION,
  source: /** @type {const} */ ('google_play_reviews'),
  imported_at: '2026-11-24T09:00:00.000Z',
  file: { path: 'reviews.csv', format: /** @type {const} */ ('csv'), bytes: 100, sha256: 'a'.repeat(64) },
  ...tables,
});

describe('reviewTables', () => {
  it('reads a UTF-16 month: stars by month, replies, and the unanswered 1- and 2-star reviews newest first, without their text', async () => {
    const data = await read(playReviewsOctober());
    assert.equal(data.apps.length, 1);
    const [app] = data.apps;
    assert.equal(app.package, 'com.example.app');
    assert.deepEqual(app.months, [{ month: '2026-10', reviews: 4, stars: [1, 1, 0, 1, 1], replied: 1 }]);
    assert.deepEqual(app.unanswered.map((review) => [review.submitted, review.stars, review.language, review.version_code]), [['2026-10-20', 2, 'tr', '42'], ['2026-10-05', 1, 'tr', '42']]);
    assert.match(String(app.unanswered[0].link), /^https:\/\/play\.google\.com\/.*reviewId=c$/);
    assert.equal(app.unanswered_total, 2);
    assert.doesNotMatch(JSON.stringify(data), /reviewer wrote|Thanks/);
    assert.deepEqual(data.counts, { tables: 1, other_tables: 0, reviews: 4, duplicates: 0, skipped_rows: 0 });
  });

  it('reads a zip of months as one import and counts a review in two files once', async () => {
    const zip = makeZip([{ name: 'reviews_com.example.app_202610.csv', data: playReviewsOctober() }, { name: 'reviews_com.example.app_202611.csv', data: playReviewsNovember() }]);
    const data = await read(zip);
    assert.deepEqual(data.apps[0].months.map((month) => [month.month, month.reviews, month.replied]), [['2026-10', 4, 1], ['2026-11', 2, 1]]);
    assert.equal(data.apps[0].unanswered_total, 3);
    assert.deepEqual([data.counts.reviews, data.counts.duplicates], [6, 1]);
  });

  it('reads the day from the date and time when the milliseconds are missing, and leaves out a row it cannot use', async () => {
    const data = await read(csv(['Package Name', 'Star Rating', 'Review Submit Date and Time'], [['com.example.app', '3', '2026-09-30T23:59:59Z'], ['not a package', '5', '2026-09-30T00:00:00Z'], ['com.example.app', '6', '2026-09-30T00:00:00Z']]));
    assert.deepEqual(data.apps[0].months, [{ month: '2026-09', reviews: 1, stars: [0, 0, 1, 0, 0], replied: 0 }]);
    assert.equal(data.counts.skipped_rows, 2);
  });

  it('keeps no link that is not on play.google.com', async () => {
    const header = ['Package Name', 'Star Rating', 'Review Submit Date and Time', 'Review Link'];
    const data = await read(csv(header, [['com.example.app', '1', '2026-09-01T00:00:00Z', 'https://evil.test/phish'], ['com.example.app', '1', '2026-09-02T00:00:00Z', 'javascript:alert(1)']]));
    assert.deepEqual(data.apps[0].unanswered.map((review) => review.link), [null, null]);
  });

  it('refuses another report and a file without a usable review', async () => {
    await assert.rejects(read(bingAiPagesCsv()), /Package Name, Star Rating and Review Submit Date and Time/);
    await assert.rejects(read(csv(['Package Name', 'Star Rating', 'Review Submit Date and Time'], [['com.example.app', '0', '2026-09-01T00:00:00Z']])), /no review Seekwide can use/);
  });
});

describe('reviewImportProblem', () => {
  it('accepts what the parser returns', async () => {
    assert.equal(reviewImportProblem(record(await read(playReviewsOctober())), 'google_play_reviews'), null);
  });

  it('refuses a damaged file: counts that do not add up, a foreign link, review text, months out of order', async () => {
    const good = record(await read(playReviewsOctober()));
    const app = good.apps[0];
    const withApp = (/** @type {object} */ changes) => ({ ...good, apps: [{ ...app, ...changes }] });
    assert.match(String(reviewImportProblem(withApp({ months: [{ ...app.months[0], reviews: 5 }] }), 'google_play_reviews')), /do not add up/);
    assert.match(String(reviewImportProblem(withApp({ unanswered: [{ ...app.unanswered[0], link: 'https://evil.test/' }, app.unanswered[1]] }), 'google_play_reviews')), /Play Console address/);
    assert.match(String(reviewImportProblem(withApp({ unanswered: [{ ...app.unanswered[0], text: 'hi' }, app.unanswered[1]] }), 'google_play_reviews')), /fields/);
    assert.match(String(reviewImportProblem(withApp({ months: [app.months[0], { ...app.months[0] }] }), 'google_play_reviews')), /not in order/);
    assert.match(String(reviewImportProblem({ ...good, counts: { ...good.counts, reviews: 9 } }, 'google_play_reviews')), /does not match/);
  });
});
