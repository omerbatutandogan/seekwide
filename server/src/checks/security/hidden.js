/** @import { CheckDef, CheckResult } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { VERIFIED, attributeSelector, compareText, deployedSite, securedPages } from './helpers.js';

const MAX_LISTED = 5;

/** @type {CheckDef} */
const hiddenExternalLink = {
  id: 'security.hidden.external_link',
  module: 'security',
  engine: 'code',
  title: 'Hidden link to another site',
  description:
    "Looks for links to other sites that the page's own markup hides from visitors (display:none, the hidden attribute, visibility:hidden, a font size of 1 pixel or less, a position at least 1000 pixels off the screen, a box of 2 pixels or less that clips its content) or that sit on a single punctuation character, when no visible link on any crawled page goes to the same site. Google lists hidden links as spam and as a sign of a hacked site. Menus, tabs, accordions and pop-ups also hide links, so an element built to be opened (a dialog, menu or tab panel, content right after a control that says it opens something, an element a control on the page names) does not count, and neither do links to the same organisation's other domains or share links.",
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: 'https://developers.google.com/search/docs/essentials/spam-policies',
  last_verified: VERIFIED,
  recommendation:
    "Open the page source and find the element shown in the evidence. If the links are yours (a partner's logo, an old menu), show them to visitors or remove them. If nobody on your side put them there, the site may have been hacked: follow Google's help for hacked sites, clean the files or database that add them, and check Search Console's Security issues report.",
  run(ctx) {
    const pages = securedPages(ctx);
    const deployed = deployedSite(ctx);
    const visibleHosts = new Set(pages.flatMap((page) => page.security.visible_hosts));
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of pages) {
      const hidden = page.security.hidden_links.filter((entry) => !visibleHosts.has(entry.host) && !deployed(entry.url));
      if (hidden.length === 0) {
        results.push({ status: 'pass', url: page.url });
        continue;
      }
      const first = hidden[0];
      const links = hidden.reduce((sum, entry) => sum + entry.count, 0);
      const hosts = hidden.map((entry) => entry.host).sort(compareText);
      const hiding = first.element === null
        ? `its text is one character ("${clip(first.text.trim(), 5)}")`
        : `${first.how}, set on ${clip(first.element)}${first.element_line === null ? '' : ` at line ${first.element_line}`}`;
      const href = page.links[first.index]?.href ?? first.url;
      results.push({
        status: 'fail',
        url: page.url,
        selector: attributeSelector('a', 'href', href),
        line: first.line,
        evidence: {
          observed: {
            hidden_links: links,
            hosts: hosts.slice(0, MAX_LISTED),
            first: { url: first.url, text: first.text, how: first.how, element: first.element },
          },
          expected: 'Links to other sites that visitors can see, or none',
          detail: links === 1
            // One hidden link is as often a leftover of the site's own (a partner's logo in a block no longer shown) as a sign of a hack.
            ? `One link to another site cannot be seen by visitors, and no visible link on the crawled pages goes to that site. It goes to ${first.url}: ${hiding}. A single hidden link can be the site's own, such as a partner's logo in a block that is no longer shown; check whether someone on your side added it.`
            : `${links} links to ${hosts.length === 1 ? 'another site' : `${hosts.length} other sites`} cannot be seen by visitors, and no visible link on the crawled pages goes to ${hosts.length === 1 ? 'that site' : 'those sites'}. The first goes to ${first.url}: ${hiding}.`,
        },
      });
    }
    return results;
  },
};

/** Checks for links that visitors cannot see. */
export const hiddenChecks = [hiddenExternalLink];
