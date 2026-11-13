/** @import { CheckDef, CheckResult } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { DOCS, SEO } from './common.js';

/** @type {CheckDef} */
const invalidJson = {
  ...SEO,
  id: 'seo.structured_data.invalid_json',
  title: 'JSON-LD block is not valid JSON',
  description:
    'Parses every <script type="application/ld+json"> block on HTML pages. A block with a JSON syntax error cannot be read, so none of its structured data is used.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.STRUCTURED_DATA,
  recommendation:
    'Fix the JSON syntax in the block (often a trailing comma, an unescaped quote or a missing bracket), then test the page with the Rich Results Test.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      page.jsonld.forEach((block, index) => {
        const selector = `jsonld[${index + 1}]`;
        if (block.valid) {
          results.push({ status: 'pass', url: page.url, selector });
          return;
        }
        results.push({
          status: 'fail',
          url: page.url,
          selector,
          line: block.line,
          evidence: {
            observed: 'Invalid JSON',
            expected: 'A JSON-LD block that parses as JSON',
            ...(block.error ? { detail: clip(block.error) } : {}),
          },
        });
      });
    }
    return results;
  },
};

export const structuredDataChecks = [invalidJson];
