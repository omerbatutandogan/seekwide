/** @import { ArticleSummary, CheckContext, CheckDef, CheckResult, PageRecord } from '../../types.js' */

import { DOCS, SEO } from './common.js';

const ARTICLE_VERIFIED = '2026-11-24';
const BASE = { ...SEO, last_verified: ARTICLE_VERIFIED, severity: /** @type {const} */ ('info'), weight: 0, scope: /** @type {const} */ ('page'), requires: ['article_pages'] };
const SELECTOR = 'script[type="application/ld+json"]';
const NOT_A_FACTOR = 'Google says E-E-A-T is not on its own a specific factor in Search results, so this is information.';

/**
 * One result per Article of each html page, from `test`: `unit: false` leaves it out.
 * @param {CheckContext} ctx
 * @param {(article: ArticleSummary, page: PageRecord) => {unit: false} | {unit: true, problem: CheckResult['evidence']|null}} test
 * @returns {CheckResult[]}
 */
function eachArticle(ctx, test) {
  /** @type {CheckResult[]} */
  const results = [];
  for (const page of ctx.htmlPages) {
    for (const block of page.jsonld) {
      if (!block.valid) continue;
      for (const article of block.articles ?? []) {
        const outcome = test(article, page);
        if (!outcome.unit) continue;
        results.push(outcome.problem === null
          ? { status: 'pass', url: page.url, selector: SELECTOR, line: block.line }
          : { status: 'fail', url: page.url, selector: SELECTOR, line: block.line, evidence: outcome.problem });
      }
    }
  }
  return results;
}

/** @type {CheckDef} */
const authorMissing = {
  ...BASE,
  id: 'seo.article.author_missing',
  title: 'Article markup names no author',
  description: `Checks each Article, NewsArticle and BlogPosting in the JSON-LD of html pages for an author with a name. Google's Article page recommends \`author\` and \`author.name\`, and its page on helpful content strongly encourages accurate authorship information. ${NOT_A_FACTOR} The visible byline is not read.`,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  doc_ref: DOCS.ARTICLE,
  recommendation: 'Add the author as a Person (or an Organization) with its name in `author.name`, one `author` entry per author, matching the byline readers see.',
  run(ctx) {
    return eachArticle(ctx, (article) => ({
      unit: true,
      problem: article.named_authors > 0 ? null : {
        observed: { type: article.type, authors: article.authors, named_authors: 0 },
        expected: 'An author with a name',
        detail: 'Google: "We strongly encourage adding accurate authorship information, such as bylines to content where readers might expect it."',
      },
    }));
  },
};

/** @type {CheckDef} */
const authorUnlinked = {
  ...BASE,
  id: 'seo.article.author_unlinked',
  title: 'Article authors have no page that identifies them',
  description: `Checks each Article, NewsArticle and BlogPosting that names an author for an \`author.url\` or \`sameAs\` on one of them. Google's Article page describes \`author.url\` as a page that uniquely identifies the author and accepts \`sameAs\` instead; its page on helpful content asks whether bylines lead to further information about the author. ${NOT_A_FACTOR}`,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  doc_ref: DOCS.ARTICLE,
  recommendation: 'Give each author a `url` to a page about them, such as a bio page on this site or their profile elsewhere, or list such pages in `sameAs`.',
  run(ctx) {
    return eachArticle(ctx, (article) => {
      if (article.named_authors === 0) return { unit: false };
      return {
        unit: true,
        problem: article.linked_authors > 0 ? null : {
          observed: { type: article.type, named_authors: article.named_authors, linked_authors: 0 },
          expected: 'An author with a url or sameAs',
        },
      };
    });
  },
};

/** @type {CheckDef} */
const dateMissing = {
  ...BASE,
  id: 'seo.article.date_missing',
  title: 'Article markup gives no publication date',
  description: `Checks each Article, NewsArticle and BlogPosting in the JSON-LD of html pages for \`datePublished\`, which Google's Article page recommends. ${NOT_A_FACTOR}`,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  doc_ref: DOCS.ARTICLE,
  recommendation: 'Add `datePublished`, and `dateModified` when the article changes, in ISO 8601 with a time zone, matching the dates shown on the page.',
  run(ctx) {
    return eachArticle(ctx, (article) => ({
      unit: true,
      problem: article.date_published ? null : { observed: { type: article.type, date_modified: article.date_modified }, expected: 'A datePublished' },
    }));
  },
};

export const articleChecks = [authorMissing, authorUnlinked, dateMissing];
