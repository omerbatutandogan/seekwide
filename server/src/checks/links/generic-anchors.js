// Anchor texts that say nothing about the page they link to. Used by
// `links.anchor.generic`. Entries are written the way a person would write them;
// `normalizeAnchorText` is applied to both the list and the link text before comparing.

const ENGLISH = [
  'click here', 'here', 'read more', 'more', 'learn more', 'this', 'link', 'this link',
  'this page', 'continue', 'continue reading', 'details', 'more info', 'more information',
];
const TURKISH = [
  'tıklayın', 'buraya tıklayın', 'burada', 'buraya', 'devamı', 'devamını oku',
  'daha fazla', 'detaylar', 'incele',
];
const GERMAN = ['hier', 'hier klicken', 'mehr', 'weiterlesen', 'mehr erfahren'];
const SPANISH = ['aquí', 'haz clic aquí', 'leer más', 'más', 'ver más'];
const FRENCH = ['ici', 'cliquez ici', 'lire la suite', 'en savoir plus', 'plus'];

/**
 * Lower-case a link text, remove punctuation and symbols, and collapse whitespace.
 *
 * Turkish letters are folded so the comparison holds whatever the casing:
 * JavaScript's `toLowerCase` turns "İ" into "i" plus a combining dot and "I"
 * into "i", while a Turkish writer expects "ı" for "I". Both "TIKLAYIN" and
 * "Tıklayın" therefore reduce to the same string.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeAnchorText(text) {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/̇/gu, '')
    .replace(/ı/gu, 'i')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Normalized generic anchor texts in English, Turkish, German, Spanish and French. */
export const GENERIC_ANCHORS = new Set(
  [...ENGLISH, ...TURKISH, ...GERMAN, ...SPANISH, ...FRENCH].map(normalizeAnchorText),
);
