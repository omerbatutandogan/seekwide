/** @import { CheckContext, CheckDef, CheckResult, ImageFileResult } from '../../types.js' */
/** @import { FileUse } from './select.js' */

import { siteLabel } from '../../extract/security-scan.js';
import { clip } from '../../util/strings.js';
import { hostKey } from '../../util/url.js';
import { DOCS, MEDIA, attributeSelector, imageName } from './helpers.js';
import { fileUses } from './select.js';

const KIB = 1024;
/** web.dev's lowest WebP saving (25 %) reaches Lighthouse's 8 KiB threshold at this size. */
export const LEGACY_MIN_BYTES = 32 * KIB;
/** About a third of the 1,600 KiB Lighthouse suggests for everything a page loads; a rule of thumb. */
export const LARGE_BYTES = 500 * KIB;
/** Media types as servers send them, mapped to one name per format. */
const FORMATS = new Map([
  ['image/jpeg', 'jpeg'], ['image/jpg', 'jpeg'], ['image/pjpeg', 'jpeg'], ['image/png', 'png'], ['image/x-png', 'png'],
  ['image/bmp', 'bmp'], ['image/x-ms-bmp', 'bmp'], ['image/webp', 'webp'], ['image/avif', 'avif'],
]);
const LEGACY = new Set(['jpeg', 'png', 'bmp']);

/**
 * True when the server says its answer depends on the request's `Accept` or
 * `User-Agent` header: it chooses the format per client, and a browser can get
 * another one than this crawler.
 * @param {string|null} vary
 */
function negotiates(vary) {
  return (vary ?? '').split(',').some((name) => ['accept', 'user-agent', '*'].includes(name.trim().toLowerCase()));
}

/**
 * True when an image URL is on the audited site: the site's own host, or the same registered name (`acme` in
 * acme.com, cdn.acme.com and acme.co.uk), so its robots.txt is the owner's to change.
 * @param {string} url
 * @param {string} siteHost
 */
function onOwnSite(url, siteHost) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  if (hostKey(host) === hostKey(siteHost)) return true;
  const own = siteLabel(hostKey(siteHost));
  return own !== null && siteLabel(hostKey(host)) === own;
}

/**
 * One result per checked file that is a unit, on the first page that shows it.
 * @param {CheckContext} ctx
 * @param {(file: ImageFileResult, use: FileUse) => boolean} isUnit
 * @param {(file: ImageFileResult, use: FileUse) => CheckResult['evidence']|null} failure  Evidence when the unit fails, else null.
 * @returns {CheckResult[]}
 */
function fileResults(ctx, isUnit, failure) {
  if (ctx.imageFiles === null) return [];
  const uses = fileUses(ctx);
  /** @type {CheckResult[]} */
  const results = [];
  for (const [url, file] of ctx.imageFiles) {
    const use = uses.get(url);
    if (!use || !isUnit(file, use)) continue;
    const selector = attributeSelector('img', 'src', use.image.src);
    const evidence = failure(file, use);
    if (evidence === null) results.push({ status: 'pass', url: use.url, selector });
    else results.push({ status: 'fail', url: use.url, selector, line: use.image.line, evidence, related_urls: use.others });
  }
  return results;
}

/** @param {number} bytes  Rounded up, so a file over a limit never reads as the limit. */
function size(bytes) {
  return bytes >= 1024 * KIB ? `${(Math.ceil(bytes / (100 * KIB)) / 10).toFixed(1)} MiB` : `${Math.ceil(bytes / KIB)} KiB`;
}

/** @param {FileUse} use */
function shownOn(use) {
  return use.others.length === 0 ? 'this page' : `this page and ${use.others.length} more`;
}

/** @type {CheckDef} */
const broken = {
  ...MEDIA,
  id: 'media.image.broken',
  title: 'Broken image',
  description:
    'Requests the image files the pages show (up to 50 per audit) and reports those that answer 404 or 410, or whose host name does not exist. Visitors see a broken image, and Google does not index it. A refusal, a server error or a timeout is not reported: many image hosts refuse requests that do not come from a browser.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['image_files'],
  doc_ref: DOCS.HTTP_STATUS,
  recommendation: 'Restore the image at its address, point the page to the right file, or remove the image from the page and the template.',
  run(ctx) {
    return fileResults(
      ctx,
      (file) => file.outcome === 'ok' || file.outcome === 'broken',
      (file, use) => (file.outcome !== 'broken' ? null : {
        observed: { status: file.status, reason: file.reason, ...(file.final_url ? { final_url: clip(file.final_url) } : {}) },
        expected: 'The image answers 200',
        detail: `${imageName(use.image)} ${file.reason === 'dns_error' ? 'is on a host name that does not exist' : `answers ${file.status}`}; it is shown on ${shownOn(use)}.`,
      }),
    );
  },
};

