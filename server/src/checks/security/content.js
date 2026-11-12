/** @import { CheckDef, CheckResult } from '../../types.js' */
/** @import { SecuredPage } from './helpers.js' */

import { CATEGORIES } from '../../extract/terms.js';
import { VERIFIED, securedPages, securedStartPage } from './helpers.js';

/** A category counts on a page from this many matches on. */
export const MIN_SPAM_MATCHES = 2;
/** The start page tells which writing systems the site uses from this many letters on. */
export const MIN_START_LETTERS = 200;
/** A writing system with less than this share of the start page's letters is not one the site uses. */
export const SITE_SHARE = 0.05;
/** A page is in another writing system when it has this many of its letters, and this share of them. */
export const MIN_FOREIGN_LETTERS = 100;
export const FOREIGN_SHARE = 0.3;

const CATEGORY_LABELS = { pharma: 'pharmaceutical', gambling: 'gambling', counterfeit: 'counterfeit goods' };
const SCRIPT_NAMES = /** @type {Record<string, string>} */ ({
  cyrillic: 'Cyrillic script', greek: 'Greek script', arabic: 'Arabic script', hebrew: 'Hebrew script', devanagari: 'Devanagari script',
  thai: 'Thai script', hangul: 'Korean Hangul', cjk: 'Chinese or Japanese characters',
});

/**
 * The writing systems each language is usually written in, by its primary
 * language subtag. A language not listed is written in Latin script or in a
 * system this check does not tell apart.
 */
const LANGUAGE_SCRIPTS = /** @type {Record<string, string[]>} */ ({
  ru: ['cyrillic'], uk: ['cyrillic'], be: ['cyrillic'], bg: ['cyrillic'], mk: ['cyrillic'], sr: ['cyrillic', 'latin'],
  kk: ['cyrillic', 'latin'], ky: ['cyrillic'], mn: ['cyrillic'], tg: ['cyrillic'], tt: ['cyrillic'], ba: ['cyrillic'], uz: ['latin', 'cyrillic'],
  el: ['greek'],
  ar: ['arabic'], fa: ['arabic'], ur: ['arabic'], ps: ['arabic'], ug: ['arabic'], ckb: ['arabic'], sd: ['arabic'], ku: ['latin', 'arabic'],
  he: ['hebrew'], iw: ['hebrew'], yi: ['hebrew'],
  hi: ['devanagari'], mr: ['devanagari'], ne: ['devanagari'], sa: ['devanagari'], kok: ['devanagari'], mai: ['devanagari'],
  th: ['thai'],
  ko: ['hangul'],
  zh: ['cjk'], ja: ['cjk'], yue: ['cjk'], wuu: ['cjk'],
});
/** Script subtags (BCP 47) of the writing systems this check tells apart. */
const SCRIPT_SUBTAGS = /** @type {Record<string, string>} */ ({
  latn: 'latin', cyrl: 'cyrillic', grek: 'greek', arab: 'arabic', hebr: 'hebrew', deva: 'devanagari', thai: 'thai',
  hang: 'hangul', kore: 'hangul', hani: 'cjk', hans: 'cjk', hant: 'cjk', jpan: 'cjk', hira: 'cjk', kana: 'cjk',
});

/**
 * Writing systems a language tag names: its script subtag when it has one,
 * otherwise those of its language, otherwise Latin.
 * @param {string} tag
 * @returns {string[]}
 */
export function scriptsOfLanguage(tag) {
  const parts = tag.trim().toLowerCase().split(/[-_]/);
  const script = parts.slice(1).find((part) => part.length === 4 && Object.hasOwn(SCRIPT_SUBTAGS, part));
  if (script) return [SCRIPT_SUBTAGS[script]];
  return LANGUAGE_SCRIPTS[parts[0]] ?? ['latin'];
}

/**
 * @param {Record<string, number>|undefined} scripts
 * @returns {{counts: [string, number][], letters: number}}
 */
function letterCounts(scripts) {
  const counts = /** @type {[string, number][]} */ (Object.entries(scripts ?? {}).filter(([, count]) => Number.isFinite(count) && count > 0));
  return { counts, letters: counts.reduce((sum, [, count]) => sum + count, 0) };
}

/**
 * The writing systems the start page uses: those with `SITE_SHARE` or more of
 * its letters. Null when it has fewer than `MIN_START_LETTERS` letters.
 * @param {Record<string, number>|undefined} scripts
 * @returns {Set<string>|null}
 */
export function siteScripts(scripts) {
  const { counts, letters } = letterCounts(scripts);
  if (letters < MIN_START_LETTERS) return null;
  return new Set(counts.filter(([, count]) => count / letters >= SITE_SHARE).map(([script]) => script));
}

/**
 * The largest writing system of a page that is not Latin, not `other`, not
 * used by the site, and has `MIN_FOREIGN_LETTERS` and `FOREIGN_SHARE` of the
 * page's letters; null when there is none.
 * @param {Record<string, number>|undefined} scripts
 * @param {Set<string>} site
 * @returns {{script: string, share: number, letters: number}|null}
 */
