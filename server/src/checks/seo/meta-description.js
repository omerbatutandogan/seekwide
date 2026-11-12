/** @import { CheckDef, PageRecord } from '../../types.js' */

import { firstNonEmpty } from '../page-helpers.js';
import { clip, collapseWhitespace } from '../../util/strings.js';
import { DOCS, SEO, duplicateResults, otherPages } from './common.js';

const SELECTOR = 'meta[name=description]';
const MAX_CHARACTERS = 160;
/** Descriptions quoted in evidence; the full count is reported separately. */
const MAX_LISTED = 5;

/**
 * Indexable pages that have a description with visible text, paired with it.
 * @param {PageRecord[]} pages
 * @returns {{page: PageRecord, description: string}[]}
 */
function describedPages(pages) {
  /** @type {{page: PageRecord, description: string}[]} */
  const out = [];
  for (const page of pages) {
    const description = firstNonEmpty(page.meta_descriptions);
    if (description !== null) out.push({ page, description });
  }
  return out;
}

/** @type {CheckDef} */
const missing = {
  ...SEO,
  id: 'seo.meta_description.missing',
  title: 'Page has no meta description',
  description:
    'Checks that every indexable page has a meta description with text. Google may use it for the snippet under the title link when it describes the page better than the visible text.',
  severity: 'low',
  weight: 2,
  impact: 2,
  effort: 2,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.SNIPPET,
  recommendation:
    'Add <meta name="description" content="…"> to the <head> with a short, accurate summary of this page, starting with the most important pages.',
  run(ctx) {
    return ctx.indexablePages.map((page) => {
      if (firstNonEmpty(page.meta_descriptions) !== null) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        selector: SELECTOR,
        evidence: {
          observed: page.meta_descriptions.length === 0 ? 'No meta description' : 'Only empty meta descriptions',
          expected: 'A meta description with text',
        },
      };
    });
  },
};

/** @type {CheckDef} */
const multiple = {
  ...SEO,
  id: 'seo.meta_description.multiple',
  title: 'Page has more than one meta description',
  description:
    'Checks that each HTML page has at most one meta description, as the HTML standard requires. With several, it is unclear which one search engines will read.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.HTML_META_DESCRIPTION,
  recommendation: 'Keep one <meta name="description"> element and remove the others.',
  run(ctx) {
    return ctx.htmlPages.map((page) => {
      if (page.meta_descriptions.length <= 1) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        selector: SELECTOR,
        evidence: {
          observed: page.meta_descriptions.slice(0, MAX_LISTED).map((description) => clip(description)),
          expected: 'One meta description',
          detail: `The page has ${page.meta_descriptions.length} meta descriptions.`,
        },
      };
    });
  },
};

/** @type {CheckDef} */
const duplicate = {
  ...SEO,
  id: 'seo.meta_description.duplicate',
  title: 'Meta description is shared with other pages',
  description:
    'Compares the meta descriptions of indexable pages, ignoring case and spacing. Identical descriptions do not help searchers tell the pages apart.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 2,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.SNIPPET,
  recommendation: 'Write a description for each page that summarizes what is specific to it.',
  run(ctx) {
    const units = describedPages(ctx.indexablePages);
    const keyOf = new Map(units.map(({ page, description }) => [page, collapseWhitespace(description).toLowerCase()]));
    return duplicateResults(
      units.map(({ page }) => page),
      (page) => /** @type {string} */ (keyOf.get(page)),
      (_page, others) => ({
        selector: SELECTOR,
        evidence: {
          observed: { pages_with_same_description: others.length + 1 },
          expected: 'A description no other indexable page uses',
          detail: `${otherPages(others.length, 'uses', 'use')} the same meta description.`,
        },
      }),
    );
  },
};

/** @type {CheckDef} */
const tooLong = {
  ...SEO,
  id: 'seo.meta_description.too_long',
  title: 'Meta description is long',
  description:
    'Flags meta descriptions over 160 characters. There is no length limit, but Google truncates snippets to fit the device width, so the end of a long description is often not shown.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.SNIPPET,
  recommendation: 'Put the most useful information in the first 160 characters of the description.',
  run(ctx) {
    return describedPages(ctx.indexablePages).map(({ page, description }) => {
      const characters = [...description].length;
      if (characters <= MAX_CHARACTERS) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        selector: SELECTOR,
        evidence: {
          observed: { characters },
          expected: `${MAX_CHARACTERS} characters or fewer`,
          detail: `Description: "${clip(description)}"`,
        },
      };
    });
  },
};

export const metaDescriptionChecks = [missing, multiple, duplicate, tooLong];
