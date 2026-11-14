// What the site as a whole tells preview crawlers and profile services (smo
// module): robots.txt for preview crawlers, the sameAs list of its
// organisation, and rel="me" links back to its fediverse profiles. Pure.

/** @import { CheckContext, CheckDef, CheckResult, PageRecord } from '../../types.js' */

import { offLimitsReason } from '../../util/off-limits.js';
import { normalizeUrl } from '../../util/url.js';
import { LIMITS } from '../../config.js';
import { DOCS, SMO, compareText, hasSocial } from './helpers.js';

/** Paths of a social platform that share a page or open a dialog, not a profile. */
const SHARE_PATH = /^\/(?:sharer|share|intent|dialog|pin\/create|shareArticle|submit|home)\b/i;
/** Platforms that put `/@name` in their addresses but are not fediverse servers that check rel="me" (besides the social platforms). */
const NOT_FEDIVERSE = ['medium.com', 'substack.com', 'vimeo.com'];
/** Profile URLs listed in evidence. */
const MAX_EXAMPLES = 5;

/** @type {CheckDef} */
const previewBotBlocked = {
  ...SMO,
  id: 'smo.robots.preview_bot_blocked',
  title: 'robots.txt keeps a preview crawler out',
  description:
    'Asks robots.txt, as read during the crawl, whether each link-preview crawler that documents that it obeys robots.txt may fetch the start page. Today that is Meta\'s facebookexternalhit, which builds the previews of Facebook, Instagram and Messenger. LinkedIn\'s and X\'s crawlers document nothing about robots.txt, and Slack\'s does not honor it, so they are not units.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 1,
  confidence: 'confirmed',
  scope: 'site',
  requires: ['robots'],
  doc_ref: DOCS.META_CRAWLERS,
  recommendation: 'Allow the preview crawler in robots.txt (a "User-agent: facebookexternalhit" group with "Allow: /", or remove the rule that disallows it).',
  run(ctx) {
    const agents = ctx.crawl.preview_agents;
    if (!agents) return [];
    const url = ctx.resolve(ctx.site.start_url)?.url ?? ctx.site.start_url;
    return Object.keys(agents).sort(compareText).map((crawler) => (agents[crawler]
      ? { status: 'pass', url, selector: crawler }
      : {
        status: 'fail', url, selector: crawler,
        evidence: {
          observed: { crawler, allowed: false, robots_txt: ctx.crawl.robots.url },
          expected: `robots.txt lets ${crawler} fetch the start page`,
          detail: 'Meta says this crawler reads robots.txt to learn what it may fetch, and bypasses it only for security and integrity checks; a link to this site shared on Facebook, Instagram or Messenger then gets no preview.',
        },
      }));
  },
};

/**
 * The visible links of the html pages to profiles on social platforms: a
 * path other than the home page and a share or dialog endpoint.
 * @param {CheckContext} ctx
 * @returns {string[]}  Distinct URLs, sorted.
 */
function socialProfileLinks(ctx) {
  /** @type {Set<string>} */
  const urls = new Set();
  for (const page of ctx.htmlPages) {
    for (const link of page.links) {
      if (link.url === null || link.internal || link.aria_hidden === true || offLimitsReason(link.url) !== 'social_platform') continue;
      const { pathname } = new URL(link.url);
      if (pathname === '/' || SHARE_PATH.test(pathname)) continue;
      urls.add(link.url);
    }
  }
  return [...urls].sort(compareText);
}

