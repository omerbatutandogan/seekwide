// The report's section on Play reviews, from imported monthly reviews reports
// of Play Console: how many reviews each app got, their stars, how many the
// developer replied to, and the 1- and 2-star reviews still without a reply.
// Supplied by the user, not measured; it changes no check, finding or score.

/** @import { ReviewImport } from '../imports/reviews-record.js' */

/** Months listed per app, newest last. */
export const MONTHS_LISTED = 12;
/** Unanswered reviews listed per app. */
export const UNANSWERED_LISTED = 10;

export const REVIEWS_SUPPLIED =
  'Imported from the reviews reports the user downloaded from Google Play Console. The averages are of the reviews in the files, not the rating Google Play shows, which Google ' +
  'calculates in its own way. What the reviewers wrote is not kept.';

/**
 * @typedef {Object} ReviewsView
 * @property {string} supplied
 * @property {string} file
 * @property {string} imported
 * @property {{package: string, figures: {label: string, value: string}[], months: {month: string, reviews: string, average: string, replied: string}[],
 *   unanswered: {submitted: string, stars: string, language: string, version: string, link: string|null}[], notes: string[]}[]} apps
 * @property {string[]} notes
 */

const count = (/** @type {number} */ value) => value.toLocaleString('en-US');
/** @param {number} part @param {number} whole */
const percent = (part, whole) => (whole === 0 ? '—' : `${Math.round((part / whole) * 100)} %`);
/** @param {[number, number, number, number, number]} stars @param {number} reviews */
const average = (stars, reviews) => (reviews === 0 ? '—' : (stars.reduce((sum, n, i) => sum + n * (i + 1), 0) / reviews).toFixed(2));

/**
 * The section on Play reviews, or null without an import.
 * @param {ReviewImport|null} data
 * @param {string[]|null} declared  The Android packages the project profile names, or null when it names none.
 * @returns {ReviewsView|null}
 */
export function viewReviews(data, declared) {
  if (data === null) return null;
  const apps = data.apps.map((app) => {
    const reviews = app.months.reduce((sum, month) => sum + month.reviews, 0);
    const replied = app.months.reduce((sum, month) => sum + month.replied, 0);
    /** @type {[number, number, number, number, number]} */
    const stars = [0, 0, 0, 0, 0];
    for (const month of app.months) month.stars.forEach((n, i) => { stars[i] += n; });
    const first = app.months[0].month;
    const last = app.months[app.months.length - 1].month;
    /** @type {string[]} */
    const notes = [];
    if (app.months.length > MONTHS_LISTED) notes.push(`The file covers ${count(app.months.length)} months; the last ${MONTHS_LISTED} are listed.`);
    if (app.unanswered_total > UNANSWERED_LISTED) notes.push(`${count(app.unanswered_total)} reviews of 1 or 2 stars have no reply; the ${UNANSWERED_LISTED} newest are listed.`);
    if (declared !== null && !declared.includes(app.package)) notes.push('The project profile does not name this package among its Android apps.');
    return {
      package: app.package,
      figures: [
        { label: 'Reviews', value: count(reviews) },
        { label: 'Months', value: first === last ? first : `${first} to ${last}` },
        { label: 'Average stars of these reviews', value: average(stars, reviews) },
        { label: 'Replied to', value: percent(replied, reviews) },
        { label: '1 or 2 stars without a reply', value: count(app.unanswered_total) },
      ],
      months: app.months.slice(-MONTHS_LISTED).map((month) => ({ month: month.month, reviews: count(month.reviews), average: average(month.stars, month.reviews), replied: percent(month.replied, month.reviews) })),
      unanswered: app.unanswered.slice(0, UNANSWERED_LISTED).map((review) => ({
        submitted: review.submitted, stars: String(review.stars), language: review.language ?? '—', version: review.version_code ?? '—', link: review.link,
      })),
      notes,
    };
  });
  /** @type {string[]} */
  const notes = [];
  if (data.counts.skipped_rows > 0) notes.push(`${count(data.counts.skipped_rows)} row${data.counts.skipped_rows === 1 ? '' : 's'} had no package name, stars or day Seekwide can read and ${data.counts.skipped_rows === 1 ? 'was' : 'were'} left out.`);
  if (data.counts.duplicates > 0) notes.push(`${count(data.counts.duplicates)} review${data.counts.duplicates === 1 ? ' was' : 's were'} in more than one file and counted once.`);
  return { supplied: REVIEWS_SUPPLIED, file: data.file.path, imported: data.imported_at.slice(0, 10), apps, notes };
}
