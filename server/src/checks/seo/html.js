/** @import { CheckDef } from '../../types.js' */

import { DOCS, SEO } from './common.js';

/** @type {CheckDef} */
const langMissing = {
  ...SEO,
  id: 'seo.html.lang_missing',
  title: 'Page does not declare its language',
  description:
    'Checks that every HTML page sets a lang attribute on <html>. It tells browsers, screen readers and translation tools which language the page is written in.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.LANG,
  recommendation: 'Add a lang attribute with the page\'s main language to the <html> element, for example <html lang="en">.',
  run(ctx) {
    return ctx.htmlPages.map((page) => {
      if (page.html_lang !== null) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        selector: 'html',
        evidence: { observed: 'No lang attribute on <html>', expected: 'A language code such as "en" or "tr"' },
      };
    });
  },
};

export const htmlChecks = [langMissing];
