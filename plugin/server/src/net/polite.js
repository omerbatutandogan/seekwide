// The polite request layer that every part of the plugin which sends requests
// to websites shares: the crawler, the external link check and the image check.
//
// - One gate per host for the whole process. Requests to a host go out one at a
//   time, whichever crawl or audit sends them, and a requester whose request
//   follows another requester's waits until that request is the host's delay
//   old. Parallel audit_run calls therefore cannot multiply the rate a host
//   sees. Each requester keeps its own pacing between its own requests.
// - One redirect follower: one request per hop, so pacing applies to each, with
//   each caller's own limits and checks.
// - Cancellation: a requester passes an AbortSignal, and no request starts
//   after it fires.

/** @import { FetchResult, RedirectHop } from '../types.js' */

import { NOT_REQUESTED, offLimitsReason } from '../util/off-limits.js';
import { normalizeUrl } from '../util/url.js';

export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** A gate idle for longer than this, with no request waiting, is forgotten (longer than any crawl-delay the plugin honors). */
const GATE_IDLE_MS = 60_000;
/** Gates are pruned once there are more than this many. */
const PRUNE_ABOVE = 256;

/**
 * Wait `ms` milliseconds. Rejects with the signal's reason as soon as `signal`
 * fires, and at once when it has fired already.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The host name requests to `url` are paced by; '' for an invalid URL.
 * @param {string} url
 * @returns {string}
 */
export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * The target of a `Location` header, normalized as the crawler stores URLs
 * (`normalizeUrl`); null when it is missing or not an http(s) URL.
 * @param {string|undefined} location
 * @param {string} base
 * @returns {string|null}
 */
export function normalizedTarget(location, base) {
  return location === undefined ? null : normalizeUrl(location, base);
}

/**
 * The target of a `Location` header as written, made absolute, without
 * fragment or credentials; null when it is missing or not an http(s) URL.
 * @param {string|undefined} location
 * @param {string} base
 * @returns {string|null}
 */
export function rawTarget(location, base) {
  if (location === undefined) return null;
  try {
    const target = new URL(location, base);
    if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
    target.hash = '';
    target.username = '';
    target.password = '';
    return target.href;
  } catch {
    return null;
  }
}

/**
 * @typedef {Object} HostGates
 * @property {<T>(host: string, options: {owner: symbol, gapMs: number, sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
 *   signal?: AbortSignal}, task: () => Promise<T|null>) => Promise<T|null>} through
 *   Run `task`, one request to `host`, when the host is free. `task` returns null when it sent nothing.
 */

/**
 * A set of host gates. The plugin uses one for the whole process
 * (`SHARED_HOST_GATES`); a test makes its own so that its waits are its own.
 *
 * Guarantees: tasks for one host run one at a time, in the order they were
 * given; before a task whose requester (`owner`) is not the one that sent the
 * host's last request, it waits until that request ended `gapMs` ago, or the
 * last requester's own gap when that is longer. No task starts after `signal`
 * fired: the call rejects with its reason instead.
 * @param {{now?: () => number}} [options]  The clock, in milliseconds.
 * @returns {HostGates}
 */
export function createHostGates({ now = () => performance.now() } = {}) {
  /** @type {Map<string, {tail: Promise<void>, waiting: number, owner: symbol|null, lastEnd: number, lastGap: number}>} */
  const gates = new Map();
  const prune = () => {
    const before = now() - GATE_IDLE_MS;
    for (const [host, gate] of gates) if (gate.waiting === 0 && gate.lastEnd < before) gates.delete(host);
  };
  return {
    through(host, { owner, gapMs, sleep: wait, signal }, task) {
      if (gates.size > PRUNE_ABOVE) prune();
      let gate = gates.get(host);
      if (!gate) {
        gate = { tail: Promise.resolve(), waiting: 0, owner: null, lastEnd: -Infinity, lastGap: 0 };
        gates.set(host, gate);
      }
      const own = gate;
      own.waiting += 1;
      const run = own.tail.then(async () => {
        signal?.throwIfAborted();
        if (own.owner !== null && own.owner !== owner) {
          const rest = own.lastEnd + Math.max(gapMs, own.lastGap) - now();
          if (rest > 0) await wait(Math.ceil(rest), signal);
          signal?.throwIfAborted();
        }
        const result = await task();
        if (result !== null) {
          own.owner = owner;
          own.lastEnd = now();
          own.lastGap = gapMs;
        }
        return result;
      });
      own.tail = run.then(() => {}, () => {}).then(() => {
        own.waiting -= 1;
      });
      return run;
    },
  };
}

/** The host gates of this process: every crawl and audit goes through them. */
export const SHARED_HOST_GATES = createHostGates();

/**
 * A requester's pacing: its requests to one host go out one at a time and,
 * after its first, `delayMs(host)` apart (a full wait after its previous
 * request to that host ended), and all of them pass the host's gate, which
 * spaces them from other requesters' requests.
 *
 * Guarantees: as `createHostGates`; a task that returns null sent nothing and
 * does not count as the requester's request; nothing starts after `signal`
 * fired, and a wait in progress ends then.
 * @param {{delayMs: (host: string) => number, sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, signal?: AbortSignal,
 *          hosts?: HostGates}} options
 * @returns {<T>(url: string, task: () => Promise<T|null>) => Promise<T|null>}
 */
