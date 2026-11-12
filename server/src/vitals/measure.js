// Collects the Core Web Vitals of one audit: picks the pages, asks PageSpeed
// Insights for lab data and the Chrome UX Report for field data, and says in
// plain words what it got and what it did not. Nothing Google does can make
// this fail: a refusal or a timeout becomes a reason, not an error.

import net from 'node:net';

import { LIMITS } from '../config.js';
import { classifyAddress } from '../net/ip.js';
import { queryCrux } from './crux.js';
import { describeFailure, isServiceFailure } from './google-api.js';
import { runPagespeed } from './psi.js';
import { selectVitalsPages } from './select.js';

/** @import { CrawlResult, VitalsData, VitalsPage } from '../types.js' */
/** @import { ApiFailure } from './google-api.js' */

/**
 * @typedef {Object} MeasureOptions
 * @property {string|null} [apiKey]   Google API key; without one only PageSpeed Insights is asked.
 * @property {boolean} [apiKeyUnusable]  A key is set but no request can carry it: nothing is sent, and the result says the key cannot be used.
 * @property {number} [maxPages]      Pages to test, 1 to `LIMITS.vitalsPagesMax`. Default `LIMITS.vitalsPagesDefault`.
 * @property {typeof runPagespeed} [runPagespeed]
 * @property {typeof queryCrux} [queryCrux]
 * @property {() => number} [now]     Clock in milliseconds, for the time budget.
 * @property {number} [deadlineMs]    No new request to either service starts after this much time.
 * @property {number} [concurrency]   PageSpeed Insights tests running at once when a key is set.
 */

/**
 * What the two collectors share while they run side by side.
 * @typedef {Object} RunState
 * @property {() => boolean} expired  True once the time set aside has passed.
 * @property {() => boolean} crashed  True once a client threw.
 * @property {(error: unknown) => void} fail  Record an exception thrown by a client. That is a programming
 *   error, not an answer from Google: no further request starts, and the error is rethrown once nothing is in flight.
 */

const NOT_PUBLIC = "The audited site is on this machine or on a private network, so Google's services cannot reach it. Nothing was sent to Google.";
const NOT_KNOWN_PUBLIC = 'This crawl does not record whether the site is on this machine, so nothing was sent to Google. Crawl the site again to measure Core Web Vitals.';
const NO_PAGES = 'No indexable HTML page was crawled, so there was no page to measure.';
const NO_KEY = 'No Google API key is set, and the Chrome UX Report API requires one. Add a key in the plugin settings to collect field data.';
const KEY_UNUSABLE = 'The Google API key in the plugin settings cannot be used: it holds a space, a line break or a character outside plain ASCII, or is longer than 256 characters, so no request can carry it. Nothing was sent to Google. Check the key in the plugin settings.';
const NO_FIELD_DATA = 'The Chrome UX Report has no phone data for this site or for the tested pages. It only publishes data for sites and pages with enough visits from Chrome users.';
const NO_ORIGIN_DATA = 'The Chrome UX Report has no phone data for this site.';
const NO_PAGE_DATA = 'The Chrome UX Report has no phone data for this page.';
const AFTER_REFUSAL = 'Not asked: an earlier request in this audit was refused.';
const AFTER_TIMEOUT = 'Not asked: the Chrome UX Report API did not answer an earlier request in time.';
const OUT_OF_TIME = 'Not tested: the time set aside for PageSpeed Insights ran out.';
const FIELD_OUT_OF_TIME = 'Not asked: the time set aside for the measurement ran out.';
/** Failed pages named in a note; the rest are in the page list. */
const MAX_NAMED = 3;

/**
 * Why the audited site must not be named to an outside service, or null when
 * it may be. Only a crawl that says the site is not on this machine passes:
 * a crawl file that lacks the answer (written by an older version, or edited)
 * is treated like a local one. A local host name or an address that is not
 * public is refused as well.
 * @param {CrawlResult} crawl
 * @returns {string|null}
 */
function whyNotSent(crawl) {
  const local = crawl.options?.local;
  if (local === true) return NOT_PUBLIC;
  if (local !== false) return NOT_KNOWN_PUBLIC;
  return mayLeaveMachine(crawl.site_origin) ? null : NOT_PUBLIC;
}

/** Names that only mean something on a local network (RFC 6761, RFC 6762, RFC 8375 and common use). */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.localdomain', '.home.arpa', '.intranet', '.corp'];

/**
 * Whether the host of `url` could be a public site: not this machine, not an
 * address that is not public, not a name that only works on a local network,
 * and not a single-label name. One trailing dot is ignored.
 * @param {string} url
 * @returns {boolean}
 */
