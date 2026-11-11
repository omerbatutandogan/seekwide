// The re-audit after fixes: what became of each finding that was fixed.
//
// A finding that is gone from the new run is not yet a finding that was fixed.
// It also disappears when the check no longer looks at the page: the page was
// not crawled this time, answers another status, or stopped being indexable.
// Only a finding the check looked at again and passed counts as closed.

/** @import { CrawlResult, Finding, FixVerification, FixResult, PageRecord, Run } from '../types.js' */
/** @import { RunComparison } from '../store/compare.js' */

import { firstNonEmpty, isUnverifiable } from '../checks/page-helpers.js';
import { FIXABLE_CHECKS } from './fixes.js';

const MAX_REPLACEMENTS = 5;

/**
 * The part of a check id that names what it is about: "seo.title" for "seo.title.missing".
 * @param {string} checkId
 * @returns {string}
 */
function areaOf(checkId) {
  const cut = checkId.lastIndexOf('.');
  return cut === -1 ? checkId : checkId.slice(0, cut);
}

/**
 * Why a fixed page-level finding cannot be called closed although it is gone, or null when it can.
 * @param {Finding} finding
 * @param {PageRecord|undefined} page  The page in the new crawl.
 * @returns {string|null}
 */
function pageDoubt(finding, page) {
  if (!page) return 'The page was not crawled in the re-audit, so nothing was measured on it.';
  if (isUnverifiable(page)) return 'The crawler could not read the page in the re-audit.';
  if (page.status !== 200 || !page.is_html) {
    return `The page answered ${page.status === 0 ? 'with no response' : `HTTP ${page.status}`}${page.is_html ? '' : ' without HTML'} in the re-audit, so the check did not look at it.`;
  }
  if (FIXABLE_CHECKS[finding.check_id]?.unit === 'indexable' && !page.indexability.indexable) {
    return `The page is no longer indexable in the re-audit (${page.indexability.reasons.join(', ')}), and this check only looks at indexable pages.`;
  }
  return null;
}

/**
 * A duplicate goes away when the page gets a value of its own, and also when
 * the pages it was compared with are no longer among the pages the check
 * looks at. Why the second may be what happened, or null when every one of
 * those pages was measured again.
 * @param {Finding} finding
 * @param {Map<string, PageRecord>} pages  The new crawl.
 * @returns {string|null}
 */
function partnerDoubt(finding, pages) {
  if (FIXABLE_CHECKS[finding.check_id]?.action !== 'make_unique') return null;
  const values = FIXABLE_CHECKS[finding.check_id].type === 'title' ? 'titles' : 'meta_descriptions';
  const absent = finding.related_urls.filter((url) => {
    const page = pages.get(url);
    // The duplicate checks compare indexable pages that have a value; a page without one is not compared.
    return !page || page.status !== 200 || !page.is_html || !page.indexability.indexable || firstNonEmpty(page[values]) === null;
  });
  if (absent.length === 0) return null;
  return `${absent.length === 1 ? 'A page' : `${absent.length} pages`} this one shared the value with ${absent.length === 1 ? 'was' : 'were'} not compared again in the re-audit (${absent[0]}${absent.length > 1 ? ', ...' : ''}): not crawled, not indexable, or without a value of ${absent.length === 1 ? 'its' : 'their'} own. The duplicate may be gone only because there was less to compare with.`;
}

/**
 * Why a fixed "no sitemap" finding cannot be called closed although it is gone, or null when it can.
 * @param {CrawlResult} crawl
 * @returns {string|null}
 */
function sitemapDoubt(crawl) {
  if (!crawl.sitemap.loaded) return 'The re-audit could not look for a sitemap.';
  if (crawl.sitemap.files.some((file) => file.type === 'urlset' || file.type === 'index')) return null;
  const external = crawl.sitemap.files.find((file) => file.type === 'external');
  if (external) {
    return `robots.txt now names a sitemap on another host (${external.url}), which a crawl of the local server does not read. Crawl again with site_url set to the deployed address, so that the sitemap is read from the local server.`;
  }
  return 'A sitemap is named, but none could be read in the re-audit.';
}

