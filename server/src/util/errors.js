// Errors the caller caused, told apart from faults of the plugin.

/**
 * An error in what the caller passed: an argument or a setting that cannot be
 * used. A tool reports its message as something to fix and call again. Any
 * other error is a fault of the plugin: the tool answers with a generic message
 * and logs the detail.
 *
 * It extends TypeError, so code that already treats a TypeError as a refusal
 * of its input keeps working; the tools catch InputError only.
 */
export class InputError extends TypeError {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}
