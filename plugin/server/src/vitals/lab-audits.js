// Lighthouse's accessibility and best-practices audits added to a measurement
// that was made without them (cro module after a seo audit of the same crawl).
// The Core Web Vitals values of the measurement are kept as they are: only the
// audits are asked for, and the Chrome UX Report is not asked again.

/** @import { CrawlResult, VitalsData, VitalsPage } from '../types.js' */
/** @import { ApiFailure } from './google-api.js' */

import { LIMITS } from '../config.js';
import { isPublicHost } from '../util/site-identity.js';
import { describeFailure, isServiceFailure } from './google-api.js';
import { runPagespeed } from './psi.js';

export const AUDITS_NONE = 'No tested page has a lab result to add Lighthouse\'s audits to.';

/**
 * The measurement with Lighthouse's `target-size` and `errors-in-console`
 * audits added to the lab result of each tested page.
 *
 * Guarantees: every value of `base` is kept; one PageSpeed Insights request
 * with only the two categories per tested page that has a lab result and a
 * public host; nothing is sent when `refused` names a reason or the key cannot
 * be used; a refusal of the service or the key stops the rest; no request
 * starts after `deadlineMs` or after `signal` fired; never throws for anything
 * Google does. `lab.audits_requested` is true in the result, and
 * `lab.audits_reason` says why no page got the audits, when none did.
 * @param {CrawlResult} crawl
 * @param {VitalsData} base
 * @param {{apiKey: string|null, refused: string|null, keyUnusable: string|null, psi?: typeof runPagespeed, now?: () => number,
 *          deadlineMs?: number, concurrency?: number, signal?: AbortSignal}} options
 * @returns {Promise<VitalsData>}
 */
export async function addLabAudits(crawl, base, options) {
  const { apiKey, psi = runPagespeed, now = Date.now, deadlineMs = LIMITS.vitalsDeadlineMs, concurrency = LIMITS.psiConcurrency } = options;
  /** @param {string} reason @returns {VitalsData} */
  const without = (reason) => ({ ...base, lab: { ...base.lab, audits_requested: true, audits_reason: reason } });
  if (options.refused !== null) return without(options.refused);
  if (options.keyUnusable !== null) return without(options.keyUnusable);
  const pages = base.pages.map((page) => ({ ...page }));
  const queue = pages.filter((page) => page.lab !== null && isPublicHost(page.url));
  if (queue.length === 0) return without(AUDITS_NONE);
  const started = now();
  /** @type {ApiFailure|null} */
  let refusal = null;
  /** @type {string|null} */
  let firstProblem = null;
  const expired = () => options.signal?.aborted === true || now() - started >= deadlineMs;
  const todo = [...queue];
  const worker = async () => {
    for (let page = todo.shift(); page !== undefined; page = todo.shift()) {
      if (refusal !== null || expired()) continue;
      const result = await psi(page.url, { apiKey, labAudits: true, auditsOnly: true });
      if (result.ok && result.lab.audits) page.lab = { .../** @type {NonNullable<VitalsPage['lab']>} */ (page.lab), audits: result.lab.audits };
      else if (!result.ok) {
        firstProblem ??= describeFailure('psi', result.failure, apiKey !== null);
        if (isServiceFailure(result.failure)) refusal = result.failure;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(apiKey === null ? 1 : concurrency, queue.length) }, worker));
  const added = pages.filter((page) => page.lab?.audits !== undefined).length;
  if (added === 0) return { ...without(firstProblem ?? 'PageSpeed Insights gave no audit in the time set aside.'), pages };
  // No note is added here: the measurement is stored, and only the audit that asked for the audits says so (`auditsAddedNote`).
  return { ...base, lab: { ...base.lab, audits_requested: true }, pages };
}
