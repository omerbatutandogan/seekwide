// Errors about an imported file. The message says what is wrong and what to
// do, and never quotes the file's content: a header, a value or a name inside
// an archive is data the user supplied, and an error message reaches the model
// as the plugin's own words.

/** @typedef {'NOT_FOUND'|'OUTSIDE_PROJECT'|'NOT_A_FILE'|'TOO_LARGE'|'EMPTY'|'MALFORMED'|'UNSUPPORTED'|'LIMIT'} ImportErrorCode */

export class ImportError extends Error {
  /**
   * @param {ImportErrorCode} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * @param {string} why  A fixed phrase of the plugin's, never text from the file.
 * @returns {ImportError}
 */
export function malformed(why) {
  return new ImportError('MALFORMED', `The file could not be read: ${why}. Download the export again and import the new file.`);
}

/**
 * @param {string} what  What went over the limit, in the plugin's words.
 * @returns {ImportError}
 */
export function overLimit(what) {
  return new ImportError('LIMIT', `The file was not imported: ${what}. A Search Console or Bing export is far smaller; check that this is the export file.`);
}
