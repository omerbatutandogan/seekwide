#!/usr/bin/env node
// Run a command for a limited time, then stop it and everything it started.
// The scaffolds use it for servers they start outside the eval sandbox, so
// that none is left running after the suite.
//
// Usage: node timed.mjs <seconds> <log-file> <command> [args...]

import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';

const [secondsArg, logFile, command, ...args] = process.argv.slice(2);
if (!secondsArg || !logFile || !command) {
  console.error('Usage: node timed.mjs <seconds> <log-file> <command> [args...]');
  process.exit(2);
}
const log = openSync(logFile, 'a');
const child = spawn(command, args, { stdio: ['ignore', log, log], detached: true });
const stop = () => {
  try {
    process.kill(-(/** @type {number} */ (child.pid)), 'SIGTERM');
  } catch {
    // Already gone.
  }
};
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => { stop(); process.exit(0); });
setTimeout(stop, Number(secondsArg) * 1000);
