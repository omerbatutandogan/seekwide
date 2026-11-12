// The tools an MCP server offers: their definitions, checked once, and how a
// call is validated and answered.

import { log } from '../log.js';
import { ERROR, RpcError, supportsToolTitle } from './protocol.js';
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

/** @param {string} text */
function toolErrorResult(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * The tool registry of one server.
 *
 * Guarantees: every definition is checked before the server starts (name,
 * handler, a supported `inputSchema` of type object, no duplicate names);
 * `call` validates the arguments against the tool's `inputSchema` before the
 * handler runs, sends a `ToolError`'s message unchanged and replaces any other
 * exception with a generic message, logging the detail.
 *
 * @param {ToolDef[]} tools
 * @throws {TypeError} when a tool definition is invalid or uses an unsupported schema keyword.
 */
export function createToolRegistry(tools) {
  /** @type {Map<string, ToolDef>} */
  const toolMap = new Map();
  for (const tool of tools) {
    if (typeof tool.name !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name)) {
      throw new TypeError(`Invalid tool name ${JSON.stringify(tool.name)}`);
    }
    if (toolMap.has(tool.name)) throw new TypeError(`Duplicate tool name ${tool.name}`);
    if (typeof tool.handler !== 'function') throw new TypeError(`Tool ${tool.name} has no handler`);
    assertSupportedSchema(tool.inputSchema, `${tool.name}.inputSchema`);
    if (tool.inputSchema.type !== 'object') throw new TypeError(`${tool.name}.inputSchema must have type "object"`);
    toolMap.set(tool.name, tool);
  }

  /** @param {Era} era */
  function list(era) {
    return [...toolMap.values()].map((tool) => ({
      name: tool.name,
      ...(supportsToolTitle(era) && tool.title ? { title: tool.title } : {}),
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  /** @param {unknown} params */
  async function call(params) {
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

  return { list, call };
}
