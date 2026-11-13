/** @import { CheckDef, ImageRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { DOCS, MAX_EXAMPLES, MEDIA, counted, imageName, isExposed, mediaPages, pageResults } from './helpers.js';

/** File extensions of images, at the end of an `alt` that is a file name. */
const IMAGE_EXTENSION = /\.(?:jpe?g|png|gif|webp|avif|svg|bmp|tiff?|heic|ico)$/;
/** Words that stand in for a description (WCAG F30 and the same kind), alone or followed by a number. */
const PLACEHOLDERS = new Set(['image', 'picture', 'photo', 'img', 'graphic', 'spacer', 'placeholder', 'untitled', 'alt text']);

/**
 * The text before a trailing number and the separators in front of it ("picture 1" → "picture").
 * @param {string} text  Lower-cased and trimmed.
 */
function withoutTrailingNumber(text) {
  let end = text.length;
  while (end > 0 && text[end - 1] >= '0' && text[end - 1] <= '9') end -= 1;
  if (end === text.length) return text;
  while (end > 0 && ' _-#'.includes(text[end - 1])) end -= 1;
  return text.slice(0, end);
}

/**
 * The name of the image file without its extension, as written, when it looks
 * machine-made (no space; a digit, `-` or `_`). Null otherwise.
 * @param {ImageRecord} image
 * @returns {string|null}
 */
function machineFileName(image) {
  const raw = image.url ?? image.src;
  let segment = raw.split(/[?#]/, 1)[0];
  segment = segment.slice(segment.lastIndexOf('/') + 1);
  try {
    segment = decodeURIComponent(segment);
  } catch {
    return null;
  }
  const dot = segment.lastIndexOf('.');
  const name = dot > 0 ? segment.slice(0, dot) : segment;
  return name !== '' && !/\s/.test(name) && /[\d_-]/.test(name) ? name : null;
}

/**
 * Why an `alt` is not a description, or null when it may be one.
 * @param {ImageRecord} image  An image whose `alt`, trimmed, is not empty.
 * @returns {string|null}
 */
export function placeholderReason(image) {
  const written = /** @type {string} */ (image.alt).trim().replace(/\s+/g, ' ');
  const alt = written.toLowerCase();
  if (IMAGE_EXTENSION.test(alt)) return 'a file name';
  if (/^\d+$/.test(alt)) return 'a number';
  if (PLACEHOLDERS.has(withoutTrailingNumber(alt))) return 'a placeholder';
  // Compared as written: "Coca-Cola" on coca-cola.svg is a brand name, "IMG_0423" on IMG_0423.jpg is the file name.
  if (written === machineFileName(image)) return 'the file name';
  return null;
}

/** @type {CheckDef} */
const altMissing = {
  ...MEDIA,
  id: 'media.image.alt_missing',
  title: 'Image without alt text',
  description:
    'Looks for images that have no alt attribute and no other text alternative (aria-label, aria-labelledby or title). Screen readers then read the file name or nothing, and Google, which calls alt text the most important metadata of an image, has no words for it. An empty alt (alt="") marks a decorative image on purpose and passes; so do images hidden from assistive technology and tracking pixels.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.F65,
  recommendation:
    'Add an alt attribute to each listed image: a short description of what the image shows or does (for a linked image, where the link goes), or alt="" when the image is only decoration. Fix it in the template when the same image appears on many pages.',
  run(ctx) {
    return pageResults(
      mediaPages(ctx),
      (page) => page.images.filter(isExposed),
      (image) => image.alt === null && image.named !== true && image.figure_caption !== true,
      (failing, units) => ({
        line: failing[0].line,
        evidence: {
          observed: { without_alt: failing.length, images: units.length, examples: [...new Set(failing.map(imageName))].slice(0, MAX_EXAMPLES) },
          expected: 'An alt attribute on every image: a description, or alt="" for decoration',
          detail: `${failing.length} of ${counted(units.length, 'image', 'images')} on the page ${failing.length === 1 ? 'has' : 'have'} no alt attribute and no other text alternative. The first is ${imageName(failing[0])}${failing[0].line === null ? '' : ` (line ${failing[0].line})`}.`,
        },
      }),
      'img:not([alt])',
    );
  },
};

/** @type {CheckDef} */
const altPlaceholder = {
  ...MEDIA,
  id: 'media.image.alt_placeholder',
  title: 'Image alt text is a file name or a placeholder',
  description:
    'Looks for alt text that does not describe anything: a file name ("chart.jpg", "IMG_0423"), a number, or a placeholder word such as "image", "picture" or "spacer". WCAG lists these as text that is not an alternative, and the HTML standard asks tools not to use the file name.',
  severity: 'low',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.F30,
  recommendation:
    'Replace the alt text with a short description of what the image shows, or with alt="" when the image is only decoration. Check the setting of your CMS or image component that fills alt text from the file name.',
  run(ctx) {
    return pageResults(
      mediaPages(ctx),
      (page) => page.images.filter((image) => isExposed(image) && image.alt !== null && image.alt.trim() !== ''),
      (image) => placeholderReason(image) !== null,
      (failing, units) => ({
        line: failing[0].line,
        evidence: {
          observed: {
            placeholder_alts: failing.length,
            images_with_alt: units.length,
            examples: failing.slice(0, MAX_EXAMPLES).map((image) => ({ src: imageName(image), alt: clip(/** @type {string} */ (image.alt).trim()) })),
          },
          expected: 'Alt text that describes the image',
          detail: `${counted(failing.length, 'image has', 'images have')} alt text that is ${placeholderReason(failing[0])}: "${clip(/** @type {string} */ (failing[0].alt).trim())}" on ${imageName(failing[0])}.`,
        },
      }),
      'img[alt]',
    );
  },
};

/** Checks of text alternatives. */
export const altChecks = [altMissing, altPlaceholder];
