// /seekwide:fix, the server's part: for each finding of a repo-mode run, say
// whether a metadata fix applies, which file it belongs in and what the page
// sends today. The server writes nothing; the model edits the file after the
// user approved the diff.
//
// Scope (ARCHITECTURE.md 4.13): a missing or duplicate title and meta description, a
// missing canonical, missing Open Graph tags, a missing sitemap (with the
// robots.txt line that names it). Anything else is counted, not planned.
// The plans of page and sitemap fixes are in fix-page.js and fix-sitemap.js.

/** @import { CrawlResult, Finding, PageRecord, Run } from '../types.js' */
/** @import { ProjectSources } from './sources.js' */
/** @import { PlanContext } from './fix-common.js' */

import { SEVERITIES } from '../config.js';
import { plainPath } from './fix-common.js';
import { planPage } from './fix-page.js';
import { planSitemap } from './fix-sitemap.js';

/**
 * The checks a fix exists for. `unit` says which pages the check looks at,
 * which the re-audit needs to know before it calls a finding closed.
 * @type {Readonly<Record<string, {type: 'title'|'meta_description'|'canonical'|'open_graph'|'sitemap', action: 'add'|'make_unique'|'remove_extra'|'create', unit: 'indexable'|'html'|'site'}>>}
 */
export const FIXABLE_CHECKS = Object.freeze({
  'seo.title.missing': { type: 'title', action: 'add', unit: 'indexable' },
  'seo.title.duplicate': { type: 'title', action: 'make_unique', unit: 'indexable' },
  'seo.title.multiple': { type: 'title', action: 'remove_extra', unit: 'html' },
  'seo.meta_description.missing': { type: 'meta_description', action: 'add', unit: 'indexable' },
  'seo.meta_description.duplicate': { type: 'meta_description', action: 'make_unique', unit: 'indexable' },
  'seo.meta_description.multiple': { type: 'meta_description', action: 'remove_extra', unit: 'html' },
  'seo.canonical.missing': { type: 'canonical', action: 'add', unit: 'indexable' },
  'seo.social.og_incomplete': { type: 'open_graph', action: 'add', unit: 'indexable' },
  'seo.sitemap.missing': { type: 'sitemap', action: 'create', unit: 'site' },
});

/** Metadata findings that are deliberately not repaired, with the reason given to the user. */
const REFUSED_CHECKS = Object.freeze({
  'seo.canonical.streamed_in_body':
    'Next.js sent this page\'s metadata in the body because it was not ready in time. Moving tags by hand does not change that. The choice is the project owner\'s: metadata that does not wait for slow data, or the htmlLimitedBots setting in next.config.',
});

/**
 * @typedef {Object} FixEntry
 * @property {string} finding_id
 * @property {string} check_id
 * @property {string} title
 * @property {string} severity
 * @property {string|null} url
 * @property {string} type            What is fixed: 'title', 'meta_description', 'canonical', 'open_graph' or 'sitemap'.
 * @property {string} action          'add', 'make_unique', 'remove_extra', 'repair' or 'create'.
 * @property {'next-app'|'html'} kind  How the file is edited: a Next.js metadata export, or an HTML `<head>`.
 * @property {string|null} file       The file to edit, relative to the project folder; null for a fix that only creates files.
 * @property {number|null} line
 * @property {string|null} route
 * @property {string} how             What to change, in the plugin's own words.
 * @property {boolean} needs_site_url  The fix writes the deployed address of the site, which the local server does not know.
 * @property {object|null} [current]  What the page sent in the audited crawl; null when that crawl is no longer stored.
 * @property {string[]} [layouts]     Next.js: the layout files above the page, nearest first.
 * @property {boolean} [dynamic]      Next.js: the file answers more than one address.
 * @property {{url: string, file: string|null}[]} [shares_with]  A duplicate: the other pages with the same value.
 * @property {string[]} [missing]     Open Graph: the tags that are missing.
 * @property {{path: string, url: string|null}} [canonical]  The canonical to write: the page's path, and the full URL when the deployed address is known.
 * @property {{file: string, purpose: string}[]} [create]  Files to create.
 * @property {{file: string, purpose: string}[]} [edit]    Other files to change.
 * @property {string[]} [sitemap_paths]   Paths of the pages the sitemap should list.
 * @property {string[]} [dynamic_routes]  Next.js routes whose addresses are not known from file names.
 */

/**
 * @typedef {Object} FixPlan
 * @property {FixEntry[]} fixes
 * @property {{finding_id: string, check_id: string, title: string, url: string|null, file: string|null, reason: string}[]} notFixable
 *   `reason` is one of a fixed set of sentences; the file it is about is in `file`, never in the sentence.
 * @property {Record<string, number>} outOfScope  Findings of checks no fix exists for, counted by check id.
 */

