// Which hosts belong to the same site, as the security and media modules
// compare them: by the name a site registers, except under the domain of a
// hosting service, where each customer's host is a site of its own. Pure.

/** Second-level labels under which country domains register names (example.co.uk, example.com.tr). */
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'gob', 'nic', 'mil', 'ltd', 'plc', 'biz', 'info']);

/**
 * Domains under which a hosting service gives each customer a host of its own
 * (acme.vercel.app, acme.github.io), so that another host under the same
 * domain belongs to another customer. Taken from the private section of the
 * Public Suffix List (https://publicsuffix.org/list/public_suffix_list.dat,
 * read on 2026-11-12), where each of them is listed, limited to services that
 * host websites. Every entry has two labels. A hosting service that is not on
 * that list (wordpress.com, for one) is compared by its name like any site.
 */
export const SHARED_HOSTS = Object.freeze(new Set([
  'amplifyapp.com', 'appspot.com', 'azurewebsites.net', 'blogspot.com', 'carrd.co', 'cloudfront.net', 'deno.dev',
  'firebaseapp.com', 'fly.dev', 'framer.app', 'framer.website', 'github.io', 'gitlab.io', 'herokuapp.com', 'myshopify.com',
  'netlify.app', 'now.sh', 'onrender.com', 'pages.dev', 'repl.co', 'replit.app', 'surge.sh', 'vercel.app', 'web.app',
  'webflow.io', 'wixsite.com', 'wixstudio.io', 'workers.dev',
]));

/**
 * The name a site registers, which every host of the same organisation
 * shares: `acme` for acme.com, acme.de, cdn.acme.com and shop.acme.co.uk
 * (under the usual second-level endings of country domains). A customer's
 * host under a shared hosting domain (`SHARED_HOSTS`) is a name of its own,
 * returned whole with its subdomains folded in: `acme.vercel.app` for
 * acme.vercel.app and preview.acme.vercel.app, which never equals the name of
 * another customer, of the service's own site (vercel.com) or of any domain
 * outside it. Null for an address without a name (an IP address, localhost).
 * @param {string} host  A `hostKey`, possibly with a port.
 * @returns {string|null}
 */
export function siteLabel(host) {
  const name = host.replace(/:\d+$/, '').replace(/\.$/, '');
  if (/^[\d.]+$/.test(name) || name.startsWith('[')) return null;
  const labels = name.split('.');
  if (labels.length < 2) return null;
  if (labels.length >= 3 && SHARED_HOSTS.has(labels.slice(-2).join('.'))) return labels.slice(-3).join('.');
  const tld = /** @type {string} */ (labels.at(-1));
  const second = /** @type {string} */ (labels.at(-2));
  if (labels.length >= 3 && tld.length === 2 && SECOND_LEVEL.has(second)) return /** @type {string} */ (labels.at(-3));
  return second;
}
