// The sharing image files themselves (smo module): whether they answer, their
// pixel size and their weight. Read from `ctx.socialImages`, which the audit
// collects before the checks run. Pure.

/** @import { CheckContext, CheckDef, CheckResult, ImageFileResult } from '../../types.js' */
/** @import { SharingUse } from './select.js' */

import { DOCS, FACEBOOK_IMAGE_BYTES, IMAGE_LIMIT_BYTES, LINKEDIN_IMAGE_BYTES, SMO } from './helpers.js';
import { sharingUses } from './select.js';

/** Facebook's smallest image. */
export const MIN_SIDE = 200;
/** Facebook shows a large image from 600 × 315; LinkedIn shows a thumbnail below 401 pixels wide; WhatsApp asks for 300 wide. */
const FACEBOOK_LARGE = { width: 600, height: 315 };
const LINKEDIN_MIN_WIDTH = 401;
const WHATSAPP_MIN_WIDTH = 300;
/** The ratio Facebook and LinkedIn recommend, how far from it a ratio may be, and WhatsApp's widest. */
const RATIO = 1.91;
const RATIO_TOLERANCE = 0.15;
const WHATSAPP_MAX_RATIO = 4;

/**
 * @typedef {{width: number, height: number, source: 'file'|'declared'}} KnownSize
 */

/**
 * The pixel size of a sharing image: what the file's first bytes say, else
 * what the page declares with og:image:width and og:image:height.
 * @param {ImageFileResult} file @param {SharingUse} use
 * @returns {KnownSize|null}
 */
function knownSize(file, use) {
  if (file.outcome === 'ok' && file.size) return { width: file.size.width, height: file.size.height, source: 'file' };
  return use.declared === null ? null : { ...use.declared, source: 'declared' };
}

/** @param {number} bytes */
const size = (bytes) => (bytes >= 1024 * 1024 ? `${(Math.ceil(bytes / (100 * 1024)) / 10).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`);

/**
 * One result per checked sharing image that is a unit, on the first page that gives it.
 * @param {CheckContext} ctx
 * @param {(file: ImageFileResult, use: SharingUse) => boolean} isUnit
 * @param {(file: ImageFileResult, use: SharingUse) => CheckResult['evidence']|null} failure  Evidence when the unit fails, else null.
 * @returns {CheckResult[]}
 */
function fileResults(ctx, isUnit, failure) {
  if (ctx.socialImages === null) return [];
  const uses = sharingUses(ctx);
  /** @type {CheckResult[]} */
  const results = [];
  for (const [url, file] of ctx.socialImages) {
    const use = uses.get(url);
    if (!use || !isUnit(file, use)) continue;
    const selector = `meta[property="${use.property}"]`;
    const evidence = failure(file, use);
    if (evidence === null) results.push({ status: 'pass', url: use.url, selector });
    else results.push({ status: 'fail', url: use.url, selector, evidence, related_urls: use.others });
  }
  return results;
}

/** @type {CheckDef} */
const broken = {
  ...SMO,
  id: 'smo.og.image_broken',
  title: 'Sharing image is broken',
  description:
    'Requests the sharing images the pages give (og:image, else twitter:image; up to 20 per audit) and reports those that answer 404 or 410, or whose host name does not exist. A preview crawler then has no image to show. A refusal, a server error or a timeout is not reported.',
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['social_images'],
  doc_ref: DOCS.HTTP_STATUS,
  recommendation: 'Point og:image at an image that exists, or restore the file. Use a new URL for a new image: Facebook caches images by URL.',
  run(ctx) {
    return fileResults(ctx, (file) => file.outcome === 'ok' || file.outcome === 'broken', (file) => (file.outcome !== 'broken' ? null : {
      observed: { status: file.status, reason: file.reason }, expected: 'An image that answers 200',
    }));
  },
};

/** @type {CheckDef} */
const tooSmall = {
  ...SMO,
  id: 'smo.og.image_too_small',
  title: 'Sharing image is smaller than 200 × 200 pixels',
  description:
    'Reads the pixel size of each checked sharing image from the first 64 KiB of the file (PNG, GIF, WebP, JPEG), or else from og:image:width and og:image:height when the page declares both. Facebook\'s minimum is 200 × 200 pixels.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 2,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['social_images'],
  doc_ref: DOCS.FB_IMAGES,
  recommendation: 'Use a sharing image of at least 1200 × 630 pixels; Facebook refuses images under 200 × 200.',
  run(ctx) {
    return fileResults(ctx, (file, use) => file.outcome !== 'broken' && knownSize(file, use) !== null, (file, use) => {
      const known = /** @type {KnownSize} */ (knownSize(file, use));
      if (known.width >= MIN_SIDE && known.height >= MIN_SIDE) return null;
      return {
        observed: { width: known.width, height: known.height, from: known.source === 'file' ? 'the file' : 'og:image:width and og:image:height' },
        expected: `At least ${MIN_SIDE} × ${MIN_SIDE} pixels`,
      };
    });
  },
};

