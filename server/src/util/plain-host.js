// Host names the plugin puts into its own sentences and into code it suggests.
//
// The URL parser accepts host names with characters such as ' ( ) , $ and _,
// and a deployed address (`site_url`) ends up in fix instructions and in code
// the model is told to write. Only the forms a public site's address has are
// accepted.

import net from 'node:net';

/** Why a deployed address with another host name is refused, in words a tool can return. */
export const PLAIN_HOST_MESSAGE =
  'The site_url host name may only contain letters, digits, hyphens and dots (an international name in its xn-- form), or be an IP address. Pass the address the site is deployed at, such as https://www.example.com.';

/**
 * Whether `hostname` (as `URL.hostname` gives it) is plain: labels of ASCII
 * letters, digits and hyphens separated by dots (an international name is
 * accepted in its punycode form, which `URL` produces), an IPv4 address, or an
 * IPv6 address in brackets.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isPlainHostName(hostname) {
  if (hostname.startsWith('[')) return hostname.endsWith(']') && net.isIPv6(hostname.slice(1, -1));
  return hostname.length > 0 && hostname.length <= 253 && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.?$/i.test(hostname);
}

/**
 * Whether `url` is an http(s) URL whose host name is plain (`isPlainHostName`).
 * @param {string} url
 * @returns {boolean}
 */
export function hasPlainHost(url) {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && isPlainHostName(parsed.hostname);
  } catch {
    return false;
  }
}
