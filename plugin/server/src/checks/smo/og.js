// The Open Graph and Twitter card tags of each page (smo module). Pure.

/** @import { CheckDef, CheckResult } from '../../types.js' */

import { effectiveCanonicalUrls } from '../page-helpers.js';
import { normalizeUrl, sameCanonicalTarget } from '../../util/url.js';
import { clip } from '../../util/strings.js';
import { DOCS, SMO, filled, sharedPages, sharingImage } from './helpers.js';

const REQUIRED = /** @type {const} */ (['title', 'type', 'url', 'description']);
/** Query parameters that carry a session or a click of a campaign, compared in lower case; `utm_` is a prefix. */
const DECORATIONS = new Set(['gclid', 'fbclid', 'msclkid', 'sessionid', 'sid', 'phpsessid', 'jsessionid']);
/** The card types X's markup reference listed (summary, summary_large_image, app, player). */
const CARD_TYPES = new Set(['summary', 'summary_large_image', 'app', 'player']);

/** @type {CheckDef} */
const imageMissing = {
  ...SMO,
  id: 'smo.og.image_missing',
  title: 'No sharing image',
  description:
    'Checks indexable pages for og:image (or og:image:url, og:image:secure_url), and twitter:image as a fallback. The Open Graph protocol lists og:image among the four properties every page needs, and WhatsApp uses it for the preview thumbnail; without one, a shared link shows no picture or one the platform picks.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.OPEN_GRAPH,
  recommendation: 'Add <meta property="og:image" content="https://…"> to the <head> with an absolute URL of an image made for sharing (1200 × 630 pixels works everywhere).',
  run(ctx) {
    return sharedPages(ctx).map((page) => (sharingImage(page) !== null
      ? { status: 'pass', url: page.url }
      : {
        status: 'fail', url: page.url, selector: 'meta[property="og:image"]',
        evidence: { observed: { og_image: null, twitter_image: null }, expected: 'og:image (or twitter:image) with an image URL' },
      }));
  },
};

/** @type {CheckDef} */
const requiredMissing = {
  ...SMO,
  id: 'smo.og.required_missing',
  title: 'Open Graph title, type, URL or description is missing',
  description:
    'Checks indexable pages for og:title, og:type, og:url and og:description with content. The Open Graph protocol requires the first three on every page; WhatsApp and LinkedIn also ask for og:description, and WhatsApp says none of them should be empty.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.OPEN_GRAPH,
  recommendation: 'Add og:title, og:type (website or article), og:url (the canonical URL) and og:description with content to the <head> of every page.',
  run(ctx) {
    return sharedPages(ctx).map((page) => {
      const missing = REQUIRED.filter((name) => !filled(page.og[name])).map((name) => `og:${name}`);
      if (missing.length === 0) return { status: 'pass', url: page.url };
      return {
        status: 'fail', url: page.url, selector: 'meta[property^="og:"]',
        evidence: { observed: { missing }, expected: 'og:title, og:type, og:url and og:description with content' },
      };
    });
  },
};

/** @type {CheckDef} */
const imageNotAbsolute = {
  ...SMO,
  id: 'smo.og.image_not_absolute',
  title: 'Sharing image URL is not absolute',
  description:
    'Checks html pages with og:image for a value that does not start with http:// or https://. WhatsApp asks for an absolute URL; a relative path is resolved differently, or not at all, by preview crawlers. A protocol-relative URL (//cdn…) passes: LinkedIn\'s own example uses one.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.WHATSAPP_PREVIEWS,
  recommendation: 'Write og:image as a full URL that starts with https://.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      const value = page.og.image;
      if (!filled(value)) continue;
      const trimmed = value.trim();
      if (/^(?:https?:)?\/\//i.test(trimmed)) results.push({ status: 'pass', url: page.url });
      else {
        results.push({
          status: 'fail', url: page.url, selector: 'meta[property="og:image"]',
          evidence: { observed: { og_image: clip(trimmed, 200) }, expected: 'A URL that starts with https:// or http://' },
        });
      }
    }
    return results;
  },
};

/**
 * Why an og:url is not the page's own clean address: the decorations it
 * carries, or the canonical it differs from; null when it is fine.
 * @param {string} raw
 * @param {import('../../types.js').PageRecord} page
 * @returns {{observed: Record<string, unknown>, detail: string}|null}
 */
