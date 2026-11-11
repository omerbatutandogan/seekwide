/** @import { CheckDef } from '../../types.js' */

import { DOCS, SEO } from './common.js';

/** @type {CheckDef} */
const unreachable = {
  ...SEO,
  id: 'seo.robots.unreachable',
  title: 'robots.txt could not be fetched',
  description:
    'Checks that robots.txt answers. When it returns a server error or cannot be reached, Google stops crawling the site for a while and then relies on an old copy or on site availability.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 2,
  confidence: 'confirmed',
  scope: 'site',
  requires: [],
  doc_ref: DOCS.ROBOTS_SPEC,
  recommendation:
    'Make /robots.txt return a 200 response with your rules, or a 404 if you have no rules. Fix the server error, timeout or DNS problem that stops it from answering.',
  run(ctx) {
    const { robots } = ctx.crawl;
    if (robots.status !== 'unreachable') return [{ status: 'pass', url: robots.url }];
    return [
      {
        status: 'fail',
        url: robots.url,
        evidence: {
          observed: { http_status: robots.http_status },
          expected: 'A 2xx response, or a 4xx response when there is no robots.txt',
          detail:
            robots.http_status === 0
              ? 'The request for robots.txt got no response.'
              : `robots.txt answered with HTTP ${robots.http_status}.`,
        },
      },
    ];
  },
};

/** @type {CheckDef} */
const disallowAll = {
  ...SEO,
  id: 'seo.robots.disallow_all',
  title: 'robots.txt blocks the whole site',
  description:
    'Checks whether robots.txt disallows every URL for all crawlers or for Googlebot. Blocked pages cannot be crawled, so search engines cannot read their content.',
  severity: 'critical',
  weight: 5,
  impact: 3,
  effort: 1,
  confidence: 'confirmed',
  scope: 'site',
  requires: [],
  doc_ref: DOCS.ROBOTS_INTRO,
  recommendation:
    'Remove the "Disallow: /" rule from the group that applies to all crawlers or to Googlebot, and disallow only the paths that must not be crawled.',
  run(ctx) {
    const { robots } = ctx.crawl;
    if (robots.status !== 'ok') return [];
    if (!robots.disallows_all && !robots.disallows_all_googlebot) return [{ status: 'pass', url: robots.url }];
    /** @type {string[]} */
    const agents = [];
    if (robots.disallows_all) agents.push('all crawlers (User-agent: *)');
    if (robots.disallows_all_googlebot) agents.push('Googlebot');
    return [
      {
        status: 'fail',
        url: robots.url,
        evidence: {
          observed: { disallows_all: robots.disallows_all, disallows_all_googlebot: robots.disallows_all_googlebot },
          expected: 'The home page and other public pages are allowed',
          detail: `robots.txt disallows the whole site for ${agents.join(' and ')}.`,
        },
      },
    ];
  },
};

export const robotsChecks = [unreachable, disallowAll];
