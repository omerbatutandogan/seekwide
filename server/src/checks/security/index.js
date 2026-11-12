/** @import { CheckDef } from '../../types.js' */

import { contentChecks } from './content.js';
import { embedChecks } from './embeds.js';
import { headerChecks } from './headers.js';
import { hiddenChecks } from './hidden.js';

/**
 * The security module: signs, measurable from outside, that a site was hacked
 * or misused, and the security headers of its start page. Defined in
 * `docs/CHECKS-SPEC.md`.
 * @type {CheckDef[]}
 */
export const checks = [
  ...hiddenChecks,
  ...contentChecks,
  ...embedChecks,
  ...headerChecks,
];