/** @type {CheckDef} */
const sameAsMissing = {
  ...SMO,
  id: 'smo.profiles.sameas_missing',
  title: 'Organization markup does not list the social profiles',
  description:
    'Looks at the start page\'s JSON-LD for an Organization, a business or a Person, when the crawled pages link to the site\'s profiles on social platforms. Google describes sameAs as the URL of a page on another website with more about the organisation, such as its profile on a social media site; none of the entities gives one. Google requires no property of this markup, so the check does not change the score.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'site',
  requires: [],
  doc_ref: DOCS.GOOGLE_ORG,
  recommendation: 'Add "sameAs" to the Organization (or Person) markup of the home page, with the URLs of its profiles on social platforms.',
  run(ctx) {
    const start = ctx.resolve(ctx.site.start_url);
    if (!start || start.status !== 200 || !start.is_html) return [];
    const entities = start.jsonld.filter((block) => block.valid && Array.isArray(block.profiles)).flatMap((block) => block.profiles ?? []);
    if (entities.length === 0) return [];
    const profiles = socialProfileLinks(ctx);
    if (profiles.length === 0) return [];
    if (entities.some((entity) => entity.same_as > 0)) return [{ status: 'pass', url: start.url, selector: 'script[type="application/ld+json"]' }];
    return [{
      status: 'fail', url: start.url, selector: 'script[type="application/ld+json"]',
      evidence: {
        observed: { types: [...new Set(entities.map((entity) => entity.type))].slice(0, MAX_EXAMPLES), profile_links: profiles.slice(0, MAX_EXAMPLES) },
        expected: 'sameAs with the URLs of the profiles the pages link to',
      },
    }];
  },
};

/**
 * True for a fediverse-style profile address: `https://<host>/@<name>`, on a
 * host that is not a large platform.
 * @param {string} url
 */
function isFediverseProfile(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/^\/@[^/@]+\/?$/.test(parsed.pathname) || parsed.search !== '') return false;
  const host = parsed.hostname.toLowerCase();
  return offLimitsReason(url) === null && !NOT_FEDIVERSE.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** @type {CheckDef} */
const relMeMissing = {
  ...SMO,
  id: 'smo.profiles.rel_me_missing',
  title: 'Fediverse profile without a rel="me" link back',
  description:
    'Finds visible links to profile addresses of the form https://<server>/@<name> (Mastodon and other fediverse servers; large platforms that also use /@ are left out) and checks that some crawled page links to each with rel="me". Mastodon verifies a site in a profile only when the site has an <a> or <link> with rel="me" whose href equals the profile URL. Whether the profile lists the site is not known here, so the check does not change the score.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'site',
  requires: [],
  doc_ref: DOCS.MASTODON_VERIFY,
  recommendation: 'Add rel="me" to the link to the profile (or a <link rel="me" href="…"> in the <head>), with exactly the profile\'s URL.',
  run(ctx) {
    /** @type {Set<string>} */
    const relMe = new Set();
    for (const page of ctx.htmlPages) if (hasSocial(page)) for (const url of page.social.rel_me) relMe.add(url);
    /** @type {Map<string, {page: PageRecord, href: string}[]>} */
    const linked = new Map();
    for (const page of ctx.htmlPages) {
      if (!hasSocial(page)) continue;
      for (const link of page.links) {
        if (link.url === null || link.internal || link.aria_hidden === true || !isFediverseProfile(link.url)) continue;
        linked.set(link.url, [...(linked.get(link.url) ?? []), { page, href: link.href }]);
      }
    }
    /** @type {CheckResult[]} */
    const results = [];
    for (const [url, uses] of [...linked].sort(([a], [b]) => compareText(a, b))) {
      const pages = [...new Map(uses.map((use) => [use.page.url, use])).values()].sort((a, b) => compareText(a.page.url, b.page.url));
      const first = pages[0];
      const selector = `a[href="${first.href.replace(/[\\"]/g, '\\$&')}"]`;
      const target = normalizeUrl(url);
      if (target !== null && relMe.has(target)) {
        results.push({ status: 'pass', url: first.page.url, selector });
        continue;
      }
      results.push({
        status: 'fail', url: first.page.url, selector,
        related_urls: pages.slice(1).map((use) => use.page.url).slice(0, LIMITS.maxRelatedUrls),
        evidence: { observed: { profile: url, rel_me: false }, expected: 'A link with rel="me" to this profile on some page' },
      });
    }
    return results;
  },
};

export const siteChecks = [previewBotBlocked, sameAsMissing, relMeMissing];
