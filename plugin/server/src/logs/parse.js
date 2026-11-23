// One line of a web server's access log, in the Common Log Format or the
// combined format Apache and nginx write by default:
//
//   host ident user [10/Oct/2026:13:55:36 +0200] "GET /path HTTP/1.1" 200 2326 "referer" "user agent"
//
// Every value is data from a file the user supplied, and much of it was written
// by whoever sent the request: a path or a user agent can say anything. Only
// what the summary needs is kept: the day, the path without its query, the
// status and the user agent. The client address is read past and never kept.

/** The longest line read; the rest of a longer line is not looked at. */
export const MAX_LINE_CHARS = 16 * 1024;
/** The longest user agent matched against the crawler tokens. */
export const MAX_AGENT_CHARS = 1024;

const MONTHS = Object.freeze({ Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 });

// A quoted field: anything but a quote or a backslash, or a backslash and the character it escapes (Apache writes \",
// nginx \x22). Each character can be read one way only, so the pattern cannot backtrack on a long line.
const QUOTED = '"((?:[^"\\\\]|\\\\.)*)"';
const LINE = new RegExp(
  `^\\S+ \\S+ \\S+ \\[(\\d{2})/([A-Z][a-z]{2})/(\\d{4}):(\\d{2}):(\\d{2}):(\\d{2}) ([+-])(\\d{2})(\\d{2})\\] ${QUOTED} (\\d{3}) (?:\\d+|-)(?: ${QUOTED} ${QUOTED})?`,
);
const REQUEST = /^([A-Z]{1,16}) (\S+)(?: HTTP\/\d(?:\.\d)?)?$/;

/**
 * @typedef {Object} LogEntry
 * @property {string} day           YYYY-MM-DD, in UTC.
 * @property {string|null} method   Null when the request line is not a method and a target (a probe or garbage).
 * @property {string|null} path     The target's path without query or fragment, or null when it is not one that starts with "/".
 * @property {number} status
 * @property {string|null} agent    Null in the Common Log Format, which has none, and for "-".
 */

/**
 * Undo the escapes Apache (`\"`, `\\`) and nginx (`\xHH`) write into a quoted field.
 * @param {string} value
 */
function unescape(value) {
  if (!value.includes('\\')) return value;
  return value.replace(/\\x([0-9A-Fa-f]{2})|\\(.)/g, (_, hex, char) => (hex === undefined ? char : String.fromCharCode(Number.parseInt(hex, 16))));
}

/**
 * The UTC day of a log time, or null when the time does not exist.
 * @param {string[]} parts  day, month name, year, hour, minute, second, sign, offset hours, offset minutes.
 */
function utcDay([day, month, year, hour, minute, second, sign, offsetHours, offsetMinutes]) {
  const monthIndex = MONTHS[/** @type {keyof typeof MONTHS} */ (month)];
  if (monthIndex === undefined) return null;
  const local = Date.UTC(Number(year), monthIndex, Number(day), Number(hour), Number(minute), Number(second));
  const check = new Date(local);
  if (check.getUTCDate() !== Number(day) || check.getUTCMonth() !== monthIndex || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 60) return null;
  const offset = (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60_000 * (sign === '-' ? -1 : 1);
  return new Date(local - offset).toISOString().slice(0, 10);
}

/**
 * The path of a request target, without query and fragment; null for a target
 * that is not a path (`*`, a full URL, a CONNECT authority).
 * @param {string} target
 */
function pathOf(target) {
  if (!target.startsWith('/') || target.startsWith('//')) return null;
  const end = target.search(/[?#]/);
  return end === -1 ? target : target.slice(0, end);
}

/**
 * Read one access log line, or null when it is not in either format.
 * @param {string} line
 * @returns {LogEntry|null}
 */
export function parseLogLine(line) {
  const match = LINE.exec(line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line);
  if (match === null) return null;
  const day = utcDay(match.slice(1, 10));
  if (day === null) return null;
  const request = REQUEST.exec(unescape(match[10]));
  const status = Number(match[11]);
  if (status < 100 || status > 599) return null;
  const agent = match[13] === undefined ? null : unescape(match[13]).slice(0, MAX_AGENT_CHARS);
  return {
    day,
    method: request === null ? null : request[1],
    path: request === null ? null : pathOf(request[2]),
    status,
    agent: agent === null || agent === '' || agent === '-' ? null : agent,
  };
}
