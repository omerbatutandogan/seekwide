/** @import { CheckDef } from '../../types.js' */

import { experienceChecks } from './experience.js';
import { titleChecks } from './title.js';

/**
 * The sxo module: what a searcher meets between the search result and the
 * page: the titles Google rewrites, zooming on a phone, and redirects to a
 * consent or input page. Defined in `docs/CHECKS-SPEC.md`.
 * @type {CheckDef[]}
 */
export const checks = [
  ...titleChecks,
  ...experienceChecks,
];
