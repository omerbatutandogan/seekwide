/** @import { CheckDef } from '../types.js' */

import { checks as linkChecks } from './links/index.js';
import { checks as securityChecks } from './security/index.js';
import { checks as seoChecks } from './seo/index.js';
import { prepareChecks } from './validate.js';

/**
 * Every check the plugin ships, validated and sorted by id.
 * @returns {CheckDef[]}
 */
export function allChecks() {
  return prepareChecks([...seoChecks, ...linkChecks, ...securityChecks]);
}
