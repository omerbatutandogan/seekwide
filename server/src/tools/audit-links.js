// Which external links an audit checks (links module): the targets of the
// crawled pages' external links, taken in turn from each linked host and,
// within a host, from each page, so that a few hosts or pages with many links
// do not take every check.

import { hostOf } from '../net/polite.js';
import { crawlIdentity } from '../util/site-identity.js';

/** @import { CrawlResult } from '../types.js' */

/**
 * The items of several lists taken in turn: round after round, the next item
 * of each list that was not taken yet, so the first item of every list comes
 * before the second of any. Each item once.
 * @param {string[][]} lists
 * @returns {string[]}
 */
export function inTurn(lists) {
  const positions = lists.map(() => 0);
  /** @type {Set<string>} */
  const taken = new Set();
  for (let progress = true; progress;) {
    progress = false;
    for (let i = 0; i < lists.length; i += 1) {
      const list = lists[i];
      while (positions[i] < list.length && taken.has(list[positions[i]])) positions[i] += 1;
      if (positions[i] >= list.length) continue;
      taken.add(list[positions[i]]);
      positions[i] += 1;
      progress = true;
    }
  }
  return [...taken];
}

/**
 * URLs for the external link check, each once, in the order they are checked:
 * the external link targets on the crawled HTML pages (status 200), in
 * document order, plus the `final_url` of every record whose redirect chain
 * leaves the site; taken in turn from each page in crawl order (`inTurn`),
 * then in turn from each host in the order its first URL came. The check takes
 * the first `LIMITS.maxOutboundChecks`. Every URL on the host of the deployed
 * site of a local crawl (`options.deployed_origin`) is left out, whatever its
 * scheme or port, with or without "www.".
 * @param {CrawlResult} crawl
 * @returns {string[]}
 */
export function externalLinkUrls(crawl) {
  // A local crawl that knows where the project is deployed never has that address contacted: its pages
  // name it, and a request there would say nothing about the project being audited.
  const identity = crawlIdentity(crawl);
  /** @param {string} url */
  const kept = (url) => !identity.isDeployed(url);
  const byPage = inTurn(crawl.pages.map((page) => {
    /** @type {string[]} */
    const urls = page.final_external ? [page.final_url] : [];
    if (page.status === 200 && page.is_html) {
      for (const link of page.links) if (link.url !== null && !link.internal) urls.push(link.url);
    }
    return urls.filter(kept);
  }));
  /** @type {Map<string, string[]>} */
  const byHost = new Map();
  for (const url of byPage) {
    const host = hostOf(url);
    const list = byHost.get(host);
    if (list) list.push(url);
    else byHost.set(host, [url]);
  }
  return inTurn([...byHost.values()]);
}
