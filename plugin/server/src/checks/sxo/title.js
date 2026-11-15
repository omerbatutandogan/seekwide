// The titles Google rewrites, by the reasons its title link page gives (sxo module). Pure.

/** @import { CheckDef, CheckResult } from '../../types.js' */

import { scriptLetters } from '../../extract/terms.js';
import { clip } from '../../util/strings.js';
import { DOCS, SXO, firstH1, firstTitle, fold, titleParts } from './helpers.js';

const YEAR = /(?<!\d)(?:199\d|20\d\d)(?!\d)/g;
/**
 * A word that makes the year after it a founding or copyright year, not the year the page is about: since, est.,
 * established, founded, ©, (c), copyright, and the same in German, French, Spanish, Italian, Portuguese and Turkish.
 */
const FOUNDING = /(?:\bsince|\best\.?|\bestablished(?:\s+in)?|\bfounded(?:\s+in)?|©|\(c\)|\bcopyright|\bseit|\bgegr(?:ü|ue)ndet(?:\s+im)?|\bdepuis|\bfond(?:é|e)e?\s+en|\bdesde|\bfundad[oa]\s+en|\bdal|\bfondat[oa]\s+nel|\bkurulu(?:ş|s))[\s:,.-]*$/iu;
/** Share of the visible text's letters that makes a writing system the page's primary one. */
export const PRIMARY_SHARE = 0.6;
/** Words that count in the overlap of a title and its heading. */
const LONG_WORD = /\p{L}{4,}/gu;
const MIN_TEXT_WORDS = 50;

/**
 * The years a text names as what it is about: those not introduced by a founding or copyright word.
 * @param {string} text
 * @returns {number[]}
 */
const years = (text) => [...text.matchAll(YEAR)].filter((match) => !FOUNDING.test(text.slice(Math.max(0, /** @type {number} */ (match.index) - 24), match.index))).map((match) => Number(match[0]));

/** @type {CheckDef} */
const halfEmpty = {
  ...SXO,
  id: 'sxo.title.half_empty',
  title: 'Title with an empty part',
  description:
    'Checks the title of indexable pages for one that starts or ends with a separator (|, -, –, —, :, ·, •, /) or has two separators with nothing between them. Google names "Half-empty <title> elements" (its example: <title>| Site Name</title>) among the reasons it writes a title link of its own from the page\'s headings.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.TITLE,
  recommendation: 'Fill in the missing part of the title (usually the page\'s own name before the site name), or remove the stray separator.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.indexablePages) {
      const title = firstTitle(page);
      if (title === null) continue;
      results.push(titleParts(title).some((part) => part === '') ? {
        status: 'fail', url: page.url, selector: 'head > title',
        evidence: { observed: { title: clip(title, 200) }, expected: 'Text on both sides of every separator' },
      } : { status: 'pass', url: page.url });
    }
    return results;
  },
};

/** @type {CheckDef} */
const yearStale = {
  ...SXO,
  id: 'sxo.title.year_stale',
  title: 'Title names an older year than the heading',
  description:
    'Checks indexable pages whose title names a year (1990–2099; not one introduced by since, est., founded, © and the like) for a main heading (<h1>) that names a newer one the title does not. Google names "Obsolete <title> elements": its example is a title "2020 admissions criteria" on a page whose visible heading says 2021, and it then uses the heading\'s date. A page can mean an older year on purpose, which is why the finding is likely.',
  severity: 'low',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.TITLE,
  recommendation: 'Update the year in the title to match the page\'s heading and content.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.indexablePages) {
      const title = firstTitle(page);
      const inTitle = title === null ? [] : years(title);
      if (inTitle.length === 0) continue;
      const heading = firstH1(page);
      const inHeading = heading === null ? [] : years(heading);
      const titleYear = Math.max(...inTitle);
      const stale = inHeading.length > 0 && Math.max(...inHeading) > titleYear && !inHeading.includes(titleYear);
      results.push(stale ? {
        status: 'fail', url: page.url, selector: 'head > title',
        evidence: { observed: { title: clip(/** @type {string} */ (title), 200), h1: clip(/** @type {string} */ (heading), 200) }, expected: `The heading's year (${Math.max(...inHeading)}) in the title` },
      } : { status: 'pass', url: page.url });
    }
    return results;
  },
};

