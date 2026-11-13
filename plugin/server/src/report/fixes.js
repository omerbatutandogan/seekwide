// The "Fixes verified in this run" section: what a re-audit says about the
// findings that were fixed after an earlier run.

/** @import { Run } from '../types.js' */

import { clip } from '../util/strings.js';
import { plural } from './facts.js';
import { obj, str, text } from './values.js';

const OUTCOMES = /** @type {const} */ (['closed', 'replaced', 'open', 'unverified']);
const MAX_ROWS = 100;
const DETAIL_MAX = 600;

/**
 * The fix verification of a run as the reports show it, or null when the run
 * holds none. Nothing in the stored value is taken on trust: an outcome the
 * plugin does not know is shown as not verified, and the counts are made from
 * the rows, never read from the file.
 * @param {Run} run
 */
export function viewFixes(run) {
  const fixes = obj(run.fixes);
  if (!Array.isArray(fixes.results)) return null;
  // An entry that is not an object, or names no check, is not a result.
  const all = fixes.results.filter((raw) => str(obj(raw).check_id) !== '').map((raw) => {
    const result = obj(raw);
    const outcome = OUTCOMES.find((known) => known === result.outcome) ?? 'unverified';
    const url = str(result.url);
    const file = text(result.file);
    return {
      outcome,
      checkId: str(result.check_id),
      title: text(result.title) || str(result.check_id),
      url: url === '' ? null : url,
      file: file === '' ? null : clip(file, 300),
      detail: clip(text(result.detail, 'No detail recorded.'), DETAIL_MAX),
      replacedBy: (Array.isArray(result.replaced_by) ? result.replaced_by : []).slice(0, 5).map((entry) => {
        const next = obj(entry);
        return clip(`${text(next.title) || str(next.check_id)} (${str(next.check_id)})`, 300);
      }),
    };
  });
  if (all.length === 0) return null;
  const count = (/** @type {typeof OUTCOMES[number]} */ outcome) => all.filter((row) => row.outcome === outcome).length;
  const parts = [
    `${count('closed')} closed`,
    ...(count('replaced') > 0 ? [`${count('replaced')} replaced by another finding`] : []),
    ...(count('open') > 0 ? [`${count('open')} still open`] : []),
    ...(count('unverified') > 0 ? [`${count('unverified')} not verified`] : []),
  ];
  // Closed first, then what still needs attention.
  const rows = [...all].sort((a, b) => OUTCOMES.indexOf(a.outcome) - OUTCOMES.indexOf(b.outcome));
  return {
    baseRunId: text(fixes.base_run_id, 'unknown'),
    summary: `${plural(all.length, 'fixed finding')} ${all.length === 1 ? 'was' : 'were'} checked again: ${parts.join(', ')}.`,
    rows: rows.slice(0, MAX_ROWS),
    more: Math.max(0, rows.length - MAX_ROWS),
    notes: (Array.isArray(fixes.notes) ? fixes.notes : []).filter((note) => typeof note === 'string').map((note) => clip(note, 600)),
  };
}
