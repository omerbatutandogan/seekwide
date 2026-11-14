// What a crawl may start with: the arguments, checked, and the rule that a
// crawl of this machine is only for a host whose every address is loopback.

import net from 'node:net';

import { LIMITS } from '../config.js';
import { classifyAddress } from '../net/ip.js';
import { InputError } from '../util/errors.js';
import { neverContacted, offLimitsReason } from '../util/off-limits.js';
import { PLAIN_HOST_MESSAGE, hasPlainHost } from '../util/plain-host.js';
import { normalizeUrl, originOf } from '../util/url.js';
import { deployedOriginOf } from './deployed.js';

/** @typedef {(hostname: string, options: {all: true}) => Promise<{address: string, family: number}[]>} Lookup */

/**
 * `allowLoopback` is honoured only for a host whose every address is loopback.
 * @param {string} startUrl
 * @param {Lookup} lookup
 * @returns {Promise<void>}
 */
export async function checkLocalStart(startUrl, lookup) {
  const { hostname } = new URL(startUrl);
  const bare = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  let addresses;
  if (net.isIP(bare) !== 0) {
    addresses = [bare];
  } else {
    try {
      addresses = (await lookup(bare, { all: true })).map((entry) => entry.address);
    } catch (error) {
      throw new InputError(`allowLoopback is only for a site on this machine, and ${bare} could not be resolved (${String(/** @type {any} */ (error)?.code ?? error)}).`);
    }
  }
  const outside = addresses.filter((address) => classifyAddress(address) !== 'loopback');
  if (addresses.length === 0 || outside.length > 0) {
    throw new InputError(`allowLoopback is only for a site on this machine, but ${bare} resolves to ${outside.join(', ') || 'no address'}, which is not a loopback address. Leave allowLoopback off for this site.`);
  }
}

/**
 * @param {unknown} options
 * @returns {{startUrl: string, maxPages: number, ratePerSec: number, includeSubdomains: boolean, allowLoopback: boolean, deployedOrigin: string|null}}
 */
export function validateStart(options) {
  if (options === null || typeof options !== 'object') throw new TypeError('crawl start options must be an object with a url');
  const { url, maxPages = LIMITS.maxPagesDefault, ratePerSec = LIMITS.ratePerSecDefault } = /** @type {any} */ (options);
  const { includeSubdomains = false, allowLoopback = false, deployedUrl } = /** @type {any} */ (options);
  const startUrl = typeof url === 'string' ? normalizeUrl(url) : null;
  if (startUrl === null) {
    throw new InputError(`"${String(url)}" is not an http or https URL. Pass a full URL such as https://example.com/.`);
  }
  const offLimits = offLimitsReason(startUrl);
  if (offLimits !== null) throw new InputError(`${new URL(startUrl).hostname} cannot be audited: ${neverContacted(offLimits)}.`);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > LIMITS.maxPagesHardCap) {
    throw new InputError(`maxPages must be a whole number from 1 to ${LIMITS.maxPagesHardCap}.`);
  }
  if (typeof ratePerSec !== 'number' || !Number.isFinite(ratePerSec) || ratePerSec <= 0 || ratePerSec > LIMITS.ratePerSecMax) {
    throw new InputError(`ratePerSec must be a number above 0 and at most ${LIMITS.ratePerSecMax}.`);
  }
  if (typeof includeSubdomains !== 'boolean') throw new InputError('includeSubdomains must be true or false.');
  if (typeof allowLoopback !== 'boolean') throw new InputError('allowLoopback must be true or false.');
  /** @type {string|null} */
  let deployedOrigin = null;
  if (deployedUrl !== undefined && deployedUrl !== null && deployedUrl !== '') {
    if (!allowLoopback) throw new InputError('deployedUrl is for a crawl of a site on this machine (allowLoopback). A deployed site is crawled at its own address.');
    try {
      deployedOrigin = deployedOriginOf(deployedUrl);
    } catch (error) {
      // deployedOriginOf checks the address it is given; its TypeError is about that value.
      if (error instanceof TypeError) throw new InputError(error.message);
      throw error;
    }
    // The deployed address goes into fix instructions and suggested code: only a plain host name is accepted.
    if (!hasPlainHost(deployedOrigin)) throw new InputError(PLAIN_HOST_MESSAGE);
    // Naming the local server itself changes nothing.
    if (deployedOrigin === originOf(startUrl)) deployedOrigin = null;
  }
  return { startUrl, maxPages, ratePerSec, includeSubdomains, allowLoopback, deployedOrigin };
}
