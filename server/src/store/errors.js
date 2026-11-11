/**
 * Build an `Error` that carries a machine-readable `code`. Callers branch on
 * the code; the message says what was wrong and what to do about it.
 * @param {string} code
 * @param {string} message
 * @returns {Error & {code: string}}
 */
export function storeError(code, message) {
  return Object.assign(new Error(message), { code });
}
