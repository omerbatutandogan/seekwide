// Classification of IP addresses for the private-network guard in safe-fetch.
// Pure functions; no I/O.

import net from 'node:net';

/** @typedef {'public'|'loopback'|'private'|'link_local'|'cgnat'|'unspecified'|'multicast'|'reserved'} AddressClass */

// IPv4 ranges that are not public, as [base address, prefix length, class].
// Checked in order; the first match wins.
/** @type {[string, number, AddressClass][]} */
const IPV4_RANGES = [
  ['0.0.0.0', 32, 'unspecified'],
  ['0.0.0.0', 8, 'reserved'], // "this network"
  ['10.0.0.0', 8, 'private'],
  ['100.64.0.0', 10, 'cgnat'],
  ['127.0.0.0', 8, 'loopback'],
  ['169.254.0.0', 16, 'link_local'],
  ['172.16.0.0', 12, 'private'],
  ['192.0.0.0', 24, 'reserved'], // IETF protocol assignments
  ['192.0.2.0', 24, 'reserved'], // TEST-NET-1 (documentation)
  ['192.88.99.0', 24, 'reserved'], // 6to4 relay anycast (deprecated)
  ['192.168.0.0', 16, 'private'],
  ['198.18.0.0', 15, 'reserved'], // benchmarking
  ['198.51.100.0', 24, 'reserved'], // TEST-NET-2
  ['203.0.113.0', 24, 'reserved'], // TEST-NET-3
  ['224.0.0.0', 4, 'multicast'],
  ['240.0.0.0', 4, 'reserved'], // future use, includes broadcast 255.255.255.255
];

/**
 * @param {string} ip Dotted-quad IPv4 address.
 * @returns {number} The address as an unsigned 32-bit number.
 */
function ipv4ToNumber(ip) {
  return ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
}

const IPV4_TABLE = IPV4_RANGES.map(([base, prefix, cls]) => ({
  base: ipv4ToNumber(base),
  size: 2 ** (32 - prefix),
  cls,
}));

/**
 * @param {number} value Unsigned 32-bit IPv4 address.
 * @returns {AddressClass}
 */
function classifyIpv4Number(value) {
  for (const { base, size, cls } of IPV4_TABLE) {
    if (value >= base && value < base + size) return cls;
  }
  return 'public';
}

/**
 * Parse an IPv6 address (with optional embedded dotted quad) into 8 hextets.
 * @param {string} ip A string for which `net.isIPv6` is true.
 * @returns {number[]}
 */
function parseIpv6(ip) {
  let text = ip;
  const lastColon = text.lastIndexOf(':');
  const lastPart = text.slice(lastColon + 1);
  if (lastPart.includes('.')) {
    const v4 = ipv4ToNumber(lastPart);
    text = `${text.slice(0, lastColon + 1)}${Math.floor(v4 / 65536).toString(16)}:${(v4 % 65536).toString(16)}`;
  }
  const [head, rest] = text.includes('::') ? text.split('::') : [text, null];
  const toNums = (/** @type {string} */ s) => (s === '' ? [] : s.split(':').map((h) => parseInt(h, 16)));
  const headNums = toNums(head);
  const restNums = rest === null ? [] : toNums(rest);
  const zeros = rest === null ? [] : new Array(8 - headNums.length - restNums.length).fill(0);
  return [...headNums, ...zeros, ...restNums];
}

/**
 * @param {number[]} h Eight hextets.
 * @param {number} index Index of the hextet holding the high half of the IPv4 address.
 * @returns {number}
 */
function embeddedIpv4(h, index) {
  return h[index] * 65536 + h[index + 1];
}

/**
 * Class of an IPv4 address carried inside a NAT64 or 6to4 address.
 * @param {AddressClass} cls
 * @returns {AddressClass}
 */
function translated(cls) {
  return cls === 'loopback' ? 'reserved' : cls;
}

/**
 * @param {number[]} h Eight hextets.
 * @returns {AddressClass}
 */
function classifyIpv6Hextets(h) {
  const allZeroUntil = (/** @type {number} */ n) => h.slice(0, n).every((x) => x === 0);

  if (allZeroUntil(8)) return 'unspecified';
  if (allZeroUntil(7) && h[7] === 1) return 'loopback';
  // ::ffff:0:0/96 IPv4-mapped: judged by the IPv4 address it carries.
  if (allZeroUntil(5) && h[5] === 0xffff) return classifyIpv4Number(embeddedIpv4(h, 6));
  // ::/96 IPv4-compatible (deprecated) and ::ffff:0:0:0/96 IPv4-translated.
  if (allZeroUntil(6)) return 'reserved';
  if (allZeroUntil(4) && h[4] === 0xffff && h[5] === 0) return 'reserved';
  // 64:ff9b::/96 NAT64 and 2002::/16 6to4: judged by the IPv4 address they carry,
  // except that 127/8 inside them is not this machine, so it is 'reserved'.
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0)) {
    return translated(classifyIpv4Number(embeddedIpv4(h, 6)));
  }
  if (h[0] === 0x2002) return translated(classifyIpv4Number(embeddedIpv4(h, 1)));

  const first = h[0];
  if ((first & 0xff00) === 0xff00) return 'multicast'; // ff00::/8
  if ((first & 0xffc0) === 0xfe80) return 'link_local'; // fe80::/10
  if ((first & 0xffc0) === 0xfec0) return 'private'; // fec0::/10 site-local (deprecated)
  if ((first & 0xfe00) === 0xfc00) return 'private'; // fc00::/7 unique local
  if (first === 0x2001 && h[1] === 0x0db8) return 'reserved'; // 2001:db8::/32 documentation
  if (first === 0x2001 && h[1] < 0x0200) return 'reserved'; // 2001::/23 IETF assignments, Teredo, benchmarking
  if ((first & 0xfff0) === 0x3ff0) return 'reserved'; // 3fff::/20 documentation
  if (first === 0x5f00) return 'reserved'; // 5f00::/16 SRv6 SIDs
  if ((first & 0xe000) !== 0x2000) return 'reserved'; // outside 2000::/3 global unicast
  return 'public';
}

/**
 * Classify an IP address for the private-network guard.
 *
 * Guarantees: only globally routable unicast addresses are 'public'.
 * IPv4-mapped (::ffff:a.b.c.d), NAT64 (64:ff9b::/96) and 6to4 (2002::/16)
 * IPv6 addresses are judged by the IPv4 address they carry, except that a
 * NAT64 or 6to4 form of 127/8 is 'reserved' (it never reaches this machine). Brackets and
 * IPv6 zone ids are ignored. Anything that is not a valid IP address is 'reserved'.
 *
 * @param {string} ip
 * @returns {AddressClass}
 */
export function classifyAddress(ip) {
  if (typeof ip !== 'string') return 'reserved';
  let text = ip.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);

  if (net.isIPv4(text)) return classifyIpv4Number(ipv4ToNumber(text));
  if (net.isIPv6(text)) return classifyIpv6Hextets(parseIpv6(text.toLowerCase()));
  return 'reserved';
}

/**
 * True when a request to an address of this class is permitted.
 * @param {AddressClass} cls
 * @param {boolean} allowLoopback
 * @returns {boolean}
 */
export function isPermittedClass(cls, allowLoopback) {
  return cls === 'public' || (allowLoopback && cls === 'loopback');
}
