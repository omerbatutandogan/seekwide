// Access log lines for tests, in the combined format (or the Common Log Format without an agent).

/** @param {string} target @param {number} status @param {string|null} agent @param {string} [time] */
export const logLine = (target, status, agent, time = '23/Nov/2026:10:00:00 +0300') =>
  `203.0.113.5 - - [${time}] "GET ${target} HTTP/1.1" ${status} 512${agent === null ? '' : ` "-" "${agent}"`}`;
