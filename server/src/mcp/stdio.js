// A small Model Context Protocol server over stdio, written by hand so the
// plugin needs no MCP SDK. It follows specification revision 2026-07-28
// (stateless, per-request `_meta`, `server/discover`) and also serves the
// handshake-based revisions 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05
// after an `initialize` request ("dual-era" server).
//
// Framing: one JSON-RPC 2.0 message per line, UTF-8, no embedded newlines.
// stdout carries protocol messages only; diagnostics go to the log (stderr).

import { log } from '../log.js';
import { createLineSplitter } from './lines.js';
import {
  ERROR, LIST_TTL_MS, META_PROTOCOL_VERSION, META_SERVER_INFO, MODERN_VERSIONS, RpcError,
  errorResponse, isValidId, negotiateLegacyVersion, resolveEra,
} from './protocol.js';
import { createToolRegistry } from './registry.js';
import { isPlainObject } from './schema.js';

// Tools are defined against these two, so they are named here, next to the server.
export { ToolError } from './registry.js';
/** @typedef {import('./registry.js').ToolDef} ToolDef */

const KNOWN_METHODS = new Set(['ping', 'server/discover', 'tools/list', 'tools/call']);
const MAX_LINE_CHARS = 4 * 1024 * 1024;

/**
 * Create an MCP server that reads requests from `input` and writes responses to
 * `output` (stdin and stdout by default). Nothing but protocol messages is ever
 * written to `output`. Tool arguments are validated against each tool's
 * `inputSchema` before the handler runs.
 *
 * @param {{name: string, version: string, instructions?: string, tools: ToolDef[],
 *          input?: NodeJS.ReadableStream, output?: NodeJS.WritableStream}} options
 * @returns {{start(): void, close(): Promise<void>}}
 * @throws {TypeError} when a tool definition is invalid or uses an unsupported schema keyword.
 */
