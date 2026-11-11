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
  errorResponse, isValidId, negotiateLegacyVersion, resolveEra, supportsToolTitle,
} from './protocol.js';
import { assertSupportedSchema, isPlainObject, validate } from './schema.js';

/** @import { Era } from './protocol.js' */
/** @import { JsonSchema } from './schema.js' */

/**
 * @typedef {Object} ToolDef
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {JsonSchema & {type: 'object'}} inputSchema
 * @property {(args: Record<string, any>) => Promise<unknown>} handler
 */

/**
 * An error a tool handler throws on purpose. Its message reaches the client
 * unchanged, so it must say what was wrong and what to do next.
 */
export class ToolError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ToolError';
  }
}

const GENERIC_TOOL_ERROR =
  'The tool failed because of an internal error. The details were written to the server log. Try again; if it keeps failing, report the problem.';
const KNOWN_METHODS = new Set(['ping', 'server/discover', 'tools/list', 'tools/call']);
const MAX_LINE_CHARS = 4 * 1024 * 1024;

/** @param {string} text */
function toolErrorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

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

  /** @type {Map<string, ToolDef>} */
  const toolMap = new Map();
  for (const tool of options.tools) {
    if (typeof tool.name !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) {
      throw new TypeError(`Invalid tool name ${JSON.stringify(tool.name)}`);
    }
    if (toolMap.has(tool.name)) throw new TypeError(`Duplicate tool name ${tool.name}`);
    if (typeof tool.handler !== 'function') throw new TypeError(`Tool ${tool.name} has no handler`);
    assertSupportedSchema(tool.inputSchema, `${tool.name}.inputSchema`);
    if (tool.inputSchema.type !== 'object') throw new TypeError(`${tool.name}.inputSchema must have type "object"`);
    toolMap.set(tool.name, tool);
  }

  const serverInfo = { name, version };
  /** Version negotiated by a legacy `initialize`; null until one arrives. */
  /** @type {string|null} */
  let legacyVersion = null;
  /** @type {Map<string, {cancelled: boolean}>} */
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

  /** @param {Era} era */
  function listTools(era) {
    return [...toolMap.values()].map((tool) => ({
      name: tool.name,
      ...(supportsToolTitle(era) && tool.title ? { title: tool.title } : {}),
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /** @param {unknown} params */
  async function callTool(params) {
    if (!isPlainObject(params) || typeof params.name !== 'string') {
      throw new RpcError(ERROR.INVALID_PARAMS, 'Invalid params: tools/call needs a string "name".');
    }
    const tool = toolMap.get(params.name);
    if (!tool) {
      throw new RpcError(ERROR.INVALID_PARAMS, `Unknown tool: ${params.name}. Call tools/list to see the available tools.`);
    }
    const args = params.arguments === undefined ? {} : params.arguments;
    if (!isPlainObject(args)) throw new RpcError(ERROR.INVALID_PARAMS, 'Invalid params: "arguments" must be an object.');

    const problems = validate(tool.inputSchema, args);
    if (problems.length > 0) {
      return toolErrorResult(`Invalid arguments for ${tool.name}: ${problems.join('; ')}. Fix the arguments and call ${tool.name} again.`);
    }
    try {
      const value = await tool.handler(args);
      return { content: [{ type: 'text', text: JSON.stringify(value ?? null) }] };
    } catch (error) {
      if (error instanceof ToolError) return toolErrorResult(error.message);
      log.error('tool handler failed', { tool: tool.name, error: error instanceof Error ? (error.stack ?? error.message) : String(error) });
      return toolErrorResult(GENERIC_TOOL_ERROR);
    }
  }

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
   * @returns {Promise<Record<string, unknown>>}
   */
  async function dispatch(method, params) {
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
      body = { tools: listTools(era) };
      cacheable = true;
    } else {
      body = await callTool(params);
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
      if (state) state.cancelled = true;
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

    const state = { cancelled: false };
    inFlight.set(idKey(id), state);
    /** @type {Record<string, unknown>} */
    let response;
    try {
      response = { jsonrpc: '2.0', id, result: await dispatch(message.method, message.params) };
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
