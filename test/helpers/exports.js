// Synthetic search performance exports, written from what the help pages
// document (docs/IMPORTS.md): the metric names of each tool in English and in
// Turkish, Search Console's CSV download as a zip of one CSV per table plus a
// table of filters, its Excel file as one sheet per table, and Bing's tables as
// CSV. The header of the column that is not a metric, the file names and the
// number formats are not documented; the ones here are plausible stand-ins,
// and the parser does not depend on them. No real user data.

import { makeXlsx, makeZip } from './zip.js';

export const SITE = 'https://example.test';

/** Pages with clicks, impressions, CTR and position, most clicks first. */
export const PAGES = [
  [`${SITE}/`, 120, 4000, 4.2],
  [`${SITE}/pricing`, 40, 2500, 6.8],
  [`${SITE}/about`, 12, 900, 9.1],
  [`${SITE}/blog/launch`, 3, 300, 14.5],
  [`${SITE}/old-page`, 0, 50, 31],
];

/** Days with clicks, impressions, CTR and position. */
export const DATES = [
  ['2026-10-01', 60, 2600, 5.1],
  ['2026-10-02', 70, 2700, 5.5],
  ['2026-10-03', 45, 2450, 6],
];

/**
 * @param {string[]} header
 * @param {(string|number)[][]} rows
 * @param {string} [delimiter]
 */
export function csv(header, rows, delimiter = ',') {
  const cell = (/** @type {string|number} */ value) => (/[",;\n]/.test(String(value)) ? `"${String(value).replace(/"/g, '""')}"` : String(value));
  return [header, ...rows].map((row) => row.map(cell).join(delimiter)).join('\r\n') + '\r\n';
}

/** @param {number} clicks @param {number} impressions */
const ctr = (clicks, impressions) => `${((clicks / impressions) * 100).toFixed(2)}%`;

/** Search Console's CSV download with English headers. */
export function googleZipEnglish() {
  const header = (/** @type {string} */ first) => [first, 'Clicks', 'Impressions', 'CTR', 'Position'];
  return makeZip([
    { name: 'Queries.csv', data: csv(header('Top queries'), [['pricing', 30, 900, ctr(30, 900), 3.2]]) },
    { name: 'Pages.csv', data: csv(header('Top pages'), PAGES.map(([url, c, i, p]) => [url, c, i, ctr(Number(c), Number(i)), p])) },
    { name: 'Countries.csv', data: csv(header('Country'), [['Turkey', 100, 5000, ctr(100, 5000), 5]]) },
    { name: 'Devices.csv', data: csv(header('Device'), [['Mobile', 100, 5000, ctr(100, 5000), 5]]) },
    { name: 'Search appearance.csv', data: csv(header('Search Appearance'), []) },
    { name: 'Dates.csv', data: csv(header('Date'), DATES.map(([d, c, i, p]) => [d, c, i, ctr(Number(c), Number(i)), p])) },
    { name: 'Filters.csv', data: csv(['Filter', 'Value'], [['Search type', 'Web'], ['Date', 'Last 3 days']]) },
  ]);
}

/**
 * Search Console's CSV download from a Turkish interface: the metric names of
 * the Turkish help page, decimal commas, grouped thousands, and the file names
 * a Turkish download was reported to use.
 */
export function googleZipTurkish() {
  const header = (/** @type {string} */ first) => [first, 'Tıklama sayısı', 'Gösterim sayısı', 'TO', 'Ortalama konum'];
  const decimal = (/** @type {number} */ value) => String(value).replace('.', ',');
  const percent = (/** @type {number} */ c, /** @type {number} */ i) => `%${((c / i) * 100).toFixed(2).replace('.', ',')}`;
  return makeZip([
    { name: 'Sorgular.csv', data: csv(header('En çok yapılan sorgular'), [['fiyat', 30, 900, percent(30, 900), '3,2']]) },
    { name: 'Sayfa sayısı.csv', data: csv(header('Popüler sayfalar'), [[`${SITE}/`, '1.234', '45.678', percent(1234, 45678), '4,2'], [`${SITE}/fiyat`, 40, 2500, percent(40, 2500), decimal(6.8)]]) },
    { name: 'Tarihler.csv', data: csv(header('Tarih'), [['2026-10-01', '1.274', '48.178', percent(1274, 48178), '4,3']]) },
    { name: 'Filtreler.csv', data: csv(['Filtre', 'Değer'], [['Arama türü', 'Web']]) },
  ]);
}

/** Search Console's Excel file: one sheet per table, numbers stored as numbers, dates as date-formatted serials. */
export function googleXlsx() {
  const header = (/** @type {string} */ first) => [first, 'Clicks', 'Impressions', 'CTR', 'Position'];
  // 46296 is 2026-10-01 in the 1900 date system.
  return makeXlsx([
    { name: 'Queries', rows: [header('Top queries'), ['pricing', 30, 900, 0.0333, 3.2]] },
    { name: 'Pages', rows: [header('Top pages'), ...PAGES.map(([url, c, i, p]) => [url, c, i, Number(c) / Number(i), p])] },
    { name: 'Dates', rows: [header('Date'), ...DATES.map(([, c, i, p], n) => [{ date: 46296 + n }, c, i, Number(c) / Number(i), p])] },
    { name: 'Filters', rows: [['Filter', 'Value'], ['Search type', 'Web']] },
  ]);
}

/** The Pages table of Bing's Search Performance report, as the help page names its columns. */
export function bingPagesCsv() {
  return csv(['Page', 'Impressions', 'Clicks', 'Avg. CTR', 'Avg. position'], [
    [`${SITE}/`, 800, 30, '3.75%', 3.1],
    [`${SITE}/about`, 200, 4, '2.00%', 7.4],
  ]);
}