export function foreignScriptOf(scripts, site) {
  const { counts, letters } = letterCounts(scripts);
  const candidates = counts
    .filter(([script, count]) => script !== 'latin' && script !== 'other' && !site.has(script)
      && count >= MIN_FOREIGN_LETTERS && count / letters >= FOREIGN_SHARE)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
  if (candidates.length === 0) return null;
  const [script, count] = candidates[0];
  return { script, share: Math.round((100 * count) / letters) / 100, letters: count };
}

/**
 * The categories a page has enough spam terms of, among those the site is not about.
 * @param {SecuredPage} page
 * @param {Set<string>} topics
 */
function offTopic(page, topics) {
  return CATEGORIES.filter((category) => !topics.has(category))
    .map((category) => ({ category, hits: page.security.spam_terms?.[category] }))
    .filter((entry) => entry.hits !== undefined && entry.hits.count >= MIN_SPAM_MATCHES);
}

/** @type {CheckDef} */
const spamTerms = {
  id: 'security.content.spam_terms',
  module: 'security',
  engine: 'code',
  title: 'Page has spam terms the site is not about',
  description:
    "Counts pharmaceutical, gambling and counterfeit-goods spam terms in each page's text (hidden text included) and in the addresses of its links to other sites, and reports a page with two or more matches of a kind that the start page's title, description and headings do not mention. Google names spammy text and links, often with pharmaceutical terms, as injected content of a hacked site. A page that is about one of these subjects on a site that is not, such as a news article about a drug, is reported too.",
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: 'https://support.google.com/webmasters/answer/9044101',
  last_verified: VERIFIED,
  recommendation:
    "Look at the page for the terms in the evidence, in the page source as well, because injected text is often hidden. If the site did not publish them, it may have been hacked: follow Google's help for hacked sites and check Search Console's Security issues report. If the page is meant to cover this subject, no change is needed.",
  run(ctx) {
    const start = securedStartPage(ctx);
    if (start === null) return [];
    const topics = new Set(CATEGORIES.filter((category) => (start.security.topic_terms?.[category]?.count ?? 0) > 0));
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of securedPages(ctx)) {
      const found = offTopic(page, topics);
      if (found.length === 0) {
        results.push({ status: 'pass', url: page.url });
        continue;
      }
      const kinds = found.map(({ category }) => CATEGORY_LABELS[category]);
      results.push({
        status: 'fail',
        url: page.url,
        evidence: {
          observed: Object.fromEntries(found.map(({ category, hits }) => [category, { matches: hits?.count, terms: hits?.terms }])),
          expected: `Fewer than ${MIN_SPAM_MATCHES} matches of a kind of spam term the site is not about`,
          detail: `The page has ${kinds.join(' and ')} spam terms (${found.map(({ hits }) => (hits?.terms ?? []).map((term) => `"${term}"`).join(', ')).join('; ')}), and the start page's title, description and headings do not mention that subject.`,
        },
      });
    }
    return results;
  },
};

/** @type {CheckDef} */
const foreignScript = {
  id: 'security.content.foreign_script',
  module: 'security',
  engine: 'code',
  title: 'Page is in a writing system the site does not use',
  description:
    "Looks for pages with a large part of their text (30% of the letters, and at least 100) in a writing system that the start page hardly uses (Cyrillic, Greek, Arabic, Hebrew, Devanagari, Thai, Hangul, Chinese and Japanese characters), when the page's lang attribute and Content-Language header do not name a language written in it. Hacked sites often get spam pages in another language, such as the Japanese keyword hack. Latin script is never reported, because Latin text on a site in another script (product names, code, an English page) is common.",
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: 'https://web.dev/articles/fix-the-japanese-keyword-hack',
  last_verified: VERIFIED,
  recommendation:
    "Check whether the site published this page. If it did not, the site may have been hacked: follow Google's help for the Japanese keyword hack and check Search Console's Security issues report. If it is a real translation, set its lang attribute (for example lang=\"ja\") so that browsers and search engines know its language.",
  run(ctx) {
    const start = securedStartPage(ctx);
    const site = start === null ? null : siteScripts(start.security.scripts);
    if (start === null || site === null) return [];
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of securedPages(ctx)) {
      if (page.url === start.url) continue;
      const foreign = foreignScriptOf(page.security.scripts, site);
      const declared = [page.html_lang, page.headers['content-language']].filter((value) => typeof value === 'string' && value.trim() !== '')
        .flatMap((value) => /** @type {string} */ (value).split(','));
      if (foreign === null || declared.some((tag) => scriptsOfLanguage(tag).includes(foreign.script))) {
        results.push({ status: 'pass', url: page.url });
        continue;
      }
      results.push({
        status: 'fail',
        url: page.url,
        selector: 'html',
        evidence: {
          observed: { script: foreign.script, letters: foreign.letters, share: foreign.share, declared: declared.map((tag) => tag.trim()) },
          expected: 'Text in the writing systems of the start page, or a lang attribute that names the page\'s language',
          detail: `${foreign.letters} letters (${Math.round(foreign.share * 100)}% of the page's text) are in ${SCRIPT_NAMES[foreign.script] ?? foreign.script}, which the start page hardly uses, and ${declared.length > 0 ? `the language the page declares (${declared.map((tag) => `"${tag.trim()}"`).join(', ')}) is written in another script` : 'the page does not declare a language'}.`,
        },
      });
    }
    return results;
  },
};

/** Checks for content a hacked site gets. */
export const contentChecks = [spamTerms, foreignScript];
