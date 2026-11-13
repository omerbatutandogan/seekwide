/** @import { CheckDef } from '../../types.js' */

import { canonicalChecks } from './canonical.js';
import { contentChecks } from './content.js';
import { cwvChecks } from './cwv.js';
import { headingChecks } from './headings.js';
import { htmlChecks } from './html.js';
import { httpChecks } from './http.js';
import { httpsChecks } from './https.js';
import { indexingChecks } from './indexing.js';
import { metaDescriptionChecks } from './meta-description.js';
import { mobileChecks } from './mobile.js';
import { redirectChecks } from './redirect.js';
import { robotsChecks } from './robots.js';
import { sitemapChecks } from './sitemap.js';
import { socialChecks } from './social.js';
import { structuredDataChecks } from './structured-data.js';
import { titleChecks } from './title.js';

/**
 * Every SEO check defined in docs/CHECKS-SPEC.md.
 * @type {CheckDef[]}
 */
export const checks = [
  ...robotsChecks,
  ...sitemapChecks,
  ...indexingChecks,
  ...httpsChecks,
  ...httpChecks,
  ...redirectChecks,
  ...titleChecks,
  ...metaDescriptionChecks,
  ...headingChecks,
  ...canonicalChecks,
  ...mobileChecks,
  ...htmlChecks,
  ...contentChecks,
  ...structuredDataChecks,
  ...socialChecks,
  ...cwvChecks,
];
