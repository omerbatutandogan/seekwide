/** @import { CheckDef } from '../../types.js' */

import { isRedirectRecord, isUnverifiable } from '../page-helpers.js';
import { DOCS, SEO } from './common.js';

/** @type {CheckDef} */
const serverError = {
  ...SEO,
  id: 'seo.http.server_error',
  title: 'Page returns a server error',
  description:
    'Checks every URL that did not answer with a redirect for a 5xx server error. URLs where the site challenged or rate-limited the crawler are not counted. Google slows crawling when it sees server errors and drops URLs that keep returning them.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 2,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.HTTP_STATUS,
  recommendation:
    'Find the cause of the 5xx response in the server or application logs and fix it so the URL returns 200, or 404 or 410 if the page is gone.',
  run(ctx) {
    return ctx.pages
      .filter((page) => page.status >= 200 && !isRedirectRecord(page) && !isUnverifiable(page))
      .map((page) => {
        if (page.status < 500) return { status: 'pass', url: page.url };
        return {
          status: 'fail',
          url: page.url,
          evidence: { observed: page.status, expected: 'A status below 500', detail: `The URL answered with HTTP ${page.status}.` },
        };
      });
  },
};

/** @type {CheckDef} */
const fetchFailed = {
  ...SEO,
  id: 'seo.http.fetch_failed',
  title: 'Page could not be fetched',
  description:
    'Checks every requested URL for a request that got no HTTP response, such as a timeout, DNS failure or dropped connection. Google treats these like server errors and cannot index the URL.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.NETWORK_ERRORS,
  recommendation:
    'Request the URL again to rule out a one-off failure; if it still fails, check DNS, TLS and server capacity for the cause.',
  run(ctx) {
    // A URL the crawler was refused on says nothing about the site, unless it is a redirect record.
    return ctx.pages.filter((page) => isRedirectRecord(page) || !isUnverifiable(page)).map((page) => {
      if (page.status !== 0) return { status: 'pass', url: page.url };
      return {
        status: 'fail',
        url: page.url,
        evidence: {
          observed: { status: 0, fetch_error: page.fetch_error },
          expected: 'An HTTP response',
          detail: page.fetch_error ? `The request failed with "${page.fetch_error}".` : 'The request got no response.',
        },
      };
    });
  },
};

export const httpChecks = [serverError, fetchFailed];
