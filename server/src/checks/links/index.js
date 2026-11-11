/** @import { CheckDef } from '../../types.js' */

import { anchorChecks } from './anchor.js';
import { depthChecks } from './depth.js';
import { internalChecks } from './internal.js';
import { orphanChecks } from './orphan.js';
import { outboundChecks } from './outbound.js';

/**
 * The links module: ten scripted checks defined in `docs/CHECKS-SPEC.md`.
 * @type {CheckDef[]}
 */
export const checks = [
  ...internalChecks,
  ...anchorChecks,
  ...orphanChecks,
  ...depthChecks,
  ...outboundChecks,
];
