// Whether a URL can be indexed as it stands, and why not. Pure, and kept apart
// from the HTML parser so that the crawler can use it without loading one.

/** @import { Indexability, PageRecord } from '../types.js' */

const NOINDEX = ['noindex', 'none'];

/**
 * Reasons in the documented order: fetch_error, redirect, status_<code>,
 * not_html, noindex_meta, noindex_header, canonical_elsewhere. A record with
 * no response (status 0), with an unusable response (`fetch_error`) or for a
 * followed redirect gets no status or not_html reason.
 * @param {Omit<PageRecord, 'indexability'>} record
 * @returns {Indexability}
 */
export function indexabilityOf(record) {
  /** @type {string[]} */
  const reasons = [];
  if (record.fetch_error !== null || record.status === 0) reasons.push('fetch_error');
  if (record.redirect_chain.length > 0) {
    reasons.push('redirect');
  } else if (record.status !== 0 && record.fetch_error === null) {
    if (record.status !== 200) reasons.push(`status_${record.status}`);
    if (!record.is_html) reasons.push('not_html');
  }
  if (record.meta_robots.some((token) => NOINDEX.includes(token))) reasons.push('noindex_meta');
  if (record.x_robots.some((token) => NOINDEX.includes(token))) reasons.push('noindex_header');
  const effective = record.canonicals.filter((canonical) => canonical.in_head && canonical.url !== null);
  if (effective.length > 0 && effective.every((canonical) => canonical.url !== record.url)) {
    reasons.push('canonical_elsewhere');
  }
  return { indexable: reasons.length === 0, reasons };
}
