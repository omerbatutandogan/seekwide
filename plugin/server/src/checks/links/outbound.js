/** @import { CheckDef, CheckResult, LinkRecord, OutboundResult, PageRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { compareText, hrefSelector, linkSelector } from './helpers.js';

/**
 * For each external URL in `urls`, the pages that link to it and the first such
 * link on each page. A link to an internal URL that redirects to the external
 * URL counts: the visitor ends up there. Pages are visited in sorted URL order,
 * so the first entry of each inner map is the first page in sorted order.
 * @param {PageRecord[]} pages
 * @param {Map<string, OutboundResult>} urls
 * @returns {Map<string, Map<string, LinkRecord>>}
 */
function linkingPages(pages, urls) {
  // Internal URLs that redirect to another site, with the external URL they end at.
  /** @type {Map<string, string>} */
  const offSite = new Map();
  for (const page of pages) {
    if (page.final_external) offSite.set(page.url, page.final_url);
  }

  /** @type {Map<string, Map<string, LinkRecord>>} */
  const byTarget = new Map();
  for (const page of [...pages].sort((a, b) => compareText(a.url, b.url))) {
    for (const link of page.links) {
      if (link.url === null) continue;
      const target = link.internal ? offSite.get(link.url) : link.url;
      if (target === undefined || !urls.has(target)) continue;
      let linkers = byTarget.get(target);
      if (!linkers) {
        linkers = new Map();
        byTarget.set(target, linkers);
      }
      if (!linkers.has(page.url)) linkers.set(page.url, link);
    }
  }
  return byTarget;
}

/** @type {CheckDef} */
const broken = {
  id: 'links.outbound.broken',
  module: 'links',
  engine: 'code',
  title: 'Broken external link',
  description:
    'Looks at external URLs that were checked and answered 404 or 410, or whose domain does not exist, including URLs that an internal link reaches through a redirect. Links that timed out or were refused, for example with 403 or 429, are not counted because many sites turn away automated requests.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: ['outbound'],
  doc_ref: 'https://developers.google.com/crawling/docs/troubleshooting/http-status-codes',
  last_verified: '2026-11-11',
  recommendation: "Update the link to the page's new address, replace it with another source, or remove it.",
  run(ctx) {
    const outbound = ctx.outbound ?? new Map();
    const byTarget = linkingPages(ctx.pages, outbound);

    /** @type {CheckResult[]} */
    const results = [];
    for (const url of [...outbound.keys()].sort(compareText)) {
      const checked = outbound.get(url);
      if (checked === undefined || checked.outcome === 'unverifiable') continue;

      /** @type {Map<string, LinkRecord>} */
      const linkers = byTarget.get(url) ?? new Map();
      const pageUrls = [...linkers.keys()];
      const first = linkers.get(pageUrls[0]);
      const selector = first ? linkSelector(first) : hrefSelector(url);
      const base = { url: pageUrls[0] ?? null, selector };

      if (checked.outcome !== 'broken') {
        results.push({ status: 'pass', ...base });
        continue;
      }
      const reason = checked.reason ? ` (${clip(checked.reason)})` : '';
      const via = first?.internal && first.url ? ` The link goes to ${clip(first.url)}, which redirects there.` : '';
      results.push({
        status: 'fail',
        ...base,
        line: first?.line ?? null,
        evidence: {
          observed: { target_url: clip(url), status: checked.status, reason: checked.reason ? clip(checked.reason) : null },
          expected: 'A URL that answers with a status below 400',
          detail:
            (checked.status === 0
              ? `${clip(url)} could not be reached${reason}.`
              : `${clip(url)} answered ${checked.status}${reason}.`) + via,
        },
        related_urls: pageUrls.slice(1),
      });
    }
    return results;
  },
};

/** The external-link checks. */
export const outboundChecks = [broken];
