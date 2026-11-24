/** @import { CheckDef } from '../../types.js' */

import { canonicalChecks } from './canonical.js';
import { contentChecks } from './content.js';
import { templateChecks } from './template.js';
import { articleChecks } from './article.js';
import { cwvChecks } from './cwv.js';
import { headingChecks } from './headings.js';
import { htmlChecks } from './html.js';
import { httpChecks } from './http.js';
import { hreflangChecks } from './hreflang.js';
import { httpsChecks } from './https.js';
import { indexingChecks } from './indexing.js';
import { localChecks } from './local.js';
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
  ...hreflangChecks,
  ...mobileChecks,
  ...htmlChecks,
  ...contentChecks,
  ...templateChecks,
  ...structuredDataChecks,
  ...localChecks,
  ...articleChecks,
  ...socialChecks,
  ...cwvChecks,
];
