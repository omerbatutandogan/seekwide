/** @import { CheckDef } from '../../types.js' */

import { accessChecks } from './access.js';
import { contentChecks } from './content.js';
import { snippetChecks } from './snippet.js';
import { trainingChecks } from './training.js';

/**
 * The ai module, honest AI access and readiness: which AI crawlers robots.txt
 * lets in, the training and grounding preferences the site states, whether
 * its pages may be quoted in AI answers, and what a crawler that runs no
 * script sees. Shown as a count, never as a score. Defined in `docs/CHECKS-SPEC.md`.
 * @type {CheckDef[]}
 */
export const checks = [
  ...accessChecks,
  ...trainingChecks,
  ...snippetChecks,
  ...contentChecks,
];
