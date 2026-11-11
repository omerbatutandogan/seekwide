/** @import { CheckDef } from '../../types.js' */

import { DOCS, SEO, duplicateResults, otherPages } from './common.js';

/** Pages below this word count are too short to compare reliably. */
const MIN_WORDS_FOR_DUPLICATE = 50;
const THIN_WORDS = 100;

/** @type {CheckDef} */
const duplicateBody = {
  ...SEO,
  id: 'seo.content.duplicate_body',
  title: 'Page text is identical to other pages',
  description:
    'Compares the visible text of indexable pages with 50 or more words. When several URLs show the same content, search engines pick one to show and the others compete with it.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 2,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.CANONICAL,
  recommendation:
    'Choose one URL for this content: redirect the copies to it or point their canonical links at it, or rewrite the pages so each has its own content.',
  run(ctx) {
    const units = ctx.indexablePages.filter((page) => page.word_count >= MIN_WORDS_FOR_DUPLICATE && page.text_hash !== '');
    return duplicateResults(
      units,
      (page) => page.text_hash,
      (page, others) => ({
        evidence: {
          observed: { pages_with_same_text: others.length + 1, word_count: page.word_count },
          expected: 'Visible text that no other indexable page has',
          detail: `${otherPages(others.length)} have exactly the same visible text.`,
        },
      }),
    );
  },
};

/** @type {CheckDef} */
const thin = {
  ...SEO,
  id: 'seo.content.thin',
  title: 'Page has little visible text',
  description:
    'Flags indexable pages with fewer than 100 words of visible text. Google has no preferred word count, so this only marks pages worth a look to see whether they fully serve their purpose.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 3,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.HELPFUL_CONTENT,
  recommendation:
    'Check whether the page gives visitors what they came for; if not, add the missing information or merge it into a related page.',
  run(ctx) {
    return ctx.indexablePages.map((page) => {
      if (page.word_count >= THIN_WORDS) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        evidence: { observed: { word_count: page.word_count }, expected: `${THIN_WORDS} words or more` },
      };
    });
  },
};

export const contentChecks = [duplicateBody, thin];
