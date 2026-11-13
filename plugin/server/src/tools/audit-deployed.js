// What an audit says about the deployed address a local crawl was told (site_url).

/** @import { CrawlResult } from '../types.js' */

/**
 * The origin other than the audited one that most canonical links of the
 * crawled pages name, or null when none does. Ties go to the first in sorted order.
 * @param {CrawlResult} crawl
 * @returns {string|null}
 */
export function namedOrigin(crawl) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const page of crawl.pages) {
    const origins = new Set();
    for (const canonical of page.canonicals ?? []) {
      if (canonical.url === null) continue;
      try {
        const { origin } = new URL(canonical.url);
        if (origin !== crawl.site_origin) origins.add(origin);
      } catch {
        // Not a URL: nothing to count.
      }
    }
    for (const origin of origins) counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  const ranked = [...counts].sort(([a, countA], [b, countB]) => countB - countA || (a < b ? -1 : 1));
  return ranked.length === 0 ? null : ranked[0][0];
}

/**
 * Notes on the deployed address of a local crawl: what was read as local
 * pages, or that the address matched nothing, with the address the pages do
 * name. Empty when the crawl was not told one.
 *
 * Guarantees: "were read as pages of the local server" is said only when one
 * or more canonical, link or sitemap entry was.
 * @param {CrawlResult} crawl
 * @returns {string[]}
 */
export function deployedNotes(crawl) {
  const deployed = crawl.options.deployed_origin;
  if (!deployed) return [];
  const requests = 'The crawl requested nothing from that site, and links to it that were not read as local pages were left out of the external link check.';
  if ((crawl.options.deployed_localized ?? 0) > 0) {
    return [`The crawl was told that the project is deployed at ${deployed}. Canonical links, links and sitemap entries on that address were read as pages of the local server. ${requests}`];
  }
  const named = namedOrigin(crawl);
  return [
    `The crawl was told that the project is deployed at ${deployed}, but no canonical link, link or sitemap entry names that address, so nothing was read as a page of the local server. ` +
    (named === null
      ? 'The pages name no other address in their canonical links either.'
      : `The canonical links of the pages name ${named}: if that is where the site is deployed, crawl again with site_url set to exactly that (scheme and host name must match), otherwise those pages count as pointing to another site.`) +
    ` ${requests}`,
  ];
}