/** @type {CheckDef} */
const heavy = {
  ...SMO,
  id: 'smo.og.image_heavy',
  title: 'Sharing image is over 600 KB',
  description:
    'Reads the size of each checked sharing image from the server\'s answer (Content-Range or Content-Length). WhatsApp asks for an image under 600 KB; LinkedIn accepts at most 5 MB and Facebook at most 8 MB, which the evidence names when the file is over them.',
  severity: 'low',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: ['social_images'],
  doc_ref: DOCS.WHATSAPP_PREVIEWS,
  recommendation: 'Compress the sharing image or save it as JPEG or WebP at 1200 × 630 pixels; that is usually well under 300 KB.',
  run(ctx) {
    return fileResults(ctx, (file) => file.outcome === 'ok' && file.bytes !== null, (file) => {
      const bytes = /** @type {number} */ (file.bytes);
      if (bytes <= IMAGE_LIMIT_BYTES) return null;
      const over = [
        bytes > LINKEDIN_IMAGE_BYTES ? "LinkedIn's 5 MB" : '',
        bytes > FACEBOOK_IMAGE_BYTES ? "Facebook's 8 MB" : '',
      ].filter(Boolean);
      return {
        observed: { bytes, content_type: file.content_type },
        expected: `${size(IMAGE_LIMIT_BYTES)} or less (WhatsApp)`,
        detail: over.length === 0 ? `The file is ${size(bytes)}.` : `The file is ${size(bytes)}, over ${over.join(' and ')} as well.`,
      };
    });
  },
};

/**
 * How a preview shows an image of this size, when it is not the large picture
 * the platforms describe.
 * @param {number} width @param {number} height
 * @returns {string[]}
 */
function shapeProblems(width, height) {
  const ratio = width / height;
  return [
    width < FACEBOOK_LARGE.width || height < FACEBOOK_LARGE.height ? 'Facebook shows an image under 600 × 315 pixels much smaller' : '',
    width < LINKEDIN_MIN_WIDTH ? 'LinkedIn shows an image under 401 pixels wide as a thumbnail' : '',
    width < WHATSAPP_MIN_WIDTH ? 'WhatsApp asks for 300 pixels of width or more' : '',
    ratio > WHATSAPP_MAX_RATIO ? 'WhatsApp asks for a width of at most 4 times the height' : '',
    Math.abs(ratio - RATIO) / RATIO > RATIO_TOLERANCE ? `the ratio ${ratio.toFixed(2)}:1 is more than 15 % away from the 1.91:1 Facebook and LinkedIn recommend, so it is cropped` : '',
  ].filter(Boolean);
}

/** @type {CheckDef} */
const previewShape = {
  ...SMO,
  id: 'smo.og.image_preview_shape',
  title: 'Sharing image will show small or cropped',
  description:
    'Compares the pixel size of each checked sharing image with what the platforms describe for a large preview: Facebook shows images under 600 × 315 much smaller, LinkedIn shows images under 401 pixels wide as a thumbnail, WhatsApp asks for 300 pixels of width and a ratio of at most 4:1, and Facebook and LinkedIn recommend 1.91:1. A small square image can be a deliberate choice, so the check does not change the score.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: ['social_images'],
  doc_ref: DOCS.FB_IMAGES,
  recommendation: 'Use a sharing image of 1200 × 630 pixels (1.91:1) with the important part in the middle.',
  run(ctx) {
    return fileResults(ctx, (file, use) => file.outcome !== 'broken' && knownSize(file, use) !== null, (file, use) => {
      const known = /** @type {KnownSize} */ (knownSize(file, use));
      const problems = shapeProblems(known.width, known.height);
      return problems.length === 0 ? null : {
        observed: { width: known.width, height: known.height }, expected: '1200 × 630 pixels, or at least 600 × 315 at about 1.91:1',
        detail: `${problems.join('; ')}.`.replace(/^./, (first) => first.toUpperCase()),
      };
    });
  },
};

export const imageChecks = [broken, tooSmall, heavy, previewShape];