export function createPacer({ delayMs, sleep: wait = sleep, signal, hosts = SHARED_HOST_GATES }) {
  const owner = Symbol('requester');
  /** @type {Map<string, {tail: Promise<unknown>, used: boolean}>} */
  const own = new Map();
  return (url, task) => {
    const host = hostOf(url);
    let state = own.get(host);
    if (!state) {
      state = { tail: Promise.resolve(), used: false };
      own.set(host, state);
    }
    const mine = state;
    const run = mine.tail.then(async () => {
      signal?.throwIfAborted();
      const gapMs = delayMs(host);
      if (mine.used && gapMs > 0) await wait(gapMs, signal);
      const result = await hosts.through(host, { owner, gapMs, sleep: wait, signal }, task);
      if (result !== null) mine.used = true;
      return result;
    });
    mine.tail = run.catch(() => undefined);
    return run;
  };
}

/**
 * @template S
 * @typedef {{kind: 'response', url: string, result: FetchResult, hops: RedirectHop[]}
 *   | {kind: 'invalid'|'loop'|'too_many', url: string, target: string|null, result: FetchResult, hops: RedirectHop[]}
 *   | {kind: 'stopped', url: string, value: S, hops: RedirectHop[]}
 *   | {kind: 'unsent', url: string, hops: RedirectHop[]}} RedirectOutcome
 *   `url` is the last URL the chain reached; `hops` the redirects answered on the way, in order.
 */

/**
 * Follow redirects by hand, one request per hop.
 *
 * Guarantees: `before` is asked about every URL before it is requested (hop 0
 * is the first URL), and a value other than undefined ends the chain there
 * ('stopped'); `request` sends one request without following redirects, or
 * returns null when it sent nothing ('unsent'). A failed request or an answer
 * that is not a redirect (301, 302, 303, 307, 308) ends the chain
 * ('response'). A redirect whose target `resolve` cannot make out is
 * 'invalid', one to a URL the chain has seen is 'loop', and redirect number
 * `maxHops + 1` is 'too_many'; none of those targets is requested.
 * @template S
 * @param {string} url
 * @param {{maxHops: number, request: (url: string, hop: number) => Promise<FetchResult|null>,
 *          resolve?: (location: string|undefined, base: string) => string|null,
 *          before?: (url: string, hop: number) => Promise<S|undefined>|S|undefined}} policy
 * @returns {Promise<RedirectOutcome<S>>}
 */
export async function followRedirects(url, { maxHops, request, resolve = normalizedTarget, before }) {
  /** @type {RedirectHop[]} */
  const hops = [];
  const seen = new Set([url]);
  let current = url;
  for (;;) {
    if (before !== undefined) {
      const value = await before(current, hops.length);
      if (value !== undefined) return { kind: 'stopped', url: current, value, hops };
    }
    const result = await request(current, hops.length);
    if (result === null) return { kind: 'unsent', url: current, hops };
    if (result.error !== null || !REDIRECT_STATUSES.has(result.status)) return { kind: 'response', url: current, result, hops };
    const target = resolve(result.headers.location, current);
    hops.push({ url: current, status: result.status, location: target });
    if (target === null) return { kind: 'invalid', url: current, target, result, hops };
    if (seen.has(target)) return { kind: 'loop', url: current, target, result, hops };
    if (hops.length > maxHops) return { kind: 'too_many', url: current, target, result, hops };
    seen.add(target);
    current = target;
  }
}

/**
 * The answer a request to Google Play or a social platform gets without being
 * sent: a failed fetch with `blocked_address` and the rule in its message.
 * Null for any other URL.
 * @param {string} url
 * @returns {FetchResult|null}
 */
export function offLimitsRefusal(url) {
  const reason = offLimitsReason(url);
  if (reason === null) return null;
  return {
    url, finalUrl: url, status: 0, headers: {}, headerLines: {}, redirectChain: [], body: null, truncated: false, bytes: 0, elapsedMs: 0,
    error: { code: 'blocked_address', message: NOT_REQUESTED[reason] },
  };
}

/** @type {WeakMap<Function, Function>} */
const guarded = new WeakMap();

/**
 * A fetch that never sends a request to Google Play or a social platform:
 * such a URL gets `offLimitsRefusal` and `fetch` is not called. Every
 * requester wraps the fetch it was given (the crawler, the link check, the
 * image check, the app files), so robots.txt and every redirect hop they send
 * pass here too, whatever fetch a caller or a test injects; `safeFetch` refuses
 * the same URLs on its own redirects. The wrapper of one fetch is always the
 * same function, so the robots.txt cache, which is keyed by the fetch, is
 * still shared between requesters.
 * @template {(url: string, options?: any) => Promise<FetchResult>} F
 * @param {F} fetch
 * @returns {F}
 */
export function guardFetch(fetch) {
  const known = guarded.get(fetch);
  if (known) return /** @type {F} */ (known);
  const wrapper = /** @type {F} */ (/** @type {unknown} */ (async (/** @type {string} */ url, /** @type {any} */ options) => offLimitsRefusal(url) ?? fetch(url, options)));
  guarded.set(fetch, wrapper);
  guarded.set(wrapper, wrapper);
  return wrapper;
}
