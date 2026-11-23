// The fix of one page's image markup (ARCHITECTURE.md 4.13): width and height
// for images that do not reserve their box, and eager loading for the image
// the page marks as its main one. Which images they are is read from the
// stored crawl with the checks' own rules, never from the stored run's text.

/** @import { Finding, ImageRecord, PageRecord } from '../types.js' */
/** @import { ImageSize } from '../util/image-size.js' */
/** @import { FIXABLE_CHECKS } from './fixes.js' */
/** @import { PlanContext } from './fix-common.js' */

import { isRendered } from '../checks/media/helpers.js';
import { contentImage, markedMain, reservesSpace } from '../checks/media/layout.js';
import { clip } from '../util/strings.js';
import { CURRENT_CLIP, resolvePageFile } from './fix-common.js';
import { imageHow } from './fix-texts.js';
import { isHtmlFile } from './html-routes.js';

/** Images listed with one fix. */
export const MAX_IMAGES = 20;

/**
 * Which images of a page each image fix is about: the check's units and its
 * failing ones, by the check's own rules.
 * @type {Readonly<Record<string, {units: (page: PageRecord) => ImageRecord[], fails: (image: ImageRecord) => boolean}>>}
 */
export const IMAGE_UNITS = Object.freeze({
  'media.image.dimensions_missing': { units: (page) => page.images.filter(contentImage), fails: (image) => !reservesSpace(image) },
  'media.image.lazy_priority': {
    units: (page) => page.images.filter((image) => isRendered(image) && markedMain(image)),
    fails: (image) => image.loading?.trim().toLowerCase() === 'lazy',
  },
});

/**
 * The project file an image URL is served from, relative to the source
 * folder, or null: an image on another origin, one Next.js built from an
 * import (`/_next/static/…`), or a path the project's listing does not have.
 * `/_next/image?url=/…` is the file its `url` names.
 * @param {string|null} url
 * @param {string} origin  The audited origin.
 * @param {{isNext: boolean, files: Set<string>}} project
 * @returns {string|null}
 */
export function imageFileOf(url, origin, { isNext, files }) {
  if (url === null) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.origin !== origin) return null;
  let pathname = parsed.pathname;
  if (isNext && pathname === '/_next/image') {
    const inner = parsed.searchParams.get('url');
    if (inner === null || !inner.startsWith('/') || inner.startsWith('//')) return null;
    pathname = inner.split(/[?#]/)[0];
  }
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const parts = decoded.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '..' || part === '.' || part.includes('\\') || part.includes('\0'))) return null;
  const file = `${isNext ? 'public/' : ''}${parts.join('/')}`;
  return files.has(file) ? file : null;
}

/**
 * Plan the fix of an image-markup finding, or refuse it with the reason.
 * @param {PlanContext} ctx
 * @param {Finding} finding
 * @param {typeof FIXABLE_CHECKS[string]} fix
 */
export function planImage(ctx, finding, fix) {
  const { pages, crawl, inProject, refuse, base } = ctx;
  const resolved = resolvePageFile(ctx, finding);
  if (resolved === null) return;
  const { file, source } = resolved;
  if (crawl === null) {
    return refuse(finding, 'The crawl this audit was made from is no longer stored, so the plugin cannot tell which images of the page the finding is about. Audit again, then plan the fixes from the new run.');
  }
  const page = pages.get(/** @type {string} */ (finding.url));
  const rule = IMAGE_UNITS[finding.check_id];
  const failing = page ? rule.units(page).filter(rule.fails) : [];
  if (failing.length === 0) {
    return refuse(finding, 'The stored crawl has no image on this page that matches the finding. Audit again, then plan the fixes from the new run.');
  }
  const html = isHtmlFile(file);
  // The served page's lines are the file's when the finding's first line maps to itself, which repo mode
  // gives only for a file that is the page it serves.
  const sameLines = html && source.line !== null && source.line === finding.line;
  /** @type {{src: string, line: number|null, file: string|null, size: ImageSize|null}[]} */
  const images = failing.slice(0, MAX_IMAGES).map((image) => {
    const local = imageFileOf(image.url, crawl.site_origin, ctx);
    return {
      src: clip(image.src.trim(), CURRENT_CLIP),
      line: sameLines && Number.isSafeInteger(image.line) && /** @type {number} */ (image.line) > 0 ? image.line : null,
      file: local === null ? null : inProject(local),
      size: local === null ? null : ctx.imageSizes.get(local) ?? null,
    };
  });
  const line = Number.isSafeInteger(source.line) && /** @type {number} */ (source.line) > 0 ? source.line : null;
  ctx.add({
    ...base(finding),
    type: 'image',
    action: fix.action,
    kind: html ? 'html' : 'next-app',
    file: inProject(file),
    line,
    route: typeof source.route === 'string' ? clip(source.route, CURRENT_CLIP) : null,
    how: imageHow({ action: fix.action, html, count: failing.length, listed: images.length, unsized: images.filter((image) => image.size === null).length }),
    needs_site_url: false,
    current: { images_failing: failing.length },
    images,
    ...(!html ? { layouts: ctx.layoutsOf(file).map(inProject) } : {}),
  });
}
