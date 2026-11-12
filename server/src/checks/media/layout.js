/** @import { CheckDef, ImageRecord } from '../../types.js' */

import { DOCS, MAX_EXAMPLES, MEDIA, counted, dimension, imageName, isRendered, mediaPages, pageResults } from './helpers.js';

/**
 * True when the browser can reserve the image's box before the file arrives:
 * both `width` and `height` attributes start with a number, or its inline
 * style sets `aspect-ratio`, both sizes, or an absolute or fixed position.
 * @param {ImageRecord} image
 */
export function reservesSpace(image) {
  return (dimension(image.width) !== null && dimension(image.height) !== null) || image.style_sized === true || image.class_sized === true;
}

/**
 * A rendered image in the page's content, not in its frame (navigation, a
 * complementary block, the page's own header or footer), where logos and icons
 * live whose box the theme's style sheet sets.
 * @param {ImageRecord} image
 */
function contentImage(image) {
  return isRendered(image) && image.chrome !== true;
}

/**
 * The page marks the image as its most important one: a priority hint or a preload.
 * @param {ImageRecord} image
 */
function markedMain(image) {
  return image.fetchpriority === 'high' || image.preloaded === true;
}

/** @type {CheckDef} */
const dimensionsMissing = {
  ...MEDIA,
  id: 'media.image.dimensions_missing',
  title: 'Image without width and height',
  description:
    'Looks for images in the content of a page (not in its navigation, header, footer or sidebar) without width and height attributes, and without an inline style or a utility class that reserves their box (aspect-ratio, both sizes, or an absolute position). The browser cannot keep room for such an image, so the page jumps when it loads: a cause of layout shift, one of the Core Web Vitals. A style sheet can reserve the room too, which the crawler does not read, and on real sites it usually does, so this is informational and does not change the score.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.OPTIMIZE_CLS,
  recommendation:
    'Give each listed image width and height attributes with its intrinsic size in pixels (CSS can still scale it with width: 100%; height: auto), or set aspect-ratio in CSS. Image components of most frameworks do this when given the size.',
  run(ctx) {
    return pageResults(
      mediaPages(ctx),
      (page) => page.images.filter(contentImage),
      (image) => !reservesSpace(image),
      (failing, units) => ({
        line: failing[0].line,
        evidence: {
          observed: { without_size: failing.length, images: units.length, examples: [...new Set(failing.map(imageName))].slice(0, MAX_EXAMPLES) },
          expected: 'width and height attributes, or CSS aspect-ratio, on every image',
          detail: `${failing.length} of ${counted(units.length, 'image', 'images')} on the page ${failing.length === 1 ? 'has' : 'have'} no width and height. The first is ${imageName(failing[0])}${failing[0].line === null ? '' : ` (line ${failing[0].line})`}.`,
        },
      }),
      'img:not([width][height])',
    );
  },
};

/** @type {CheckDef} */
const lazyPriority = {
  ...MEDIA,
  id: 'media.image.lazy_priority',
  title: 'Main image is lazy-loaded',
  description:
    'Looks for an image that the page itself marks as its most important one (fetchpriority="high", or preloaded with <link rel="preload" as="image">) and also marks loading="lazy". A lazy image waits until layout shows it is on screen, which delays the Largest Contentful Paint; web.dev says never to lazy-load that image. Which image is largest needs rendering, so only this contradiction is reported.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.OPTIMIZE_LCP,
  recommendation:
    'Remove loading="lazy" from the image (eager is the default), and keep fetchpriority="high" on it. If a plugin or theme adds lazy loading to every image, exclude the first image of the page.',
  run(ctx) {
    return pageResults(
      mediaPages(ctx),
      (page) => page.images.filter((image) => isRendered(image) && markedMain(image)),
      (image) => image.loading?.trim().toLowerCase() === 'lazy',
      (failing) => ({
        line: failing[0].line,
        evidence: {
          observed: {
            lazy_main_images: failing.length,
            examples: failing.slice(0, MAX_EXAMPLES).map((image) => ({
              src: imageName(image), fetchpriority: image.fetchpriority ?? null, preloaded: image.preloaded === true,
            })),
          },
          expected: 'The image the page marks as most important is not lazy-loaded',
          detail: `${imageName(failing[0])} is marked ${failing[0].fetchpriority === 'high' ? 'fetchpriority="high"' : 'for preloading'} and loading="lazy" at the same time.`,
        },
      }),
      'img[loading=lazy]',
    );
  },
};

/** Checks of how images take their place on the page. */
export const layoutChecks = [dimensionsMissing, lazyPriority];
