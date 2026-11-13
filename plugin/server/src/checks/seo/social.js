/** @import { CheckDef } from '../../types.js' */

import { DOCS, SEO } from './common.js';

const REQUIRED = /** @type {const} */ (['title', 'image']);

/** @type {CheckDef} */
const ogIncomplete = {
  ...SEO,
  id: 'seo.social.og_incomplete',
  title: 'Open Graph title or image is missing',
  description:
    'Checks indexable pages for og:title and og:image. Social networks and messaging apps use them to build the preview card when the page is shared.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.OPEN_GRAPH,
  recommendation:
    'Add <meta property="og:title"> and <meta property="og:image"> with an absolute image URL to the <head>.',
  run(ctx) {
    return ctx.indexablePages.map((page) => {
      const missing = REQUIRED.filter((name) => (page.og[name] ?? '').trim() === '').map((name) => `og:${name}`);
      if (missing.length === 0) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        evidence: { observed: { missing }, expected: 'og:title and og:image with content' },
      };
    });
  },
};

export const socialChecks = [ogIncomplete];