export function mayLeaveMachine(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = (hostname.startsWith('[') ? hostname.slice(1, -1) : hostname).replace(/\.$/, '');
  if (net.isIP(bare) !== 0) return classifyAddress(bare) === 'public';
  if (bare === 'localhost' || !bare.includes('.')) return false;
  return !LOCAL_SUFFIXES.some((suffix) => bare.endsWith(suffix));
}

/**
 * The result when nothing could be measured, with the same reason for both sources.
 * @param {string} origin
 * @param {string} reason
 * @returns {VitalsData}
 */
export function unavailableVitals(origin, reason) {
  return {
    lab: { available: false, reason, device: 'mobile' },
    field: { available: false, reason, form_factor: 'phone' },
    origin: { origin, field: null, field_note: null },
    pages: [],
    notes: [reason],
  };
}

/**
 * Lab data: one PageSpeed Insights test per page. Without a key the tests run
 * one at a time. A refusal that concerns the service or the key stops the rest.
 * @param {VitalsPage[]} pages
 * @param {{apiKey: string|null, psi: typeof runPagespeed, concurrency: number, run: RunState}} deps
 * @returns {Promise<ApiFailure|null>} The refusal that stopped the tests, if any.
 */
async function collectLab(pages, { apiKey, psi, concurrency, run }) {
  /** @type {ApiFailure|null} */
  let refusal = null;
  const queue = [...pages];
  const worker = async () => {
    for (let page = queue.shift(); page !== undefined; page = queue.shift()) {
      if (run.crashed()) return;
      if (refusal !== null) {
        page.lab_note = AFTER_REFUSAL;
        continue;
      }
      if (run.expired()) {
        page.lab_note = OUT_OF_TIME;
        continue;
      }
      let result;
      try {
        result = await psi(page.url, { apiKey });
      } catch (error) {
        run.fail(error);
        return;
      }
      if (result.ok) {
        page.lab = result.lab;
      } else {
        page.lab_note = describeFailure('psi', result.failure, apiKey !== null);
        if (isServiceFailure(result.failure)) refusal = result.failure;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(apiKey === null ? 1 : concurrency, queue.length) }, worker));
  return refusal;
}

/**
 * Field data: the Chrome UX Report record of the origin, then of each page,
 * one request at a time. "No data" is an answer. A refusal stops the rest, and
 * so does a timeout: this API answers in well under a second and never loads
 * the page, so a request that hangs says something about the service.
 * @param {VitalsData} data
 * @param {{apiKey: string, crux: typeof queryCrux, run: RunState}} deps
 * @returns {Promise<void>}
 */
async function collectField(data, { apiKey, crux, run }) {
  /** @type {{slot: {field: VitalsPage['field'], field_note: string|null}, target: {url: string}|{origin: string}, missing: string}[]} */
  const targets = [
    { slot: data.origin, target: { origin: data.origin.origin }, missing: NO_ORIGIN_DATA },
    ...data.pages.map((page) => ({ slot: page, target: { url: page.url }, missing: NO_PAGE_DATA })),
  ];
  /** @type {string|null} Why the remaining addresses are not asked. */
  let stopped = null;
  let answered = false;
  /** @type {string|null} */
  let firstProblem = null;
  for (const { slot, target, missing } of targets) {
    if (run.crashed()) return;
    if (stopped === null && run.expired()) stopped = FIELD_OUT_OF_TIME;
    if (stopped !== null) {
      slot.field_note = stopped;
      continue;
    }
    let result;
    try {
      result = await crux(target, { apiKey });
    } catch (error) {
      run.fail(error);
      return;
    }
    if (result.ok) {
      answered = true;
      slot.field = result.record;
      slot.field_note = result.record === null ? missing : null;
    } else {
      slot.field_note = describeFailure('crux', result.failure, true);
      firstProblem ??= slot.field_note;
      if (isServiceFailure(result.failure)) stopped = AFTER_REFUSAL;
      else if (result.failure.kind === 'timeout') stopped = AFTER_TIMEOUT;
    }
  }
  data.field.available = answered;
  data.field.reason = answered ? null : (firstProblem ?? FIELD_OUT_OF_TIME);
}

