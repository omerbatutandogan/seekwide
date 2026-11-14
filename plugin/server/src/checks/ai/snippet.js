// Whether the pages may be quoted in AI answers (ai module): Google uses only
// pages that are indexed and eligible to be shown with a snippet, and its
// nosnippet, max-snippet and data-nosnippet controls apply to AI Overviews and
// AI Mode too; Bing leaves data-nosnippet text out of its AI summaries. Pure.

/** @import { CheckDef, CheckResult } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { AI, CHECK_INTENT, DOCS, maxSnippet, noSnippetDirectives, searchBlockIntended } from './helpers.js';

/** @type {CheckDef} */
const noSnippet = {
  ...AI,
  id: 'ai.snippet.nosnippet',
  title: 'The page may not be shown with a snippet, so not in AI Overviews and AI Mode',
  description:
    'Checks every indexable page for nosnippet or max-snippet:0 in the robots or googlebot meta tag or the X-Robots-Tag header. Google says nosnippet also keeps the content from being a direct input for AI Overviews and AI Mode, and a page must be eligible for a snippet to be shown as a link in them. The directive can be on purpose; when the site profile states that the site blocks AI crawlers, pages are not units.',
  severity: 'medium',
  weight: 3,
  impact: 3,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.GOOGLE_ROBOTS_META,
  recommendation: `Remove nosnippet (or max-snippet:0) unless keeping the page out of snippets and AI answers is intended; to hide only part of a page, mark that part with data-nosnippet. ${CHECK_INTENT}`,
  run(ctx) {
    if (searchBlockIntended(ctx)) return [];
    return ctx.indexablePages.map((page) => {
      const found = noSnippetDirectives(page);
      if (found.length === 0) return /** @type {CheckResult} */ ({ status: 'pass', url: page.url });
      return {
        status: 'fail', url: page.url,
        evidence: {
          observed: { directives: [...new Set(found)].map((token) => clip(token, 100)), in: page.meta_robots.some((token) => found.includes(token)) ? 'meta' : 'header' },
          expected: 'No nosnippet or max-snippet:0, unless intended',
          detail: 'Google: nosnippet also prevents the content from being used as a direct input for AI Overviews and AI Mode.',
        },
      };
    });
  },
};

/** @type {CheckDef} */
const maxSnippetSet = {
  ...AI,
  id: 'ai.snippet.max_snippet_set',
  title: 'The page limits its snippet length, which limits AI input too',
  description:
    'Lists each indexable page with max-snippet set to a number above 0. Google says the limit also applies to how much of the content may be a direct input for AI Overviews and AI Mode. Information only.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.GOOGLE_ROBOTS_META,
  recommendation: 'Check that the limit is intended; remove it, or use max-snippet:-1, to let Google choose the length.',
  run(ctx) {
    return ctx.indexablePages.flatMap((page) => {
      const limits = [...page.meta_robots, ...page.x_robots].map(maxSnippet).filter((value) => value !== null && value > 0);
      if (limits.length === 0) return [];
      return [{
        status: /** @type {const} */ ('fail'), url: page.url,
        evidence: { observed: { max_snippet: Math.min(.../** @type {number[]} */ (limits)) }, expected: 'Information only', detail: 'Google: max-snippet also limits how much of the content may be used as a direct input for AI Overviews and AI Mode.' },
      }];
    });
  },
};

/** @type {CheckDef} */
const dataNosnippetMain = {
  ...AI,
  id: 'ai.snippet.data_nosnippet_main',
  title: 'data-nosnippet hides the page\'s main content from snippets and AI answers',
  description:
    'For each indexable page with one or more span, div or section elements marked data-nosnippet (the elements Google honours it on), checks whether they hold the first <h1> or more than half of the visible words. Google and Bing leave text marked data-nosnippet out of snippets and AI answers, so a page whose main content is marked offers little to quote. Not a unit when the site profile states that the site blocks AI crawlers.',
  severity: 'low',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: ['ai_pages'],
  doc_ref: DOCS.BING_DATA_NOSNIPPET,
  recommendation: `Limit data-nosnippet to the parts that must not be quoted (notices, paywalled text), not the heading or the main text. ${CHECK_INTENT}`,
  run(ctx) {
    if (searchBlockIntended(ctx)) return [];
    return ctx.indexablePages.flatMap((page) => {
      const ai = page.ai;
      if (!ai || ai.nosnippet_elements === 0) return [];
      const most = page.word_count > 0 && ai.nosnippet_words * 2 > page.word_count;
      if (ai.nosnippet_h1 !== true && !most) return [/** @type {CheckResult} */ ({ status: 'pass', url: page.url })];
      return [{
        status: /** @type {const} */ ('fail'), url: page.url,
        evidence: {
          observed: { elements: ai.nosnippet_elements, words_marked: ai.nosnippet_words, words: page.word_count, h1_marked: ai.nosnippet_h1 === true },
          expected: 'The heading and most of the text are not marked data-nosnippet',
          detail: 'Bing: content marked data-nosnippet is excluded from snippets and AI summaries. Google lists data-nosnippet among the controls for its AI features.',
        },
      }];
    });
  },
};

export const snippetChecks = [noSnippet, maxSnippetSet, dataNosnippetMain];
