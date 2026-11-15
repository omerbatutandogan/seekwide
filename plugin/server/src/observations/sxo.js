// The sxo module's observation (rule set 0.2.1): the experimental ad metrics of
// the Chrome UX Report for the audited origin. Chrome gives no threshold, so
// none is applied: it never changes a score and is not a finding. Pure.

/** @import { Observation } from '../types.js' */
/** @import { AdMetrics } from '../vitals/crux.js' */

import { notAvailable } from './cro.js';

export const ADS_SOURCE = 'https://developer.chrome.com/docs/ads/metrics/density';

/**
 * The observation of what `measureAds` returned.
 * @param {{ads: AdMetrics|null, reason: string|null}} result
 * @returns {Observation}
 */
export function adObservation({ ads, reason }) {
  if (ads === null) return notAvailable('sxo.crux_ad_metrics', reason ?? 'The ad metrics were not measured.', ADS_SOURCE);
  return {
    id: 'sxo.crux_ad_metrics', module: 'sxo', status: 'measured', reason: null,
    values: {
      density: ads.density, count: ads.count, cpu_ms: ads.cpu_ms, kilobytes: ads.kilobytes,
      period_first: ads.period?.first ?? null, period_last: ads.period?.last ?? null,
    },
    urls: [], source: ADS_SOURCE,
  };
}
