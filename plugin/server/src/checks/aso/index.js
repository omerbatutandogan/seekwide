/** @import { CheckDef } from '../../types.js' */

import { bannerChecks } from './banner.js';
import { fileChecks } from './files.js';

/**
 * The aso module, the site's side of its apps: Apple's Smart App Banner and
 * the association files that let an iOS or Android app open the site's links.
 * Defined in `docs/CHECKS-SPEC.md`.
 * @type {CheckDef[]}
 */
export const checks = [
  ...bannerChecks,
  ...fileChecks,
];
