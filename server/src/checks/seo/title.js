/** @import { CheckDef, PageRecord } from '../../types.js' */

import { firstNonEmpty } from '../page-helpers.js';
import { clip, collapseWhitespace } from '../../util/strings.js';
import { arialWidthPx } from './arial-widths.js';
import { DOCS, SEO, duplicateResults, otherPages } from './common.js';

const SELECTOR = 'head > title';
const MAX_WIDTH_PX = 580;
const FONT_SIZE_PX = 20;
const MIN_CHARACTERS = 10;
/** Titles quoted in evidence; the full count is reported separately. */
const MAX_LISTED = 5;

/**
 * Indexable pages that have a title with visible text, paired with that title.
 * @param {PageRecord[]} pages
 * @returns {{page: PageRecord, title: string}[]}
 */
function titledPages(pages) {
  /** @type {{page: PageRecord, title: string}[]} */
  const out = [];
  for (const page of pages) {
    const title = firstNonEmpty(page.titles);
    if (title !== null) out.push({ page, title });
  }
  return out;
}

/** @type {CheckDef} */
const missing = {
  ...SEO,
  id: 'seo.title.missing',
  title: 'Page has no title',
  description:
    'Checks that every indexable page has a <title> element with text. Google uses the title as a main source for the title link in search results.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.TITLE,
  recommendation: 'Add a <title> element to the <head> that describes this page\'s content in a few words.',
  run(ctx) {
    return ctx.indexablePages.map((page) => {
      if (firstNonEmpty(page.titles) !== null) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        selector: SELECTOR,
        evidence: {
          observed: page.titles.length === 0 ? 'No <title> element' : 'Only empty <title> elements',
          expected: 'A <title> element with text',
        },
      };
    });
  },
};

/** @type {CheckDef} */
const multiple = {
  ...SEO,
  id: 'seo.title.multiple',
  title: 'Page has more than one title element',
  description:
    'Checks that each HTML page has at most one <title> element, as the HTML standard requires. With several, it is unclear which one search engines and browsers will use.',
  severity: 'medium',
  weight: 2,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.HTML_TITLE,
  recommendation: 'Keep one <title> element in the <head> and remove the others.',
  run(ctx) {
    return ctx.htmlPages.map((page) => {
      if (page.titles.length <= 1) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        selector: SELECTOR,
        evidence: {
          observed: page.titles.slice(0, MAX_LISTED).map((title) => clip(title)),
          expected: 'One <title> element',
          detail: `The page has ${page.titles.length} <title> elements.`,
        },
      };
    });
  },
};

/** @type {CheckDef} */
const duplicate = {
  ...SEO,
  id: 'seo.title.duplicate',
  title: 'Title is shared with other pages',
  description:
    'Compares the titles of indexable pages, ignoring case and spacing. Pages with the same title are hard to tell apart in search results.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 2,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.TITLE,
  recommendation:
    'Write a distinct title for each page that names what is specific to it, or consolidate the pages if they really are the same content.',
  run(ctx) {
    const units = titledPages(ctx.indexablePages);
    const keyOf = new Map(units.map(({ page, title }) => [page, collapseWhitespace(title).toLowerCase()]));
    return duplicateResults(
      units.map(({ page }) => page),
      (page) => /** @type {string} */ (keyOf.get(page)),
      (_page, others) => ({
        selector: SELECTOR,
        evidence: {
          observed: { pages_with_same_title: others.length + 1 },
          expected: 'A title no other indexable page uses',
          detail: `${otherPages(others.length)} use the same title.`,
        },
      }),
    );
  },
};

/** @type {CheckDef} */
const tooLong = {
  ...SEO,
  id: 'seo.title.too_long',
  title: 'Title is likely to be cut off in search results',
  description:
    'Estimates the width of the title in Arial at 20 px. Google truncates title links to fit the device width, so text beyond about 580 px is often not shown.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.TITLE,
  recommendation: 'Shorten the title so the words that identify the page come first and the whole title fits in about 580 px.',
  run(ctx) {
    return titledPages(ctx.indexablePages).map(({ page, title }) => {
      const estimatedPx = Math.round(arialWidthPx(title, FONT_SIZE_PX));
      if (estimatedPx <= MAX_WIDTH_PX) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        selector: SELECTOR,
        evidence: {
          observed: { characters: [...title].length, estimated_px: estimatedPx },
          expected: `${MAX_WIDTH_PX} px or less`,
          detail: `Title: "${clip(title)}"`,
        },
      };
    });
  },
};

/** @type {CheckDef} */
const tooShort = {
  ...SEO,
  id: 'seo.title.too_short',
  title: 'Title is very short',
  description:
    'Flags titles under 10 characters. Short titles such as "Home" or "Profile" rarely describe the page well enough to stand out in search results.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.TITLE,
  recommendation: 'Expand the title to say what the page is about, for example by adding the topic and the site or brand name.',
  run(ctx) {
    return titledPages(ctx.indexablePages).map(({ page, title }) => {
      const characters = [...title].length;
      if (characters >= MIN_CHARACTERS) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        selector: SELECTOR,
        evidence: {
          observed: { characters, title: clip(title) },
          expected: `${MIN_CHARACTERS} characters or more`,
        },
      };
    });
  },
};

export const titleChecks = [missing, multiple, duplicate, tooLong, tooShort];