/**
 * Measure the Core Web Vitals of the pages that matter most in a crawl.
 *
 * Guarantees: only a site the crawl records as not being on this machine, with
 * a public host, is named to Google; at most `maxPages` pages are tested,
 * chosen by `selectVitalsPages` and each recorded with the reason it was
 * chosen; PageSpeed Insights gets one request per page, the Chrome UX Report
 * one for the origin and one per page, and only when a key is set; nothing is
 * sent when the key that is set cannot be used (`apiKeyUnusable`); a refusal
 * that concerns the service or the key stops further requests to that service;
 * no new request starts after `deadlineMs`; whatever Google answers, the result
 * is a `VitalsData` whose `lab` and `field` say whether data arrived and, if
 * not, why. It rejects only for invalid options (`TypeError`) or when a client
 * itself throws, and then only once no request is in flight.
 *
 * @param {CrawlResult} crawl
 * @param {MeasureOptions} [options]
 * @returns {Promise<VitalsData>}
 */
export async function measureVitals(crawl, options = {}) {
  const { apiKey = null, maxPages = LIMITS.vitalsPagesDefault, now = Date.now } = options;
  const { deadlineMs = LIMITS.vitalsDeadlineMs, concurrency = LIMITS.psiConcurrency } = options;
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > LIMITS.vitalsPagesMax) {
    throw new TypeError(`measureVitals maxPages must be a whole number from 1 to ${LIMITS.vitalsPagesMax}`);
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new TypeError('measureVitals concurrency must be a positive integer');
  if (!Number.isFinite(deadlineMs) || deadlineMs < 0) throw new TypeError('measureVitals deadlineMs must be a non-negative number');
  if (options.apiKeyUnusable !== undefined && typeof options.apiKeyUnusable !== 'boolean') throw new TypeError('measureVitals apiKeyUnusable must be true or false');

  const refusedSite = whyNotSent(crawl);
  if (refusedSite !== null) return unavailableVitals(crawl.site_origin, refusedSite);
  // Each page is checked again, so a crawl file that names local pages under a public origin sends none of them.
  const selected = selectVitalsPages(crawl, maxPages).filter((page) => mayLeaveMachine(page.url));
  if (selected.length === 0) return unavailableVitals(crawl.site_origin, NO_PAGES);
  // Like a key Google refuses, a key that cannot be sent stops both services; running without it would hide the mistake.
  if (options.apiKeyUnusable === true) return unavailableVitals(crawl.site_origin, KEY_UNUSABLE);

  /** @type {VitalsData} */
  const data = {
    lab: { available: false, reason: null, device: 'mobile' },
    field: { available: false, reason: NO_KEY, form_factor: 'phone' },
    origin: { origin: crawl.site_origin, field: null, field_note: null },
    pages: selected.map(({ url, why }) => ({ url, why, lab: null, lab_note: null, field: null, field_note: null })),
    notes: [],
  };

  const started = now();
  /** @type {{thrown: boolean, error: unknown}} */
  const crash = { thrown: false, error: undefined };
  /** @type {RunState} */
  const run = {
    expired: () => now() - started >= deadlineMs,
    crashed: () => crash.thrown,
    fail: (error) => {
      if (!crash.thrown) Object.assign(crash, { thrown: true, error });
    },
  };
  const [refusal] = await Promise.all([
    collectLab(data.pages, { apiKey, psi: options.runPagespeed ?? runPagespeed, concurrency, run }),
    apiKey === null ? undefined : collectField(data, { apiKey, crux: options.queryCrux ?? queryCrux, run }),
  ]);
  if (crash.thrown) throw crash.error;

  const untested = data.pages.filter((page) => page.lab === null);
  data.lab.available = untested.length < data.pages.length;
  if (!data.lab.available) {
    data.lab.reason = refusal !== null
      ? describeFailure('psi', refusal, apiKey !== null)
      : `PageSpeed Insights returned no result for any of the ${data.pages.length} tested pages. The first problem: ${untested[0].lab_note}`;
    data.notes.push(data.lab.reason);
  } else if (untested.length > 0) {
    const named = untested.slice(0, MAX_NAMED).map((page) => `${page.url} (${page.lab_note})`).join('; ');
    const more = untested.length > MAX_NAMED ? `; and ${untested.length - MAX_NAMED} more` : '';
    data.notes.push(`PageSpeed Insights tested ${data.pages.length - untested.length} of ${data.pages.length} pages. Without a lab result: ${named}${more}.`);
  }

  for (const page of data.pages) {
    // Only the host of the address PageSpeed Insights ended on is named here: the page chose the rest of it.
    if (page.lab?.final_url) data.notes.push(`PageSpeed Insights was redirected from ${page.url} to a page on ${hostOf(page.lab.final_url)} and tested that page.`);
  }

  if (!data.field.available) {
    if (data.field.reason !== null) data.notes.push(data.field.reason);
  } else if (data.origin.field === null && data.pages.every((page) => page.field === null)) {
    data.notes.push(NO_FIELD_DATA);
  }
  return data;
}

/**
 * @param {string} url
 * @returns {string}
 */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return 'another address';
  }
}
