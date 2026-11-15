/** @import { CheckDef } from '../../types.js' */

import { autofillChecks } from './autofill.js';
import { formChecks } from './forms.js';
import { labChecks } from './lab.js';
import { nameChecks } from './names.js';

/**
 * The cro module: the technical health of the forms and contact paths of the
 * pages. It reads markup only: no form is ever submitted and no action URL is
 * requested. Defined in `docs/CHECKS-SPEC.md`.
 * @type {CheckDef[]}
 */
export const checks = [
  ...nameChecks,
  ...autofillChecks,
  ...formChecks,
  ...labChecks,
];