/**
 * The page's primary writing system: the one with at least `PRIMARY_SHARE` of the visible text's letters; null when
 * none has.
 * @param {Record<string, number>} counts
 * @returns {string|null}
 */
function primaryScript(counts) {
  const entries = Object.entries(counts);
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total === 0) return null;
  const [name, n] = entries.reduce((best, entry) => (entry[1] > best[1] ? entry : best));
  return n / total >= PRIMARY_SHARE ? name : null;
}

/** @type {CheckDef} */
const scriptMismatch = {
  ...SXO,
  id: 'sxo.title.script_mismatch',
  title: 'Title in another writing system than the page',
  description:
    'Checks indexable pages with 50 or more words of visible text whose letters are mostly (60% or more) of one writing system (Latin, Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai, Hangul, Chinese and Japanese characters, or another) for a title without a single letter of it. Google: "If Google determines that a <title> element does not match the writing system or language of the page\'s primary content, we may choose a different text as the title link." A title that mixes in the page\'s own script (a Latin brand name in a Japanese title) passes; the finding is likely because a page can serve two audiences.',
  severity: 'low',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.TITLE,
  recommendation: 'Write the title in the language and writing system of the page\'s main content.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.indexablePages) {
      const title = firstTitle(page);
      if (title === null || page.word_count < MIN_TEXT_WORDS || !page.security) continue;
      const primary = primaryScript(page.security.scripts);
      const titleLetters = scriptLetters(title);
      if (primary === null || Object.keys(titleLetters).length === 0) continue;
      results.push((titleLetters[primary] ?? 0) === 0 ? {
        status: 'fail', url: page.url, selector: 'head > title',
        evidence: { observed: { title: clip(title, 200), title_scripts: Object.keys(titleLetters).sort(), page_script: primary }, expected: `Letters of the page's writing system (${primary}) in the title` },
      } : { status: 'pass', url: page.url });
    }
    return results;
  },
};

/** Writing systems that do not separate words with spaces, where words cannot be compared. */
const UNSPACED = ['cjk', 'thai'];

/** @type {CheckDef} */
const noHeadingOverlap = {
  ...SXO,
  id: 'sxo.title.no_heading_overlap',
  title: 'Title and main heading share no word',
  description:
    'Checks indexable pages with a title and an <h1> for a title that, once the parts repeated in the titles of other pages (the site name) are removed, shares no word of four or more letters with the heading. Google builds title links from the title, the main visible title and <h1> elements among other sources, and may rewrite a title that does not describe the page. A rule of thumb: a heading and a title can describe one page in different words.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.TITLE,
  recommendation: 'Make the title name what the page\'s main heading says, in the words a searcher would use.',
  run(ctx) {
    /** @type {Map<string, Set<string>>} part (folded) → the pages whose title has it */
    const uses = new Map();
    for (const page of ctx.indexablePages) {
      const title = firstTitle(page);
      if (title === null) continue;
      for (const part of new Set(titleParts(title).map(fold).filter(Boolean))) {
        const pages = uses.get(part) ?? new Set();
        pages.add(page.url);
        uses.set(part, pages);
      }
    }
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.indexablePages) {
      const title = firstTitle(page);
      const heading = firstH1(page);
      if (title === null || heading === null) continue;
      if (UNSPACED.some((name) => (scriptLetters(`${title} ${heading}`)[name] ?? 0) > 0)) continue;
      const parts = titleParts(title).filter((part) => part !== '');
      const own = parts.filter((part) => (uses.get(fold(part))?.size ?? 0) < 2);
      const words = new Set(fold((own.length > 0 ? own : parts).join(' ')).match(LONG_WORD) ?? []);
      if (words.size === 0) continue;
      const shared = (fold(heading).match(LONG_WORD) ?? []).some((word) => words.has(word));
      results.push(shared ? { status: 'pass', url: page.url } : {
        status: 'fail', url: page.url, selector: 'head > title',
        evidence: { observed: { title: clip(title, 200), h1: clip(heading, 200) }, expected: 'A word of four or more letters in both' },
      });
    }
    return results;
  },
};

export const titleChecks = [halfEmpty, yearStale, scriptMismatch, noHeadingOverlap];