/**
 * Plan the metadata fixes for the findings of a repo-mode run.
 *
 * Guarantees: only findings of `run` are planned, and each exactly once: as a
 * fix, as not fixable with the reason, or counted as out of scope. A fix names
 * a file only when the finding names it and the project still has it. Nothing
 * is read from the project besides the file listing in `sources`, and nothing
 * is written. `how` and `reason` are the plugin's own words: `reason` is a
 * fixed sentence, `how` holds only fixed text, the deployed origin and line
 * numbers that are positive integers, and no string of the stored run and no
 * file name is part of either. `title` comes from `titles` (the check
 * definitions), never from the run; `file`, `layouts`, `create` and `edit`
 * name files of the project's listing; a file name from the run elsewhere is
 * passed on only when it is a plain relative path. Text taken from a page
 * appears only under `current` and in URLs and routes.
 *
 * @param {{run: Run, sources: ProjectSources, crawl: CrawlResult|null, siteUrl: string|null, titles?: Record<string, string>}} input
 *   `crawl`: the crawl the run was made from, when it is still stored. `siteUrl`: the origin the site is deployed at.
 *   `titles`: the title of each check, by id; a check without one is named by its id.
 * @returns {FixPlan}
 */
export function planFixes({ run, sources, crawl, siteUrl, titles = {} }) {
  const files = new Set(sources.files);
  const prefix = sources.relative === '' ? '' : `${sources.relative}/`;
  const inProject = (/** @type {string} */ file) => `${prefix}${file}`;
  /** A finding's file as the listing names it, or null when the project does not have it. @param {string} file */
  const listed = (file) => {
    if (!file.startsWith(prefix)) return null;
    const local = file.slice(prefix.length);
    return files.has(local) ? local : null;
  };
  /** @type {Map<string, PageRecord>} */
  const pages = new Map();
  for (const page of crawl?.pages ?? []) if (!pages.has(page.url)) pages.set(page.url, page);
  /** @type {Map<string, Finding>} */
  const byCheckAndUrl = new Map();
  for (const finding of run.findings) if (finding.url !== null) byCheckAndUrl.set(`${finding.check_id}\n${finding.url}`, finding);
  const appDir = sources.detection.app_dir;
  const isNext = sources.detection.framework === 'next-app' && appDir !== null;

  /** @type {FixPlan} */
  const plan = { fixes: [], notFixable: [], outOfScope: {} };
  /** Counted in a Map, so that no check id can reach Object.prototype. @type {Map<string, number>} */
  const outOfScope = new Map();
  const titleOf = (/** @type {Finding} */ finding) => (Object.hasOwn(titles, finding.check_id) ? titles[finding.check_id] : finding.check_id);
  /**
   * @param {Finding} finding
   * @param {string} reason  A fixed sentence.
   * @param {string|null} [file]  A file of the listing; defaults to the finding's own, when it is a plain path.
   */
  const refuse = (finding, reason, file = plainPath(finding.source?.file)) => {
    plan.notFixable.push({ finding_id: finding.id, check_id: finding.check_id, title: titleOf(finding), url: finding.url, file, reason });
  };
  /** @param {Finding} finding */
  const base = (finding) => ({
    finding_id: finding.id, check_id: finding.check_id, title: titleOf(finding),
    severity: SEVERITIES.includes(finding.severity) ? finding.severity : 'info', url: finding.url,
  });

  /** @type {PlanContext} */
  const ctx = {
    sources, files, crawl, siteUrl, appDir, isNext, pages, byCheckAndUrl, inProject, listed, refuse, base,
    add: (fix) => {
      plan.fixes.push(fix);
    },
  };
  for (const finding of run.findings) {
    const fix = Object.hasOwn(FIXABLE_CHECKS, finding.check_id) ? FIXABLE_CHECKS[finding.check_id] : null;
    if (fix === null) {
      if (Object.hasOwn(REFUSED_CHECKS, finding.check_id)) refuse(finding, REFUSED_CHECKS[/** @type {keyof typeof REFUSED_CHECKS} */ (finding.check_id)]);
      else outOfScope.set(finding.check_id, (outOfScope.get(finding.check_id) ?? 0) + 1);
    } else if (fix.type === 'sitemap') planSitemap(ctx, finding);
    else planPage(ctx, finding, fix);
  }
  plan.outOfScope = Object.fromEntries(outOfScope);
  return plan;
}
