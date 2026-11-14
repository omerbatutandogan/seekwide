// Apple's Smart App Banner meta tag on each page (aso module). Pure.

/** @import { AppBannerRecord, CheckDef, CheckResult } from '../../types.js' */

import { ASO, DOCS } from './helpers.js';

/**
 * True when a Smart App Banner's content names an app: an `app-id` parameter
 * whose value is the app's numeric Apple ID.
 * @param {AppBannerRecord} banner
 */
export function namesApp(banner) {
  return banner.content.split(',').some((part) => {
    const [key, ...rest] = part.split('=');
    return key.trim().toLowerCase() === 'app-id' && /^\d+$/.test(rest.join('=').trim());
  });
}

/**
 * The html pages with one or more Smart App Banner tags. Records made before
 * rule set 0.1.9 have no `social` and are left out.
 * @param {import('../../types.js').CheckContext} ctx
 */
const bannerPages = (ctx) => ctx.htmlPages.filter((page) => (page.social?.app_banners.length ?? 0) > 0);

/** @type {CheckDef} */
const appIdInvalid = {
  ...ASO,
  id: 'aso.banner.app_id_invalid',
  title: 'Smart App Banner without a valid app-id',
  description:
    'Checks every <meta name="apple-itunes-app"> tag for an app-id parameter whose value is the app\'s numeric Apple ID. Apple marks app-id as required; Safari shows no banner without one.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.APPLE_SMART_BANNER,
  recommendation: 'Write the tag as <meta name="apple-itunes-app" content="app-id=123456789">, with the number App Store Connect shows as the app\'s Apple ID.',
  run(ctx) {
    return bannerPages(ctx).map((page) => {
      const banners = /** @type {AppBannerRecord[]} */ (page.social?.app_banners);
      const bad = banners.find((banner) => !namesApp(banner));
      if (!bad) return /** @type {CheckResult} */ ({ status: 'pass', url: page.url });
      return {
        status: 'fail', url: page.url, selector: 'meta[name="apple-itunes-app"]', line: bad.line,
        evidence: { observed: { content: bad.content }, expected: 'app-id= followed by the app\'s numeric Apple ID' },
      };
    });
  },
};

/** @type {CheckDef} */
const outsideHead = {
  ...ASO,
  id: 'aso.banner.outside_head',
  title: 'Smart App Banner tag outside the head',
  description:
    'Checks pages with a Smart App Banner tag that has none inside <head>. Apple asks for the tag in the head element of each page that should show the banner. A Next.js App Router page can send its metadata in the body ("streaming metadata"), and whether Safari reads it there is not documented, which is why the finding is likely.',
  severity: 'low',
  weight: 1,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.APPLE_SMART_BANNER,
  recommendation: 'Move <meta name="apple-itunes-app"> into the <head> of the page. In Next.js, give it through the metadata API (itunes) and make sure the metadata is not streamed into the body.',
  run(ctx) {
    return bannerPages(ctx).map((page) => {
      const social = /** @type {import('../../types.js').SocialRecord} */ (page.social);
      if (social.app_banners.some((banner) => banner.in_head)) return /** @type {CheckResult} */ ({ status: 'pass', url: page.url });
      return {
        status: 'fail', url: page.url, selector: 'meta[name="apple-itunes-app"]', line: social.app_banners[0].line,
        evidence: {
          observed: { in_head: false, streamed: social.streamed },
          expected: 'The tag inside <head>',
          ...(social.streamed ? { detail: 'This Next.js page sent its metadata in the body (streaming metadata), together with its title.' } : {}),
        },
      };
    });
  },
};

export const bannerChecks = [appIdInvalid, outsideHead];