function urlProblem(raw, page) {
  const url = normalizeUrl(raw.trim(), page.url);
  if (url === null) return { observed: { og_url: clip(raw.trim(), 200) }, detail: 'og:url is not a web address.' };
  // Decorations are read from the address as written: normalizing drops campaign parameters.
  const written = new URL(raw.trim(), page.url);
  const names = [...written.searchParams.keys()].map((name) => name.toLowerCase());
  const decorations = [...new Set(names.filter((name) => name.startsWith('utm_') || DECORATIONS.has(name)))];
  if (/;jsessionid=/i.test(written.pathname) && !decorations.includes('jsessionid')) decorations.push('jsessionid');
  if (decorations.length > 0) {
    return { observed: { og_url: clip(written.href, 300), parameters: decorations.slice(0, 5) }, detail: 'og:url carries a session or campaign parameter.' };
  }
  const canonicals = effectiveCanonicalUrls(page);
  if (canonicals.length === 1 && !sameCanonicalTarget(canonicals[0], url)) {
    return { observed: { og_url: clip(url, 300), canonical: clip(canonicals[0], 300) }, detail: 'og:url names another address than the page\'s canonical link.' };
  }
  return null;
}

/** @type {CheckDef} */
const urlMismatch = {
  ...SMO,
  id: 'smo.og.url_mismatch',
  title: 'og:url is not the clean canonical address',
  description:
    'Checks indexable pages whose og:url carries a session or campaign parameter (utm_*, gclid, fbclid, msclkid, session ids), or names another address than the page\'s canonical link. WhatsApp asks for the canonical URL, undecorated, without session variables. A deliberate difference is possible (a page shared under a hub address), which is why the finding is likely.',
  severity: 'low',
  weight: 1,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.WHATSAPP_PREVIEWS,
  recommendation: 'Set og:url to the page\'s canonical URL, without tracking or session parameters.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of sharedPages(ctx)) {
      const value = page.og.url;
      if (!filled(value)) continue;
      const problem = urlProblem(value, page);
      if (problem === null) results.push({ status: 'pass', url: page.url });
      else {
        results.push({
          status: 'fail', url: page.url, selector: 'meta[property="og:url"]',
          evidence: { observed: problem.observed, expected: 'The canonical URL, without session or campaign parameters', detail: problem.detail },
        });
      }
    }
    return results;
  },
};

/** @type {CheckDef} */
const sizeUndeclared = {
  ...SMO,
  id: 'smo.og.image_size_undeclared',
  title: 'Sharing image size is not declared',
  description:
    'Checks indexable pages with og:image for og:image:width and og:image:height. Facebook says these let its crawler render the image on the first share, before it has downloaded and processed it; without them the first person to share the page may see no image.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.FB_IMAGES,
  recommendation: 'Add <meta property="og:image:width"> and <meta property="og:image:height"> with the image\'s size in pixels, right after og:image.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of sharedPages(ctx)) {
      if (!filled(page.og.image)) continue;
      const missing = ['image:width', 'image:height'].filter((name) => !filled(page.og[name])).map((name) => `og:${name}`);
      results.push(missing.length === 0 ? { status: 'pass', url: page.url } : {
        status: 'fail', url: page.url, selector: 'meta[property="og:image"]',
        evidence: { observed: { missing }, expected: 'og:image:width and og:image:height' },
      });
    }
    return results;
  },
};

/** @type {CheckDef} */
const altMissing = {
  ...SMO,
  id: 'smo.og.image_alt_missing',
  title: 'Sharing image has no text alternative',
  description:
    'Checks indexable pages with og:image for og:image:alt or twitter:image:alt. The Open Graph protocol says a page that specifies og:image should specify og:image:alt, a description of what is in the image.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.OPEN_GRAPH,
  recommendation: 'Add <meta property="og:image:alt"> that says what the image shows (not a caption).',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of sharedPages(ctx)) {
      if (!filled(page.og.image)) continue;
      const named = filled(page.og['image:alt']) || filled(page.twitter['image:alt']);
      results.push(named ? { status: 'pass', url: page.url } : {
        status: 'fail', url: page.url, selector: 'meta[property="og:image"]',
        evidence: { observed: { og_image_alt: null, twitter_image_alt: null }, expected: 'og:image:alt with a description of the image' },
      });
    }
    return results;
  },
};

/** @type {CheckDef} */
const cardInvalid = {
  ...SMO,
  id: 'smo.twitter.card_invalid',
  title: 'Unknown Twitter card type',
  description:
    'Checks html pages with twitter:card for a value other than summary, summary_large_image, app and player, the card types X\'s markup reference listed. X\'s card pages now redirect to an overview without them, so the source is X\'s page as the Internet Archive kept it, and the check does not change the score.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.X_CARDS,
  recommendation: 'Set twitter:card to summary_large_image (or summary) in lower case.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      const value = page.twitter.card;
      if (!filled(value)) continue;
      results.push(CARD_TYPES.has(value.trim()) ? { status: 'pass', url: page.url } : {
        status: 'fail', url: page.url, selector: 'meta[name="twitter:card"]',
        evidence: { observed: { twitter_card: clip(value.trim(), 100) }, expected: 'summary, summary_large_image, app or player' },
      });
    }
    return results;
  },
};

export const ogChecks = [imageMissing, requiredMissing, imageNotAbsolute, urlMismatch, sizeUndeclared, altMissing, cardInvalid];