export function createStdioServer(options) {
  const { name, version, instructions } = options;
  const input = /** @type {NodeJS.ReadableStream} */ (options.input ?? process.stdin);
  const output = /** @type {NodeJS.WritableStream} */ (options.output ?? process.stdout);

  const tools = createToolRegistry(options.tools);

  const serverInfo = { name, version };
  /** Version negotiated by a legacy `initialize`; null until one arrives. */
  /** @type {string|null} */
  let legacyVersion = null;
  /** @type {Map<string, {cancelled: boolean, controller: AbortController}>} */
  const inFlight = new Map();
  /** @type {Set<Promise<void>>} */
  const pending = new Set();
  let started = false;
  /** @type {Promise<void>|null} */
  let closing = null;

  /** @param {unknown} message */
  function send(message) {
    const stream = /** @type {NodeJS.WritableStream & {destroyed?: boolean, writableEnded?: boolean}} */ (output);
    if (stream.destroyed || stream.writableEnded) return;
    stream.write(`${JSON.stringify(message)}\n`);
  }

  /** @param {string|number} id */
  const idKey = (id) => `${typeof id}:${id}`;

  /** @param {unknown} params */
  function initialize(params) {
    if (!isPlainObject(params) || typeof params.protocolVersion !== 'string') {
      throw new RpcError(ERROR.INVALID_PARAMS, 'Invalid params: initialize needs a string "protocolVersion".');
    }
    legacyVersion = negotiateLegacyVersion(params.protocolVersion);
    log.debug('legacy initialize', { requested: params.protocolVersion, negotiated: legacyVersion });
    return {
      protocolVersion: legacyVersion,
      capabilities: { tools: {} },
      serverInfo,
      ...(instructions ? { instructions } : {}),
    };
  }

  /**
   * @param {string} method
   * @param {unknown} params
   * @param {AbortSignal} signal  Fires when the client cancels the request.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function dispatch(method, params, signal) {
    if (method === 'initialize') return initialize(params);
    if (!KNOWN_METHODS.has(method)) throw new RpcError(ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`);

    const hasVersionMeta = isPlainObject(params) && isPlainObject(params._meta) && Object.hasOwn(params._meta, META_PROTOCOL_VERSION);
    // Legacy revisions allow ping before initialize.
    if (method === 'ping' && !hasVersionMeta && legacyVersion === null) return {};

    const era = resolveEra(params, legacyVersion);
    /** @type {Record<string, unknown>} */
    let body;
    let cacheable = false;
    if (method === 'ping') {
      body = {};
    } else if (method === 'server/discover') {
      body = { supportedVersions: [...MODERN_VERSIONS], capabilities: { tools: {} }, ...(instructions ? { instructions } : {}) };
      cacheable = true;
    } else if (method === 'tools/list') {
      body = { tools: tools.list(era) };
      cacheable = true;
    } else {
      body = await tools.call(params, signal);
    }
    if (era.kind === 'legacy') return body;
    return {
      resultType: 'complete',
      ...body,
      ...(cacheable ? { ttlMs: LIST_TTL_MS, cacheScope: 'public' } : {}),
      _meta: { [META_SERVER_INFO]: serverInfo },
    };
  }

  /** @param {Record<string, unknown>} message */
  function handleNotification(message) {
    if (message.method === 'notifications/cancelled' && isPlainObject(message.params) && isValidId(message.params.requestId)) {
      const state = inFlight.get(idKey(message.params.requestId));
      if (state) {
        state.cancelled = true;
        // The handler is told too, so that it stops its requests instead of finishing unseen.
        state.controller.abort(new Error('The client cancelled the request.'));
      }
      return;
    }
    log.debug('notification', { method: String(message.method) });
  }

  /**
   * @param {unknown} message
   * @returns {Promise<Record<string, unknown>|null>} The response, or null when none is due.
   */
  async function processMessage(message) {
    if (!isPlainObject(message)) return errorResponse(undefined, ERROR.INVALID_REQUEST, 'Invalid Request: a message must be a JSON object.');
    const hasId = Object.hasOwn(message, 'id');
    const id = isValidId(message.id) ? message.id : undefined;

    if (typeof message.method !== 'string') {
      // A response from the client; this server never sends requests, so there is nothing to match.
      if (Object.hasOwn(message, 'result') || Object.hasOwn(message, 'error')) return null;
      return errorResponse(id, ERROR.INVALID_REQUEST, 'Invalid Request: "method" must be a string.');
    }
    if (message.jsonrpc !== '2.0') {
      return hasId ? errorResponse(id, ERROR.INVALID_REQUEST, 'Invalid Request: "jsonrpc" must be "2.0".') : null;
    }
    if (!hasId) {
      handleNotification(message);
      return null;
    }
    if (id === undefined) return errorResponse(undefined, ERROR.INVALID_REQUEST, 'Invalid Request: "id" must be a string or an integer.');

    const state = { cancelled: false, controller: new AbortController() };
    inFlight.set(idKey(id), state);
    /** @type {Record<string, unknown>} */
    let response;
    try {
      response = { jsonrpc: '2.0', id, result: await dispatch(message.method, message.params, state.controller.signal) };
    } catch (error) {
      if (error instanceof RpcError) {
        response = errorResponse(id, error.code, error.message, error.data);
      } else {
        log.error('request failed', { method: message.method, error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
        response = errorResponse(id, ERROR.INTERNAL, 'Internal error');
      }
    } finally {
      inFlight.delete(idKey(id));
    }
    // A cancelled request gets no further messages.
    return state.cancelled ? null : response;
  }

  /** @param {string} line */
  function handleLine(line) {
    const text = line.trim();
    if (text === '') return;
    /** @type {unknown} */
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      send(errorResponse(undefined, ERROR.PARSE, 'Parse error: each line must be one JSON-RPC message.'));
      return;
    }
    /** @type {Promise<void>} */
    let work;
    if (Array.isArray(message)) {
      // JSON-RPC batches (used by revision 2025-03-26).
      if (message.length === 0) {
        send(errorResponse(undefined, ERROR.INVALID_REQUEST, 'Invalid Request: empty batch.'));
        return;
      }
      work = Promise.all(message.map(processMessage)).then((responses) => {
        const due = responses.filter((response) => response !== null);
        if (due.length > 0) send(due);
      });
    } else {
      work = processMessage(message).then((response) => {
        if (response !== null) send(response);
      });
    }
    const tracked = work.catch((error) => log.error('failed to answer a message', { error: String(error) }));
    pending.add(tracked);
    tracked.finally(() => pending.delete(tracked));
  }

  const lines = createLineSplitter(
    handleLine,
    () => send(errorResponse(undefined, ERROR.PARSE, 'Parse error: message too large.')),
    MAX_LINE_CHARS,
  );
  /** @param {Buffer|string} chunk */
  const onData = (chunk) => lines.push(chunk);

  function onEnd() {
    lines.end();
    void close();
  }

  /** @param {Error} error */
  function onError(error) {
    log.error('input stream failed', { error: error.message });
    void close();
  }

  function close() {
    if (closing) return closing;
    input.off('data', onData);
    input.off('end', onEnd);
    input.off('error', onError);
    closing = (async () => {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    })();
    return closing;
  }

  return {
    start() {
      if (started) return;
      started = true;
      input.on('data', onData);
      input.on('end', onEnd);
      input.on('error', onError);
    },
    close,
  };
}
