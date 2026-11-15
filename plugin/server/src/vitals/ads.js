// The sxo module's observation of ads: the Chrome UX Report's experimental ad
// metrics for the audited origin, asked in a request of their own. Nothing
// Google does can make this fail: a refusal or no data becomes a reason.

/** @import { CrawlResult } from '../types.js' */
/** @import { AdMetrics } from './crux.js' */

import { queryCruxAds } from './crux.js';
import { describeFailure } from './google-api.js';
import { KEY_UNUSABLE, whyNotSent } from './measure.js';

export const ADS_NO_KEY = 'The Chrome UX Report needs a Google API key and none is set in the plugin settings, so the ad metrics were not asked for.';
export const ADS_NO_DATA = 'The Chrome UX Report has no ad data for this origin on phones. Chrome publishes these metrics only for pages with ads on sites whose ads.txt names an authorized seller, and only with enough visits.';
export const ADS_CANCELLED = 'The audit was cancelled before the ad metrics were asked for.';

/**
 * Ask the Chrome UX Report for the experimental ad metrics of a crawl's origin.
 *
 * Guarantees: at most one request, to the Chrome UX Report only, naming only
 * the origin besides the key; only for a crawl recorded as not on this
 * machine whose origin is a public host, and only with a usable key; never
 * retried; never throws for anything Google does: the result is the metrics,
 * or null with the sentence that says why.
 * @param {CrawlResult} crawl
 * @param {{apiKey?: string|null, apiKeyUnusable?: boolean, queryAds?: typeof queryCruxAds, signal?: AbortSignal}} [options]
 * @returns {Promise<{ads: AdMetrics|null, reason: string|null}>}
 */
export async function measureAds(crawl, options = {}) {
  const { apiKey = null, queryAds = queryCruxAds } = options;
  const refused = whyNotSent(crawl);
  if (refused !== null) return { ads: null, reason: refused };
  if (options.apiKeyUnusable === true) return { ads: null, reason: KEY_UNUSABLE };
  if (apiKey === null) return { ads: null, reason: ADS_NO_KEY };
  if (options.signal?.aborted) return { ads: null, reason: ADS_CANCELLED };
  const result = await queryAds(crawl.site_origin, { apiKey });
  if (!result.ok) return { ads: null, reason: describeFailure('crux', result.failure, true) };
  return result.ads === null ? { ads: null, reason: ADS_NO_DATA } : { ads: result.ads, reason: null };
}
