// Protocol constants and the per-request era decision for a dual-era MCP
// server (specification revision 2026-07-28, "Versioning and Compatibility").
//
// Modern revisions carry the protocol version and client capabilities in every
// request's `_meta`; there is no handshake. Legacy revisions open with an
// `initialize` request that fixes the version for the whole stdio process.

import { isPlainObject } from './schema.js';

/** Revisions served statelessly through per-request `_meta`, newest first. */
export const MODERN_VERSIONS = Object.freeze(['2026-07-28']);

/** Revisions served after an `initialize` handshake, newest first. */
export const LEGACY_VERSIONS = Object.freeze(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);

export const META_PROTOCOL_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT_CAPABILITIES = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVER_INFO = 'io.modelcontextprotocol/serverInfo';

export const ERROR = Object.freeze({
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  UNSUPPORTED_PROTOCOL_VERSION: -32022,
});

/** Tool definitions do not change while the process runs; clients may cache the list for an hour. */
export const LIST_TTL_MS = 3_600_000;

/**
 * A JSON-RPC error that the dispatcher sends back as an error response.
 */
export class RpcError extends Error {
  /**
   * @param {number} code
   * @param {string} message
   * @param {unknown} [data]
   */
  constructor(code, message, data) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

/**
 * @param {unknown} id
 * @returns {id is string|number}
 */
export function isValidId(id) {
  return typeof id === 'string' || Number.isInteger(id);
}

/**
 * A JSON-RPC error response. The id is left out when the request id could not
 * be read (parse errors, invalid requests), as the MCP schema allows.
 * @param {string|number|undefined} id
 * @param {number} code
 * @param {string} message
 * @param {unknown} [data]
 */
export function errorResponse(id, code, message, data) {
  /** @type {Record<string, unknown>} */
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return id === undefined ? { jsonrpc: '2.0', error } : { jsonrpc: '2.0', id, error };
}

/**
 * Version a legacy `initialize` answers with: the requested one when it is a
 * supported legacy revision, otherwise the newest legacy revision (2025-11-25
 * lifecycle, "Version Negotiation").
 * @param {unknown} requested
 * @returns {string}
 */
export function negotiateLegacyVersion(requested) {
  return typeof requested === 'string' && LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
}

/**
 * @typedef {{kind: 'modern', version: string} | {kind: 'legacy', version: string}} Era
 */

/**
 * Decide how to serve one request.
 *
 * - A request whose `_meta` names a protocol version is served under the modern
 *   rules, whatever happened before on the connection. An unsupported version is
 *   an UnsupportedProtocolVersionError; a missing client-capabilities field is
 *   Invalid params.
 * - Otherwise, after a legacy `initialize`, the negotiated legacy version applies.
 * - Otherwise the request lacks the required `_meta` fields and is malformed.
 *
 * @param {unknown} params
 * @param {string|null} legacyVersion  Version negotiated by `initialize`, or null.
 * @returns {Era}
 * @throws {RpcError}
 */
export function resolveEra(params, legacyVersion) {
  const meta = isPlainObject(params) && isPlainObject(params._meta) ? params._meta : null;
  if (meta !== null && Object.hasOwn(meta, META_PROTOCOL_VERSION)) {
    const requested = meta[META_PROTOCOL_VERSION];
    if (typeof requested !== 'string' || !MODERN_VERSIONS.includes(requested)) {
      throw new RpcError(ERROR.UNSUPPORTED_PROTOCOL_VERSION, 'Unsupported protocol version', {
        supported: [...MODERN_VERSIONS],
        requested: typeof requested === 'string' ? requested : String(requested),
      });
    }
    if (!isPlainObject(meta[META_CLIENT_CAPABILITIES])) {
      throw new RpcError(ERROR.INVALID_PARAMS, `Invalid params: _meta must include "${META_CLIENT_CAPABILITIES}" as an object.`);
    }
    return { kind: 'modern', version: requested };
  }
  if (legacyVersion !== null) return { kind: 'legacy', version: legacyVersion };
  throw new RpcError(
    ERROR.INVALID_PARAMS,
    `Invalid params: missing _meta "${META_PROTOCOL_VERSION}". Send the per-request _meta fields ` +
      `(protocol ${MODERN_VERSIONS.join(', ')}) or call initialize first (protocol ${LEGACY_VERSIONS.join(', ')}).`,
  );
}

/**
 * Whether tool definitions may carry `title` (added in revision 2025-06-18).
 * @param {Era} era
 */
export function supportsToolTitle(era) {
  return era.kind === 'modern' || era.version >= '2025-06-18';
}