/**
 * Say what became of each fixed finding in the run made after the fixes.
 *
 * Outcomes:
 * - `open`: the finding is still in the new run.
 * - `closed`: it is gone, and the check looked at the same page (or the site) again.
 *   Only a finding of a check in `FIXABLE_CHECKS` can be closed; for any other check it is `unverified`.
 * - `replaced`: it is gone, but the new run has a finding the base run did not
 *   have, on the same page and about the same thing (same check area).
 * - `unverified`: it is gone, but the check did not look: `detail` says why.
 *
 * Guarantees: one result per requested id that the base run holds, in the
 * order asked for, each id once; ids the base run does not hold are returned
 * under `unknown` and get no result. Pure: no I/O.
 *
 * @param {{base: Run, run: Run, crawl: CrawlResult, findingIds: string[], comparison: RunComparison}} input
 *   `comparison` is `compareRuns(base, run)`.
 * @returns {{verification: FixVerification, unknown: string[]}}
 */
export function verifyFixes({ base, run, crawl, findingIds, comparison }) {
  const baseById = new Map(base.findings.map((finding) => [finding.id, finding]));
  const stillThere = new Set(run.findings.map((finding) => finding.id));
  const ran = new Map(run.checks.map((check) => [check.id, check]));
  /** @type {Map<string, PageRecord>} */
  const pages = new Map();
  for (const page of crawl.pages) if (!pages.has(page.url)) pages.set(page.url, page);

  /** @type {FixResult[]} */
  const results = [];
  /** @type {string[]} */
  const unknown = [];
  for (const id of [...new Set(findingIds)]) {
    const finding = baseById.get(id);
    if (!finding) {
      unknown.push(id);
      continue;
    }
    /** @type {Pick<FixResult, 'outcome'|'detail'|'replaced_by'>} */
    let verdict;
    const stat = ran.get(finding.check_id);
    if (stillThere.has(id)) {
      verdict = { outcome: 'open', detail: 'The re-audit found the same problem again.', replaced_by: [] };
    } else if (!stat || stat.status !== 'run') {
      verdict = { outcome: 'unverified', detail: `The check did not run in the re-audit${stat?.skip_reason ? `: ${stat.skip_reason}` : '.'}`, replaced_by: [] };
    } else {
      const site = finding.url === null;
      const fixable = Object.hasOwn(FIXABLE_CHECKS, finding.check_id);
      // Which pages a check looks at is known only for the checks a fix exists for. For any other check a
      // finding that is gone is never called closed: nothing here can tell whether the check looked again.
      const doubt = !fixable
        ? 'The finding is no longer reported, but this check is outside what a fix verification can confirm: the plugin cannot tell whether the check looked at the same thing again. Compare the two runs and look at the page.'
        : site ? sitemapDoubt(crawl) : pageDoubt(finding, pages.get(/** @type {string} */ (finding.url))) ?? partnerDoubt(finding, pages);
      const area = areaOf(finding.check_id);
      const successors = comparison.added.filter((added) =>
        site
          ? areaOf(added.check_id) === area || (finding.check_id === 'seo.sitemap.missing' && added.check_id.startsWith('seo.robots.'))
          : added.url === finding.url && areaOf(added.check_id) === area);
      if (doubt !== null) verdict = { outcome: 'unverified', detail: doubt, replaced_by: [] };
      else if (successors.length > 0) {
        verdict = {
          outcome: 'replaced',
          detail: `The problem is gone, but the re-audit reports ${successors.length === 1 ? 'another problem' : `${successors.length} other problems`} of the same kind${site ? '' : ' on this page'} that the earlier run did not have.`,
          replaced_by: successors.slice(0, MAX_REPLACEMENTS).map(({ id: newId, check_id, title, severity }) => ({ id: newId, check_id, title, severity })),
        };
      } else {
        verdict = { outcome: 'closed', detail: site ? 'The re-audit looked again and the problem is gone.' : 'The re-audit measured the page again and the problem is gone.', replaced_by: [] };
      }
    }
    results.push({
      finding_id: id,
      check_id: finding.check_id,
      title: finding.title,
      severity: finding.severity,
      url: finding.url,
      file: finding.source?.file ?? null,
      ...verdict,
    });
  }

  const count = (/** @type {FixResult['outcome']} */ outcome) => results.filter((result) => result.outcome === outcome).length;
  return {
    verification: {
      base_run_id: base.run_id,
      counts: { closed: count('closed'), open: count('open'), replaced: count('replaced'), unverified: count('unverified') },
      results,
      notes: comparison.notes,
    },
    unknown,
  };
}
