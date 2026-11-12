// links.internal.nofollow: internal pages that a page links to only with
// rel="nofollow" (validation of 2026-11-12, fix 3).

/** @import { CheckDef, CheckResult } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { looksLikeHtmlUrl } from '../../util/url.js';
import { distinctInternalTargets, linkSelector } from './helpers.js';

/**
 * True for an internal link target that is a page the crawler could fetch and
 * that nofollow can keep from Google: not the linking page itself (a fragment
 * of it is the same URL), no query string (share, reply, cart and export
 * actions carry one), a path that does not name a file type that is never a
 * page, and not known to be disallowed by robots.txt.
 * @param {string} target
 * @param {string} page
 * @param {Set<string>} disallowed
 * @returns {boolean}
 */
function withholdable(target, page, disallowed) {
  return target !== page && new URL(target).search === '' && looksLikeHtmlUrl(target) && !disallowed.has(target);
}

/** @type {CheckDef} */
export const nofollow = {
  id: 'links.internal.nofollow',
  module: 'links',
  engine: 'code',
  title: 'Internal page linked only with nofollow',
  description:
    'Looks at internal links to pages the crawler could fetch (not the page itself, no query string, allowed by robots.txt) and flags a page whose every link to such a target carries rel="nofollow". Google generally does not follow links marked this way, and for pages on your own site it recommends a robots.txt disallow rule instead. A nofollowed copy of a link the page also has without nofollow, and nofollow on share, reply, cart and other action links, are not counted.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: 'https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links',
  last_verified: '2026-11-12',
  recommendation:
    'Remove rel="nofollow" from internal links you want Google to follow. To stop Google fetching a page on your own site, use a robots.txt disallow rule instead.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    const disallowed = new Set([...(ctx.crawl.disallowed_links ?? []), ...ctx.crawl.robots_blocked]);
    for (const page of ctx.htmlPages) {
      for (const target of distinctInternalTargets(page)) {
        if (!withholdable(target.url, page.url, disallowed)) continue;
        const [first] = target.links;
        const marked = target.links.filter((link) => link.rel.includes('nofollow'));
        if (marked.length < target.links.length) {
          results.push({ status: 'pass', url: page.url, selector: linkSelector(first) });
          continue;
        }
        const count = target.links.length;
        results.push({
          status: 'fail',
          url: page.url,
          selector: linkSelector(first),
          line: first.line,
          evidence: {
            observed: {
              target_url: clip(target.url),
              rel: first.rel.map((token) => clip(token)),
              nofollow_links: count,
              links_to_target: count,
            },
            expected: 'At least one link to the page without rel="nofollow"',
            detail: count === 1
              ? `The only link to ${clip(target.url)} on this page has rel="nofollow".`
              : `All ${count} links to ${clip(target.url)} on this page have rel="nofollow".`,
          },
        });
      }
    }
    return results;
  },
};
