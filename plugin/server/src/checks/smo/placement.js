// Where a page's Open Graph tags stand in its HTML (smo module): inside the
// head, and early enough for the preview crawlers that read only the start of
// a page. Pure.

/** @import { CheckDef, CheckResult } from '../../types.js' */

import { DOCS, FACEBOOK_HEAD_BYTES, HEAD_LIMIT_BYTES, SMO, filled, hasSocial } from './helpers.js';

/** Placed tags whose place outside `<head>` this module reports; `apple-itunes-app` is the aso module's. */
const OG_PLACED = new Set(['og:title', 'og:description', 'og:url', 'og:image']);

/** The Open Graph properties whose presence makes a page one that gives a preview. */
const OG_NAMES = ['title', 'description', 'url', 'image'];

/** @param {number} bytes */
const kib = (bytes) => `${Math.ceil(bytes / 1024)} KiB`;

/** @type {CheckDef} */
const outsideHead = {
  ...SMO,
  id: 'smo.og.outside_head',
  title: 'Open Graph tags outside the head',
  description:
    'Checks html pages that give Open Graph tags for og:title, og:description, og:url and og:image that appear only outside <head>. WhatsApp requires them inside the <head> tag. A Next.js App Router page can send its metadata in the body ("streaming metadata"); crawlers that run scripts read it, but a preview crawler may not, which is why the finding is likely.',
  severity: 'low',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.WHATSAPP_PREVIEWS,
  recommendation: 'Move the Open Graph meta tags into the <head>. On a Next.js page that streams its metadata, return it without waiting (static metadata, or a generateMetadata that does not await slow data), or add the preview crawlers to htmlLimitedBots in next.config.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      if (!hasSocial(page) || !OG_NAMES.some((name) => filled(page.og[name]))) continue;
      const outside = page.social.outside_head.filter((entry) => OG_PLACED.has(entry.key));
      if (outside.length === 0) {
        results.push({ status: 'pass', url: page.url });
        continue;
      }
      results.push({
        status: 'fail', url: page.url, selector: 'meta[property^="og:"]', line: outside[0].line,
        evidence: {
          observed: { outside_head: outside.map((entry) => entry.key), streamed: page.social.streamed },
          expected: 'Open Graph tags inside <head>',
          ...(page.social.streamed ? { detail: 'This Next.js page sent its metadata in the body (streaming metadata), together with its title. Browsers and crawlers that run scripts read it; a preview crawler that reads the HTML as sent may not.' } : {}),
        },
      });
    }
    return results;
  },
};

/** @type {CheckDef} */
const headTooLate = {
  ...SMO,
  id: 'smo.og.head_too_late',
  title: 'The head ends after the first 300 KB',
  description:
    'Measures where the <head> of each html page that gives Open Graph tags ends, in bytes of the response (or the last og: tag when the head has no place of its own). WhatsApp reads a preview only from a <head> within the first 300 KB of the HTML; Facebook ignores Open Graph tags after the first 1 MB.',
  severity: 'medium',
  weight: 2,
  impact: 2,
  effort: 2,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.WHATSAPP_PREVIEWS,
  recommendation: 'Put the Open Graph tags early in the <head> and move large inline scripts, styles and data out of the head or after it, so that the head ends within the first 300 KB.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      // Where the head of a page without Open Graph tags ends changes no preview.
      if (!hasSocial(page) || page.social.head_end === null || !OG_NAMES.some((name) => filled(page.og[name]))) continue;
      const { bytes, by } = page.social.head_end;
      if (bytes <= HEAD_LIMIT_BYTES) {
        results.push({ status: 'pass', url: page.url });
        continue;
      }
      const where = by === 'head' ? 'The <head> ends' : 'The last og: tag ends';
      results.push({
        status: 'fail', url: page.url, selector: 'head',
        evidence: {
          observed: { bytes, measured_at: by === 'head' ? 'end of <head>' : 'end of the last og: tag' },
          expected: `${kib(HEAD_LIMIT_BYTES)} or less (WhatsApp)`,
          detail: bytes > FACEBOOK_HEAD_BYTES
            ? `${where} after ${kib(bytes - 1)}, past WhatsApp's 300 KB and past the first 1 MB that Facebook reads Open Graph tags from.`
            : `${where} after ${kib(bytes - 1)}, past the 300 KB WhatsApp reads.`,
        },
      });
    }
    return results;
  },
};

export const placementChecks = [outsideHead, headTooLate];
