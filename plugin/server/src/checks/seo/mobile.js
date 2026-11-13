/** @import { CheckDef } from '../../types.js' */

import { DOCS, SEO } from './common.js';

/** @type {CheckDef} */
const viewportMissing = {
  ...SEO,
  id: 'seo.mobile.viewport_missing',
  title: 'Page has no viewport meta tag',
  description:
    'Checks that every HTML page has a <meta name="viewport"> with content. Without it, phones render the page at desktop width and shrink it, so text is hard to read.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.MOBILE,
  recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to the <head>.',
  run(ctx) {
    return ctx.htmlPages.map((page) => {
      if (page.viewport !== null && page.viewport.trim() !== '') return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        selector: 'meta[name=viewport]',
        evidence: {
          observed: page.viewport === null ? 'No viewport meta tag' : 'A viewport meta tag with empty content',
          expected: 'width=device-width, initial-scale=1',
        },
      };
    });
  },
};

export const mobileChecks = [viewportMissing];
