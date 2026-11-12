// Public suffixes: the endings under which anyone can register a name of
// their own (com, co.uk, gen.tr), including the domains of hosting services
// that give each customer a host of its own (vercel.app, github.io). Read from
// the compact copy of the Public Suffix List in server/data/public-suffixes.txt
// (written by scripts/gen-public-suffixes.js), loaded once, on first use.

import { readFileSync } from 'node:fs';

const DATA = new URL('../../data/public-suffixes.txt', import.meta.url);

/**
 * Hosting services that give each customer a host of its own under their
 * domain but are not on the Public Suffix List (VERSION 2026-11-12_16-18-22_UTC
 * has none of them), so that the list alone would make every customer's site
 * one organisation with every other: acme.wordpress.com and
 * spam.wordpress.com. Each is treated as a public suffix of the list's
 * private section. Only services whose own pages say so were added, read on
 * 2026-11-12:
 * - wordpress.com: "your site includes a .wordpress.com address"
 *   (https://wordpress.com/support/domains/);
 * - neocities.org: the sign-up form names a site `<username>.neocities.org`
 *   (https://neocities.org/);
 * - ghost.io: "The ghost.io subdomain (e.g. yoursite.ghost.io)"
 *   (https://ghost.org/help/change-ghost-io-subdomain/).
 * Others of the kind (tumblr.com, substack.com, weebly.com, squarespace.com,
 * medium.com) are not on the list either, but their pages refused a script
 * or did not say it, so they are not added. Blogger's country domains
 * (blogspot.co.uk) are not on the list any more; blogspot.com is.
 */
export const TENANT_DOMAINS = Object.freeze(['wordpress.com', 'neocities.org', 'ghost.io']);

/** The longest DNS name, in characters (RFC 1035; 253 without the trailing dot). */
const MAX_NAME = 253;

/**
 * @typedef {Object} SuffixRules
 * @property {Set<string>} rules       Plain rules (`co.uk`).
 * @property {Set<string>} wildcards   The part after `*.` of a wildcard rule (`ck` for `*.ck`).
 * @property {Set<string>} exceptions  The part after `!` of an exception rule (`www.ck`).
 * @property {string} version          The list's VERSION line.
 */

/** @type {SuffixRules|null} */
let loaded = null;

/**
 * Parse the compact file (its format is described in its header).
 * @param {string} text
 * @returns {SuffixRules}
 */
export function parseSuffixRules(text) {
  /** @type {SuffixRules} */
  const parsed = { rules: new Set(), wildcards: new Set(), exceptions: new Set(), version: '' };
  for (const line of text.split('\n')) {
    if (line.startsWith('# VERSION: ')) parsed.version = line.slice(11).trim();
    if (line === '' || line.startsWith('#')) continue;
    const colon = line.indexOf(':');
    const top = line.slice(0, colon);
    for (const rest of line.slice(colon + 1).split(',')) {
      const exception = rest.startsWith('!');
      const name = (exception ? rest.slice(1) : rest) === '' ? top : `${exception ? rest.slice(1) : rest}.${top}`;
      if (exception) parsed.exceptions.add(name);
      else if (name.startsWith('*.')) parsed.wildcards.add(name.slice(2));
      else parsed.rules.add(name);
    }
  }
  for (const domain of TENANT_DOMAINS) parsed.rules.add(domain);
  return parsed;
}

/** @returns {SuffixRules} */
export function suffixRules() {
  loaded ??= parseSuffixRules(readFileSync(DATA, 'utf8'));
  return loaded;
}

/**
 * The public suffix of a host name, by the list's own algorithm
 * (https://github.com/publicsuffix/list/wiki/Format): an exception rule wins,
 * then the matching rule with the most labels; with no match, the last label.
 * @param {string} name  A host name in lower-case ASCII, without a port or a trailing dot.
 * @returns {string}
 */
export function publicSuffix(name) {
  const { rules, wildcards, exceptions } = suffixRules();
  const labels = name.split('.');
  // A DNS name has at most 253 characters; a longer one is no name, and reading it would cost time in its labels squared.
  if (name.length > MAX_NAME) return /** @type {string} */ (labels.at(-1));
  /** Each ending of the name, longest first: `a.b.c`, `b.c`, `c`. */
  const endings = labels.map((_, i) => labels.slice(i).join('.'));
  for (let i = 0; i < endings.length; i += 1) {
    if (exceptions.has(endings[i])) return endings[i + 1] ?? endings[i];
  }
  for (let i = 0; i < endings.length; i += 1) {
    if (rules.has(endings[i]) || (i + 1 < endings.length && wildcards.has(endings[i + 1]))) return endings[i];
  }
  return /** @type {string} */ (endings.at(-1));
}

/**
 * The name registered under a public suffix: the suffix and one label more
 * (`acme.co.uk` for shop.acme.co.uk, `acme.vercel.app` for
 * preview.acme.vercel.app). Null for a name that is itself a public suffix,
 * has one label, is an IP address, or is longer than a DNS name can be.
 * @param {string} name  A host name in lower-case ASCII, without a port or a trailing dot.
 * @returns {string|null}
 */
export function registrableDomain(name) {
  if (name === '' || name.length > MAX_NAME || !name.includes('.') || /^[\d.]+$/.test(name) || name.includes(':') || name.startsWith('[')) return null;
  const suffix = publicSuffix(name);
  if (suffix === name) return null;
  const rest = name.slice(0, name.length - suffix.length - 1);
  return `${rest.slice(rest.lastIndexOf('.') + 1)}.${suffix}`;
}
