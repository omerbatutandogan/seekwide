// Logging goes to stderr only. stdout carries the MCP protocol, so nothing in
// the server may ever write to it.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

/**
 * @param {string|undefined} name
 * @returns {number}
 */
function levelFromEnv(name) {
  if (name && Object.hasOwn(LEVELS, name)) return LEVELS[/** @type {keyof typeof LEVELS} */ (name)];
  return LEVELS.warn;
}

const threshold = levelFromEnv(process.env.SEEKWIDE_LOG);

/**
 * @param {keyof typeof LEVELS} level
 * @param {string} message
 * @param {Record<string, unknown>} [fields]
 */
function write(level, message, fields) {
  if (LEVELS[level] > threshold) return;
  const suffix = fields ? ` ${JSON.stringify(fields)}` : '';
  process.stderr.write(`[seekwide] ${level}: ${message}${suffix}\n`);
}

export const log = {
  /** @param {string} message @param {Record<string, unknown>} [fields] */
  error: (message, fields) => write('error', message, fields),
  /** @param {string} message @param {Record<string, unknown>} [fields] */
  warn: (message, fields) => write('warn', message, fields),
  /** @param {string} message @param {Record<string, unknown>} [fields] */
  info: (message, fields) => write('info', message, fields),
  /** @param {string} message @param {Record<string, unknown>} [fields] */
  debug: (message, fields) => write('debug', message, fields),
};
