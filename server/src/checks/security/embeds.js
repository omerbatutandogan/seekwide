/** @import { CheckDef, CheckResult, EmbedRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { VERIFIED, attributeSelector, compareText, securedPages } from './helpers.js';

/**
 * Crawled pages with the signals needed before a host used by one page counts
 * as rare. On a crawl of 25 pages every video, map or form embedded on one
 * page is used by one page.
 */
export const MIN_PAGES_FOR_RARE = 50;
const MAX_LISTED = 5;

/** @type {CheckDef} */
const hiddenFrame = {
  id: 'security.embeds.hidden_frame',
  module: 'security',
  engine: 'code',
  title: 'Hidden frame from another site',
  description:
    'Looks for <iframe> elements that load a page from another site and that visitors cannot see: a width or height of 2 pixels or less, or hidden by their own markup or a parent element that no control on the page opens (one a control names by id, content right after a button that says it opens something, a tab panel labelled by its tab, content an Alpine.js component shows with a click). A video or map player hidden by the box around it is a lightbox waiting to be opened and does not count. Google describes injected frames, often sized to zero and hidden with CSS, as a sign of a site hacked with malware. Some tracking tags use a hidden frame too, which is why this is a likely finding.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: 'https://web.dev/articles/hacked-with-malware',
  last_verified: VERIFIED,
  recommendation:
    "Find the frame in the page source and the template, plugin or tag manager that adds it. If you do not recognise the site it loads, treat the site as hacked: follow Google's help for sites hacked with malware and check Search Console's Security issues report. If it is a tracking tag you use, no change is needed.",
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of securedPages(ctx)) {
      const frames = page.security.embeds.filter((embed) => embed.tag === 'iframe' && !ctx.identity.isDeployed(embed.url));
      if (frames.length === 0) continue;
      const hidden = frames.filter((frame) => frame.hidden !== null);
      if (hidden.length === 0) {
        results.push({ status: 'pass', url: page.url });
        continue;
      }
      const first = hidden[0];
      const hosts = [...new Set(hidden.map((frame) => frame.host))].sort(compareText);
      results.push({
        status: 'fail',
        url: page.url,
        selector: attributeSelector('iframe', 'src', first.url),
        line: first.line,
        evidence: {
          observed: { hidden_frames: hidden.length, hosts: hosts.slice(0, MAX_LISTED), first: { src: clip(first.url), how: first.hidden } },
          expected: 'Frames from other sites that visitors can see, or none',
          detail: `${hidden.length === 1 ? 'A frame' : `${hidden.length} frames`} from ${hosts.slice(0, MAX_LISTED).join(', ')} ${hidden.length === 1 ? 'is' : 'are'} hidden from visitors. The first loads ${clip(first.url)} (${first.hidden}).`,
        },
      });
    }
    return results;
  },
};

/**
 * The first script or frame of each other host a page loads from, in document order.
 * @param {EmbedRecord[]} embeds
 * @returns {Map<string, EmbedRecord>}
 */
function firstPerHost(embeds) {
  /** @type {Map<string, EmbedRecord>} */
  const hosts = new Map();
  for (const embed of embeds) {
    if (!hosts.has(embed.host)) hosts.set(embed.host, embed);
  }
  return hosts;
}

/** @type {CheckDef} */
const rareHost = {
  id: 'security.embeds.rare_host',
  module: 'security',
  engine: 'code',
  title: 'Script or frame from a site no other page uses',
  description:
    'Lists scripts and frames that a page loads from another site when no other crawled page loads anything from that site, on a crawl of 50 or more pages; hosts of the site\'s own organisation (its registered domain, and the same name under another ending when a page links there visibly) are left out. Google names scripts loaded from an attacker\'s domain as a sign of a hacked site, but a video, map or form embedded on one page is just as rare, so this only marks code worth a look.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: 'https://web.dev/articles/hacked-with-malware',
  last_verified: VERIFIED,
  recommendation:
    'Check that you recognise the site the code comes from and that someone on your side added it. Remove code nobody can account for.',
  run(ctx) {
    const pages = securedPages(ctx);
    if (pages.length < MIN_PAGES_FOR_RARE) return [];
    // The organisation's own hosts are left out: its registered domain (cdn.example.org on example.org), the deployed
    // site of a local crawl, another ending of its name that a visible link names. Another tenant of a shared host
    // such as vercel.app is another site.
    /** @type {Map<string, number>} */
    const pagesPerHost = new Map();
    const foreign = (/** @type {EmbedRecord} */ embed) => !ctx.identity.isSameOrganisation(embed.host);
    const perPage = pages.map((page) => ({ page, hosts: firstPerHost(page.security.embeds.filter(foreign)) }));
    for (const { hosts } of perPage) {
      for (const host of hosts.keys()) pagesPerHost.set(host, (pagesPerHost.get(host) ?? 0) + 1);
    }
    /** @type {CheckResult[]} */
    const results = [];
    for (const { page, hosts } of perPage) {
      for (const [host, embed] of hosts) {
        const selector = attributeSelector(embed.tag, 'src', embed.url);
        if ((pagesPerHost.get(host) ?? 0) > 1) {
          results.push({ status: 'pass', url: page.url, selector });
          continue;
        }
        results.push({
          status: 'fail',
          url: page.url,
          selector,
          line: embed.line,
          evidence: {
            observed: { host, tag: embed.tag, src: clip(embed.url), pages_crawled: pages.length },
            expected: 'Code from sites that the rest of the site uses too, or code you recognise',
            detail: `This is the only one of ${pages.length} crawled pages that loads a ${embed.tag === 'script' ? 'script' : 'frame'} from ${host}: ${clip(embed.url)}.`,
          },
        });
      }
    }
    return results;
  },
};

/** Checks for scripts and frames from other sites. */
export const embedChecks = [hiddenFrame, rareHost];
