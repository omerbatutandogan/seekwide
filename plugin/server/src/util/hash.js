import { createHash } from 'node:crypto';

/**
 * SHA-1 of a string as lower-case hex. Used for content fingerprints and ids,
 * never for security.
 * @param {string} value
 * @returns {string}
 */
export function sha1Hex(value) {
  return createHash('sha1').update(value, 'utf8').digest('hex');
}

/**
 * Stable 16-character id built from the given parts.
 * The same parts always give the same id, which is what lets two audit runs
 * be compared finding by finding.
 * @param {...string} parts
 * @returns {string}
 */
export function shortId(...parts) {
  return sha1Hex(parts.join('|')).slice(0, 16);
}
