// The report's section on search on YouTube, from imported exports of YouTube
// Studio: the terms people searched for on YouTube before they watched the
// channel, and how much of the channel's watching came from YouTube's search.
// Supplied by the user, not measured; it changes no check, finding or score.

/** @import { YoutubeImport } from '../imports/youtube-record.js' */

/** Search terms listed. */
export const TERMS_LISTED = 25;

export const YOUTUBE_SUPPLIED =
  'Imported from exports of YouTube Studio the user downloaded. The figures are what YouTube reports for the channel; Seekwide did not measure them and sent no request to YouTube.';

/**
 * @typedef {Object} YoutubeView
 * @property {string} supplied
 * @property {{file: string, imported: string, period: string, figures: {label: string, value: string}[], rows: {name: string, views: string, share: string, hours: string}[], notes: string[]}|null} terms
 * @property {{file: string, imported: string, period: string, figures: {label: string, value: string}[], rows: {name: string, views: string, share: string, hours: string}[], notes: string[]}|null} sources
 */

const count = (/** @type {number} */ value) => value.toLocaleString('en-US');
/** @param {number} part @param {number} whole */
const percent = (part, whole) => (whole === 0 ? '—' : `${((part / whole) * 100).toFixed(1)} %`);
/** @param {number|null} value */
const hoursText = (value) => (value === null ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 }));
/** @param {YoutubeImport} data */
const periodText = (data) => (data.period === null ? 'Not stated in the file' : `${data.period.start} to ${data.period.end}`);

/**
 * The section on search on YouTube, or null without a YouTube Studio import.
 * @param {YoutubeImport[]} imports
 * @returns {YoutubeView|null}
 */
export function viewYoutube(imports) {
  if (imports.length === 0) return null;
  const terms = imports.find((data) => data.source === 'youtube_search_terms') ?? null;
  const sources = imports.find((data) => data.source === 'youtube_traffic_sources') ?? null;
  return { supplied: YOUTUBE_SUPPLIED, terms: terms === null ? null : viewTerms(terms), sources: sources === null ? null : viewSources(sources) };
}

/** @param {YoutubeImport} data */
function viewTerms(data) {
  const top = data.rows.slice(0, TERMS_LISTED);
  const topViews = top.reduce((sum, row) => sum + row.views, 0);
  /** @type {string[]} */
  const notes = ['The terms are what people searched for on YouTube before they watched; they say which topics people look for on YouTube, not how the site does in web search.'];
  if (data.truncated_at !== null) notes.push(`YouTube lists the top ${count(data.truncated_at)} terms only, so terms beyond them are not in the file.`);
  if (data.counts.merged_rows > 0) notes.push(`${count(data.counts.merged_rows)} row${data.counts.merged_rows === 1 ? '' : 's'} repeated a term and ${data.counts.merged_rows === 1 ? 'was' : 'were'} combined.`);
  return {
    file: data.file.path,
    imported: data.imported_at.slice(0, 10),
    period: periodText(data),
    figures: [
      { label: 'Views from YouTube search', value: count(data.total.views) },
      { label: 'Search terms in the file', value: count(data.rows.length) },
      { label: `Share of search views from the top ${Math.min(TERMS_LISTED, data.rows.length)} terms`, value: percent(topViews, data.total.views) },
    ],
    rows: top.map((row) => ({ name: row.name, views: count(row.views), share: percent(row.views, data.total.views), hours: hoursText(row.watch_hours) })),
    notes,
  };
}

/** @param {YoutubeImport} data */
function viewSources(data) {
  const search = data.rows.find((row) => row.name === 'YouTube search') ?? null;
  return {
    file: data.file.path,
    imported: data.imported_at.slice(0, 10),
    period: periodText(data),
    figures: [
      { label: 'Views', value: count(data.total.views) },
      { label: 'Share of views from YouTube search', value: search === null ? '—' : percent(search.views, data.total.views) },
    ],
    rows: data.rows.map((row) => ({ name: row.name, views: count(row.views), share: percent(row.views, data.total.views), hours: hoursText(row.watch_hours) })),
    notes: search === null ? ['The file has no "YouTube search" row; YouTube names the traffic sources in the language of the interface, and only the English name is recognized.'] : [],
  };
}