/** @type {CheckDef} */
const legacyFormat = {
  ...MEDIA,
  id: 'media.image.legacy_format',
  title: 'Image served in JPEG, PNG or BMP instead of WebP or AVIF',
  description:
    'Asks for each checked image the way browsers do, saying AVIF and WebP are accepted, and reports files of 32 KiB or more that still come back as JPEG, PNG or BMP, unless the page offers a WebP or AVIF source in a <picture>. WebP files are usually 25 to 35 percent smaller. A server that says its answer varies by the Accept or User-Agent header picks the format per browser, and this crawler never claims to be a browser, so such files are left out; a server can do so without saying it, which is why this is a likely finding.',
  severity: 'low',
  weight: 2,
  impact: 2,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: ['image_files'],
  doc_ref: DOCS.LH_MODERN_FORMATS,
  recommendation:
    'Serve the image as WebP or AVIF: turn on format conversion in your image CDN or CMS, or offer them in a <picture> with <source type="image/avif"> and <source type="image/webp"> and keep the JPEG or PNG as the fallback.',
  run(ctx) {
    return fileResults(
      ctx,
      (file) => file.outcome === 'ok' && file.status < 300 && FORMATS.has(file.content_type ?? '') && (file.bytes ?? 0) >= LEGACY_MIN_BYTES
        && !negotiates(file.vary),
      (file, use) => {
        const format = /** @type {string} */ (FORMATS.get(/** @type {string} */ (file.content_type)));
        if (!LEGACY.has(format) || !file.modern_accepted || use.modern) return null;
        return {
          observed: { content_type: file.content_type, bytes: file.bytes, vary: file.vary },
          expected: 'WebP or AVIF for a request that accepts them',
          detail: `${imageName(use.image)} came back as ${file.content_type} (${size(/** @type {number} */ (file.bytes))}) to a request that accepts AVIF and WebP${file.vary ? `; the server says it varies by ${file.vary}` : ''}.`,
        };
      },
    );
  },
};

/** @type {CheckDef} */
const largeFile = {
  ...MEDIA,
  id: 'media.image.large_file',
  title: 'Image file over 500 KiB',
  description:
    'Reports checked image files larger than 500 KiB that the page shows without srcset or <picture> sources, so every visitor loads this file. No official limit exists for one image; Lighthouse suggests keeping everything a page loads under 1,600 KiB, and one file of 500 KiB is about a third of that. A rule of thumb, so it does not change the score.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: ['image_files'],
  doc_ref: DOCS.LH_TOTAL_BYTES,
  recommendation:
    'Resize the image to the largest size it is shown at, compress it (WebP or AVIF where possible), and offer smaller versions with srcset for small screens.',
  run(ctx) {
    return fileResults(
      ctx,
      (file, use) => file.outcome === 'ok' && file.status < 300 && (file.content_type ?? '').startsWith('image/') && file.bytes !== null && !use.responsive,
      (file, use) => ((file.bytes ?? 0) <= LARGE_BYTES ? null : {
        observed: { bytes: file.bytes, content_type: file.content_type },
        expected: '500 KiB or less',
        detail: `${imageName(use.image)} is ${size(/** @type {number} */ (file.bytes))}; it is shown on ${shownOn(use)}.`,
      }),
    );
  },
};

/** @type {CheckDef} */
const robotsBlocked = {
  ...MEDIA,
  id: 'media.image.robots_blocked',
  title: 'Image blocked for Google by robots.txt',
  description:
    'Reads the robots.txt of the host each checked image of the site\'s own domain is served from (and of each redirect step) and reports images it keeps from Googlebot, which leaves them out of every Google search, or from Googlebot-Image, which leaves them out of Google Images. It is the image host\'s robots.txt that counts, not the page\'s. Images on another organisation\'s host are left out, because its robots.txt is not the owner\'s to change, and so are images shown only in the page\'s frame (logos, icons and badges in the navigation, header, footer or sidebar), which are not what people search Google Images for. A site can keep its images out of Google Images on purpose, so this is a likely finding.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: ['image_files'],
  doc_ref: DOCS.PREVENT_IMAGES,
  recommendation:
    'If the images should appear in Google, remove or narrow the Disallow rule in the robots.txt of the host named in the finding (often a rule for a folder such as /wp-content/ or /assets/). If keeping them out is intended, no change is needed.',
  run(ctx) {
    return fileResults(
      ctx,
      (file, use) => file.google !== null && use.content && onOwnSite(file.url, ctx.site.host),
      (file, use) => (file.google !== 'disallowed' ? null : {
        observed: { crawler: file.google_agent, robots_host: file.google_host },
        expected: 'robots.txt allows Googlebot and Googlebot-Image to fetch the image',
        detail: `The robots.txt of ${file.google_host} does not allow ${file.google_agent} to fetch ${imageName(use.image)}${file.final_url ? ' or a step of its redirect' : ''}.`,
      }),
    );
  },
};

/** Checks of the image files, which need the requests made before the checks ran. */
export const fileChecks = [broken, legacyFormat, largeFile, robotsBlocked];
