// What a crawler that runs no script sees (ai module), and the site's
// /llms.txt, which is information only: Google Search ignores it. Pure.

/** @import { CheckDef, CheckResult } from '../../types.js' */

import { AI, DOCS } from './helpers.js';

/** Fewer visible words than this, with an empty mount element, means the content comes from scripts. */
export const SHELL_WORDS = 50;

/** @type {CheckDef} */
const scriptOnly = {
  ...AI,
  id: 'ai.content.script_only',
  title: 'The page\'s content appears only after scripts run',
  description:
    'Checks each indexable html page for a served HTML document with fewer than 50 visible words, one or more scripts in the body, and either an empty application mount element right under <body> (id root, __next, app or __nuxt) or no visible text and no image at all. Bing advises against hiding critical content behind client-side rendering and says content that cannot be reliably rendered may not be selected for grounding; OpenAI, Anthropic and Perplexity document nothing about running scripts, and a 2024 measurement found none of the major AI crawlers did. Google renders JavaScript.',
  severity: 'medium',
  weight: 2,
  impact: 3,
  effort: 3,
  confidence: 'likely',
  scope: 'page',
  requires: ['ai_pages'],
  doc_ref: DOCS.BING_GUIDELINES,
  recommendation: 'Serve the page\'s main content in the HTML: render it on the server or at build time (server-side rendering or static generation), so crawlers that run no script see it.',
  run(ctx) {
    return ctx.indexablePages.filter((page) => page.status === 200 && page.is_html && page.ai).map((page) => {
      const ai = /** @type {NonNullable<typeof page.ai>} */ (page.ai);
      const shell = page.word_count < SHELL_WORDS && ai.body_scripts > 0 && (ai.empty_mount !== null || (page.word_count === 0 && page.images.length === 0));
      if (!shell) return /** @type {CheckResult} */ ({ status: 'pass', url: page.url });
      return {
        status: 'fail', url: page.url,
        evidence: {
          observed: { words: page.word_count, body_scripts: ai.body_scripts, empty_mount: ai.empty_mount === null ? null : `#${ai.empty_mount}` },
          expected: `${SHELL_WORDS} or more visible words in the HTML the server sends`,
          detail: 'What a crawler that does not run scripts sees. Bing: avoid hiding critical content behind client-side rendering.',
        },
      };
    });
  },
};

/** @type {CheckDef} */
const llmsTxtMalformed = {
  ...AI,
  id: 'ai.llms_txt.malformed',
  title: '/llms.txt does not start with a title line',
  description:
    'When the site serves /llms.txt, checks that its first line is a Markdown H1 with the site\'s name, the only section the llms.txt proposal requires. Information only: no AI vendor documents reading other sites\' llms.txt files, and Google says such files neither harm nor help visibility in Google Search, which ignores them. An HTML page or a redirect to the start page at that address means there is no file.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'site',
  requires: ['llms_txt'],
  doc_ref: DOCS.LLMSTXT,
  recommendation: 'Start the file with "# " and the site\'s name, then an optional "> " summary and sections of links, as llmstxt.org describes. Expect no ranking or visibility gain from it.',
  run(ctx) {
    const file = ctx.llmsTxt;
    if (file === null || file.outcome !== 'found') return [];
    if (file.reason === null) return [{ status: 'pass', url: file.url }];
    return [{
      status: 'fail', url: file.url,
      evidence: {
        observed: { problem: file.reason, h1: file.h1, links: file.links, content_type: file.content_type },
        expected: 'A first line "# <site name>"',
        detail: 'Google: llms.txt files neither harm nor help a site\'s visibility in Google Search, which ignores them.',
      },
    }];
  },
};

export const contentChecks = [scriptOnly, llmsTxtMalformed];
