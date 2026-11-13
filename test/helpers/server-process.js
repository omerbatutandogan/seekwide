// The real entry point as a child process, for tests: JSON-RPC over stdin and
// stdout, and a stop that never leaves a server running. A test that fails
// part-way must end at once; a server left running keeps the test process
// alive, and a request it never answers would be awaited for ever.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ENTRY = fileURLToPath(new URL('../../plugin/server/src/index.js', import.meta.url));

/** Longest wait for one answer; crawl_status may itself wait 25 seconds. */
export const REQUEST_TIMEOUT_MS = 60_000;
/** Longest wait for the server to exit after stdin closed. */
const EXIT_TIMEOUT_MS = 10_000;

/** @type {Set<import('node:child_process').ChildProcess>} */
const running = new Set();

/**
 * Variables a Windows process cannot do without: without SystemRoot, Node
 * cannot open a socket there. Empty on other systems.
 */
const WINDOWS_ENV = Object.fromEntries(
  ['SystemRoot', 'windir', 'TEMP', 'TMP', 'PATHEXT', 'ComSpec'].flatMap((name) => (process.platform === 'win32' && process.env[name] !== undefined ? [[name, process.env[name]]] : [])),
);

/**
 * Kill a process and everything it started. A process started with
 * `detached: true` leads its own process group on POSIX; Windows has no
 * process groups, and taskkill ends the tree instead.
 * @param {number} pid
 */
export function killTree(pid) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else process.kill(-pid, 'SIGKILL');
}

/**
 * Kill every server started by `startProcess` that is still running. Register
 * it with `afterEach`, so a failed assertion cannot leave one behind.
 */
export function stopAll() {
  for (const child of running) child.kill('SIGKILL');
  running.clear();
}

/**
 * Start the real entry point and talk to it over stdio.
 *
 * Guarantees: `request` resolves with the answer to its id, and rejects when
 * the server exits first or does not answer within `requestTimeoutMs`;
 * `close` ends stdin and asserts that the server exits by itself with code 0.
 *
 * @param {string} dir  Working folder, home and project folder of the server.
 * @param {Record<string, string>} env  The server's whole environment besides PATH and HOME.
 * @param {{requestTimeoutMs?: number}} [options]
 */
export function startProcess(dir, env, { requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const child = spawn(process.execPath, [ENTRY], { cwd: dir, env: { PATH: process.env.PATH, ...WINDOWS_ENV, HOME: dir, USERPROFILE: dir, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  running.add(child);
  // A write to a server that was just killed fails with EPIPE; the request is rejected by the exit handler below.
  child.stdin.on('error', () => {});

  /** @type {string[]} */
  const lines = [];
  /** @type {Map<string|number, {resolve: (message: any) => void, reject: (error: Error) => void}>} */
  const waiting = new Map();
  const io = { buffer: '', stderr: '' };
  /** @type {{code: number|null, signal: string|null}|null} */
  let exit = null;
  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      running.delete(child);
      exit = { code, signal };
      for (const [id, pending] of waiting) pending.reject(new Error(`The server exited (code ${code}, signal ${signal}) before it answered request ${String(id)}. Its log: ${io.stderr}`));
      waiting.clear();
      resolve(exit);
    });
  });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    io.buffer += chunk;
    let newline = io.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = io.buffer.slice(0, newline);
      io.buffer = io.buffer.slice(newline + 1);
      lines.push(line);
      const message = JSON.parse(line);
      waiting.get(message.id)?.resolve(message);
      waiting.delete(message.id);
      newline = io.buffer.indexOf('\n');
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    io.stderr += chunk;
  });

  /** @param {Record<string, unknown>} message @returns {Promise<any>} */
  const request = (message) => {
    const id = /** @type {string|number} */ (message.id);
    if (exit !== null) return Promise.reject(new Error(`The server already exited (code ${exit.code}, signal ${exit.signal}).`));
    /** @type {NodeJS.Timeout|undefined} */
    let timer;
    const answer = new Promise((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      timer = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`The server did not answer request ${String(id)} within ${requestTimeoutMs} ms.`));
      }, requestTimeoutMs);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
    return answer.finally(() => clearTimeout(timer));
  };
  /** @param {any} response */
  const toolResult = (response) => {
    assert.equal(response.result.isError, undefined, response.result.content?.[0]?.text);
    return JSON.parse(response.result.content[0].text);
  };
  /** Close stdin and wait for the server to exit on its own. */
  const close = async () => {
    child.stdin.end();
    /** @type {NodeJS.Timeout|undefined} */
    let timer;
    const { code, signal } = /** @type {{code: number|null, signal: string|null}} */ (
      await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(() => resolve({ code: null, signal: 'timeout' }), EXIT_TIMEOUT_MS); })])
    );
    clearTimeout(timer);
    if (signal === 'timeout') child.kill('SIGKILL');
    assert.equal(signal, null, 'the server exits on its own when stdin closes');
    assert.equal(code, 0, io.stderr);
  };
  return { child, lines, io, request, toolResult, close };
}
