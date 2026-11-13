/** @import { CheckDef, Heading, PageRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { DOCS, SEO } from './common.js';

/** h1 headings listed in evidence. */
const MAX_LISTED = 5;

/**
 * h1 headings with visible text, in document order.
 * @param {PageRecord} page
 * @returns {Heading[]}
 */
function textH1s(page) {
  return page.headings.filter((heading) => heading.level === 1 && heading.text.trim() !== '');
}

/** @type {CheckDef} */
const h1Missing = {
  ...SEO,
  id: 'seo.h1.missing',
  title: 'Page has no h1 heading',
  description:
    'Checks that every indexable page has an <h1> with text. Google recommends putting the page title in the first visible <h1> and may use headings for title links.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.TITLE,
  recommendation: 'Add one visible <h1> near the top of the page that states the page\'s main topic.',
  run(ctx) {
    return ctx.indexablePages.map((page) => {
      if (textH1s(page).length > 0) return { status: 'pass', url: page.url };
      const emptyCount = page.headings.filter((heading) => heading.level === 1).length;
      return {
        status: 'fail',
        url: page.url,
        selector: 'h1',
        evidence: {
          observed: emptyCount === 0 ? 'No <h1> element' : 'Only empty <h1> elements',
          expected: 'An <h1> with text',
        },
      };
    });
  },
};

/** @type {CheckDef} */
const h1Multiple = {
  ...SEO,
  id: 'seo.h1.multiple',
  title: 'Page has more than one h1 heading',
  description:
    'Flags indexable pages with several <h1> headings that have text. This is valid HTML, but a single main heading makes the page\'s topic clearer to readers and assistive technology.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.HEADINGS,
  recommendation: 'Keep one <h1> for the page\'s main topic and change the other <h1> elements to <h2> or lower where they introduce sections.',
  run(ctx) {
    return ctx.indexablePages.map((page) => {
      const h1s = textH1s(page);
      if (h1s.length <= 1) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        selector: 'h1',
        line: h1s[1].line,
        evidence: {
          observed: h1s.slice(0, MAX_LISTED).map((heading) => clip(heading.text)),
          expected: 'One <h1> with text',
          detail: `The page has ${h1s.length} <h1> headings with text.`,
        },
      };
    });
  },
};

/** @type {CheckDef} */
const skippedLevel = {
  ...SEO,
  id: 'seo.headings.skipped_level',
  title: 'Heading levels are skipped',
  description:
    'Flags pages where a heading is more than one level deeper than the heading before it, for example an <h4> right after an <h2>. Skipped levels make the outline harder to follow, especially with assistive technology.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.HEADINGS,
  recommendation: 'Change the heading level so each heading is at most one level deeper than the one before it, and use CSS for its size.',
  run(ctx) {
    return ctx.indexablePages
      .filter((page) => page.headings.length > 0)
      .map((page) => {
        /** @type {{from: Heading, to: Heading}[]} */
        const skips = [];
        for (let index = 1; index < page.headings.length; index += 1) {
          const from = page.headings[index - 1];
          const to = page.headings[index];
          if (to.level > from.level + 1) skips.push({ from, to });
        }
        if (skips.length === 0) return { status: 'pass', url: page.url };
        const { from, to } = skips[0];
        return {
          status: 'fail',
          url: page.url,
          line: to.line,
          evidence: {
            observed: `h${from.level} → h${to.level}`,
            expected: `h${from.level + 1} or higher after an h${from.level}`,
            detail:
              `The <h${to.level}> "${clip(to.text)}" follows an <h${from.level}>.` +
              (skips.length > 1 ? ` The page skips a level ${skips.length} times.` : ''),
          },
        };
      });
  },
};

export const headingChecks = [h1Missing, h1Multiple, skippedLevel];
