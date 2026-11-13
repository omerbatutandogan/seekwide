/** @import { CheckDef, CheckResult } from '../../types.js' */

/** Pages deeper than this many clicks from the start page fail. A rule of thumb, not a Google limit. */
const MAX_DEPTH = 4;

/** @type {CheckDef} */
const deep = {
  id: 'links.depth.deep',
  module: 'links',
  engine: 'code',
  title: 'Page deep in the site structure',
  description: `Looks at indexable pages that take more than ${MAX_DEPTH} clicks to reach from the start page, which is a rule of thumb rather than a Google limit. Google can use the number of links it takes to reach a page as one signal of how important the page is.`,
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 3,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref:
    'https://developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure',
  last_verified: '2026-11-11',
  recommendation:
    'Link to the page from one that is closer to the start page, such as a category page, a hub page or the main navigation.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.indexablePages) {
      const { depth } = page;
      if (typeof depth !== 'number') continue;
      if (depth <= MAX_DEPTH) {
        results.push({ status: 'pass', url: page.url });
        continue;
      }
      results.push({
        status: 'fail',
        url: page.url,
        evidence: {
          observed: { depth },
          expected: `${MAX_DEPTH} clicks or fewer from the start page`,
          detail: `The shortest path the crawler found to this page takes ${depth} clicks from the start page.`,
        },
      });
    }
    return results;
  },
};

/** The click-depth checks. */
export const depthChecks = [deep];
