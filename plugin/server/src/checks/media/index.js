/** @import { CheckDef } from '../../types.js' */

import { altChecks } from './alt.js';
import { fileChecks } from './files.js';
import { layoutChecks } from './layout.js';
import { videoChecks } from './video.js';

/**
 * The media module: text alternatives of images, the space they take, lazy
 * loading, the image files themselves, captions and video structured data.
 * Defined in `docs/CHECKS-SPEC.md`.
 * @type {CheckDef[]}
 */
export const checks = [
  ...altChecks,
  ...layoutChecks,
  ...fileChecks,
  ...videoChecks,
];
