/** @import { CheckDef } from '../../types.js' */

import { imageChecks } from './images.js';
import { ogChecks } from './og.js';
import { placementChecks } from './placement.js';
import { siteChecks } from './site.js';

/**
 * The smo module: whether the pages give social platforms and messaging apps
 * what they need for a sharing preview. Defined in `docs/CHECKS-SPEC.md`.
 * @type {CheckDef[]}
 */
export const checks = [
  ...ogChecks,
  ...placementChecks,
  ...imageChecks,
  ...siteChecks,
];
