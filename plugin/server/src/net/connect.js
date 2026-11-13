// Address checks and error mapping for safe-fetch: resolving a host, refusing
// non-public addresses, pinning the socket to the checked address, and turning
// low-level errors into FetchError codes.

import dns from 'node:dns';
import net from 'node:net';

import { classifyAddress, isPermittedClass } from './ip.js';

/** @import { FetchError } from '../types.js' */

/** Lookup failures that mean the name does not exist. Every other lookup failure may be temporary. */
const DNS_MISSING_CODES = new Set(['ENOTFOUND', 'ENODATA']);
const DNS_TEMPORARY_CODES = new Set(['EAI_AGAIN', 'EAI_FAIL', 'EAI_NODATA', 'EAI_NONAME', 'ESERVFAIL', 'ETIMEOUT', 'EREFUSED', 'ENONAME']);
const TLS_ERROR_CODES = new Set([
  'EPROTO', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID',
]);

/** @typedef {{address: string, family: number}} CheckedAddress */

/** A network failure with its `FetchError` code. */
export class FetchFailure extends Error {
  /**
   * @param {FetchError['code']} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * A `lookup` function for `http.request` that answers only with addresses that
 * were already checked, whatever host name it is asked about. This pins the
 * connection to the checked address, so a second DNS answer cannot change it.
 * @param {CheckedAddress[]} addresses Non-empty list of checked addresses.
 * @returns {(hostname: string, options: {all?: boolean}, callback: Function) => void}
 */
export function pinnedLookup(addresses) {
  return (_hostname, options, callback) => {
    if (options && options.all) callback(null, addresses.map((a) => ({ ...a })));
    else callback(null, addresses[0].address, addresses[0].family);
  };
}

/**
 * Resolve a URL's host and check every address against the policy.
 * @param {URL} url
 * @param {boolean} allowLoopback
 * @returns {Promise<CheckedAddress[]>}
 */
export async function resolveAndCheck(url, allowLoopback) {
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  /** @type {CheckedAddress[]} */
  let addresses;
  const family = net.isIP(host);
  if (family !== 0) {
    addresses = [{ address: host, family }];
  } else {
    try {
      addresses = await dns.promises.lookup(host, { all: true });
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code ?? 'unknown';
      if (DNS_MISSING_CODES.has(code)) throw new FetchFailure('dns_error', `${host} does not exist (${code})`);
      throw new FetchFailure('dns_temporary', `Could not resolve ${host} right now (${code})`);
    }
    if (addresses.length === 0) throw new FetchFailure('dns_error', `No addresses found for ${host}`);
  }
  for (const { address } of addresses) {
    const cls = classifyAddress(address);
    if (!isPermittedClass(cls, allowLoopback)) {
      throw new FetchFailure('blocked_address', `Refused to connect to ${host}: ${address} is a ${cls.replace('_', '-')} address, not a public one`);
    }
  }
  return addresses;
}

/**
 * @param {unknown} error
 * @returns {FetchFailure}
 */
export function toFailure(error) {
  if (error instanceof FetchFailure) return error;
  const err = /** @type {NodeJS.ErrnoException} */ (error);
  const code = err?.code ?? '';
  const message = err?.message ?? String(error);
  if (DNS_MISSING_CODES.has(code)) return new FetchFailure('dns_error', message);
  if (DNS_TEMPORARY_CODES.has(code)) return new FetchFailure('dns_temporary', message);
  if (TLS_ERROR_CODES.has(code) || code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || code.startsWith('CERT_')) {
    return new FetchFailure('tls_error', message);
  }
  return new FetchFailure('connection_error', message);
}
