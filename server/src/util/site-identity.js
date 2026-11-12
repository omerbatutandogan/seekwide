// Which hosts are the audited site: the one place where the crawler, the
// extractor, the checks and the tools ask it. Four questions, each with one
// answer per crawl (`siteIdentity`):
//
// - internal: a URL the crawl treats as the site's own page (www and port
//   rules, subdomains when asked);
// - same organisation: a host the site's owner holds (its registered domain,
//   from the Public Suffix List, or a sibling ending the site links to);
// - deployed: in a crawl of a local server, the address the project is deployed at;
// - public: a host that can be a public site, which may be named to an outside service.
//
// Pure, except that the Public Suffix List is read from disk once.

/** @import { CrawlResult } from '../types.js' */

import net from 'node:net';

import { classifyAddress } from '../net/ip.js';
import { registrableDomain } from './public-suffix.js';

/**
 * Split a `URL.host` value into its name and its port ('' when there is none).
 * @param {string} host  For example "example.com", "localhost:3000" or "[::1]:8080".
 * @returns {{name: string, port: string}}
 */
function splitHost(host) {
  const match = /^(.*?)(?::(\d+))?$/.exec(host.toLowerCase());
  return { name: match?.[1] ?? '', port: match?.[2] ?? '' };
}

/**
 * Key used to decide whether two URLs belong to the same site: the host in
 * lower case without a leading "www.", plus the port when the URL names one.
 *
 * `URL.host` leaves out the default port of its scheme, so http and https on
 * their default ports share a key, while another port is another site.
 * @param {string} host  A `URL.host` value (a bare host name works too).
 * @returns {string}
 */
export function hostKey(host) {
  const { name, port } = splitHost(host);
  const bare = name.startsWith('www.') ? name.slice(4) : name;
  return port === '' ? bare : `${bare}:${port}`;
}

/**
 * The name of a host whatever the scheme or port: lower case, without the
 * port, one trailing dot (`example.com.` is the fully qualified form of
 * example.com) or a leading "www.".
 * @param {string} host  A `URL.host` value or a bare host name.
 * @returns {string}
 */
export function hostName(host) {
  const name = splitHost(host).name.replace(/\.$/, '');
  return name.startsWith('www.') ? name.slice(4) : name;
}

/**
 * @param {string} url
 * @returns {string|null} The URL's `host`, or null when it is not a URL.
 */
function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * True when `url` belongs to the audited site: the same host (ignoring a
 * leading "www.") on the same port. The scheme does not matter, so the http
 * and https versions of a site are one site. A different port is a different
 * service and counts as external, and so does the host written with a
 * trailing dot: the crawl would read it as a second copy of every page.
 * @param {string} url Absolute URL.
 * @param {string} siteHost `URL.host` of the audited site (with its port when not the default).
 * @param {boolean} [includeSubdomains] Treat subdomains of the site, on the same port, as internal.
 * @returns {boolean}
 */
export function isInternalUrl(url, siteHost, includeSubdomains = false) {
  const host = hostOf(url);
  if (host === null) return false;
  const key = hostKey(host);
  const siteKey = hostKey(siteHost);
  if (key === siteKey) return true;
  if (!includeSubdomains) return false;
  const candidate = splitHost(key);
  const site = splitHost(siteKey);
  return candidate.port === site.port && candidate.name.endsWith(`.${site.name}`);
}

/**
 * Which site a crawl is of, for the one-crawl-per-site rule: the host's name
 * (`hostName`), whatever the scheme or port, since one server answers them
 * all; for a site on this machine, the port, since localhost, 127.0.0.1 and
 * [::1] name the same server.
 * @param {string} startUrl
 * @param {boolean} loopback
 * @returns {string}
 */
export function crawlKey(startUrl, loopback) {
  const url = new URL(startUrl);
  if (loopback) return `loopback:${url.port || (url.protocol === 'https:' ? '443' : '80')}`;
  return `host:${hostName(url.hostname)}`;
}

/** Names that only mean something on a local network (RFC 6761, RFC 6762, RFC 8375 and common use). */
const LOCAL_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.localdomain', '.home.arpa', '.intranet', '.corp'];

/**
 * Whether the host of `url` could be a public site: not this machine, not an
 * address that is not public, not a name that only works on a local network,
 * and not a single-label name. One trailing dot is ignored.
 * @param {string} url
 * @returns {boolean}
 */
export function isPublicHost(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const bare = (hostname.startsWith('[') ? hostname.slice(1, -1) : hostname).replace(/\.$/, '');
  if (net.isIP(bare) !== 0) return classifyAddress(bare) === 'public';
  if (bare === 'localhost' || !bare.includes('.')) return false;
  return !LOCAL_SUFFIXES.some((suffix) => bare.endsWith(suffix));
}

/**
 * @typedef {Object} SiteIdentity
 * @property {string} host  `URL.host` of the audited site.
 * @property {(url: string) => boolean} isInternal  A page of the site, as the crawl scopes it (`isInternalUrl`).
 * @property {(url: string) => boolean} isSiteHost  On the site's host name (`hostName`), whatever the scheme or port.
 * @property {(url: string) => boolean} isDeployed  On the host name of the deployed site of a local crawl; false otherwise.
 * @property {(url: string) => boolean} namesSite   On the site: internal, on its host name, or on its deployed host.
 * @property {(host: string) => boolean} isSameOrganisation  A host the site's owner holds (see `siteIdentity`).
 * @property {(host: string) => boolean} sharesName  A host of the organisation, or one whose registered domain has the
 *   site's name under any ending, linked or not: the hosts a site that refused the crawler may also serve.
 * @property {(url: string) => boolean} isPublic    `isPublicHost`.
 */

/**
 * @typedef {Object} IdentityOptions
 * @property {string} siteHost                 `URL.host` of the audited site.
 * @property {boolean} [includeSubdomains]
 * @property {string|null} [deployedOrigin]    For a crawl of a local server, where the project is deployed.
 * @property {Iterable<string>} [visibleHosts]  Hosts the site's pages link to visibly (`PageSecurity.visible_hosts`).
 */

/**
 * The answers for one crawl.
 *
 * A host is of the same organisation when its name is the site's or the
 * deployed site's, or when it has the same registered domain
 * (`registrableDomain`: cdn.acme.com and shop.acme.com for www.acme.com;
 * nothing else under vercel.app for acme.vercel.app, since vercel.app is a
 * public suffix). The same name under another ending (acme.de for acme.com)
 * is the organisation's only when the site links to that domain visibly,
 * since anyone can register `<name>.<ending>`. An IP address or a name of
 * one label has no registered domain and matches only itself.
 * @param {IdentityOptions} options
 * @returns {SiteIdentity}
 */
export function siteIdentity({ siteHost, includeSubdomains = false, deployedOrigin = null, visibleHosts = [] }) {
  const ownNames = new Set([hostName(siteHost)]);
  const deployedName = deployedOrigin ? hostName(hostOf(deployedOrigin) ?? '') : null;
  if (deployedName) ownNames.add(deployedName);
  /** Registered domains of the site and of its deployed address. */
  const ownDomains = new Set([...ownNames].map(registrableDomain).filter((domain) => domain !== null));
  const labelOf = (/** @type {string} */ domain) => domain.slice(0, domain.indexOf('.'));
  const ownLabels = new Set([...ownDomains].map(labelOf));
  /** Registered domains with the site's name under another ending that a visible link names. */
  const siblings = new Set();
  /** @type {Set<string>} */
  const names = new Set();
  for (const host of visibleHosts) if (typeof host === 'string') names.add(hostName(host));
  for (const name of names) {
    const domain = registrableDomain(name);
    if (domain !== null && !ownDomains.has(domain) && ownLabels.has(labelOf(domain))) siblings.add(domain);
  }
  /** @type {Map<string, boolean>} */
  const known = new Map();
  /** @param {string} host */
  const isSameOrganisation = (host) => {
    const name = hostName(host);
    let answer = known.get(name);
    if (answer === undefined) {
      const domain = ownNames.has(name) ? null : registrableDomain(name);
      answer = ownNames.has(name) || (domain !== null && (ownDomains.has(domain) || siblings.has(domain)));
      known.set(name, answer);
    }
    return answer;
  };
  /** @param {string} url */
  const nameOf = (url) => {
    const host = hostOf(url);
    return host === null ? null : hostName(host);
  };
  const siteName = hostName(siteHost);
  /** @param {string} url */
  const isInternal = (url) => isInternalUrl(url, siteHost, includeSubdomains);
  /** @param {string} url */
  const isSiteHost = (url) => nameOf(url) === siteName;
  /** @param {string} url */
  const isDeployed = (url) => deployedName !== null && nameOf(url) === deployedName;
  return {
    host: siteHost,
    isInternal,
    isSiteHost,
    isDeployed,
    namesSite: (url) => isInternal(url) || isSiteHost(url) || isDeployed(url),
    isSameOrganisation,
    sharesName: (host) => {
      if (isSameOrganisation(host)) return true;
      const domain = registrableDomain(hostName(host));
      return domain !== null && ownLabels.has(labelOf(domain));
    },
    isPublic: isPublicHost,
  };
}

/**
 * The identity of a crawled site: its host, its subdomain option, the
 * deployed address of a local crawl, and the hosts its html pages link to
 * visibly.
 * @param {CrawlResult} crawl
 * @returns {SiteIdentity}
 */
export function crawlIdentity(crawl) {
  /** @type {string[]} */
  const visibleHosts = [];
  for (const page of crawl.pages) {
    const hosts = page.status === 200 && page.is_html ? page.security?.visible_hosts : undefined;
    if (Array.isArray(hosts)) visibleHosts.push(...hosts);
  }
  return siteIdentity({
    siteHost: crawl.site_host,
    includeSubdomains: crawl.options.include_subdomains === true,
    deployedOrigin: crawl.options.deployed_origin ?? null,
    visibleHosts,
  });
}
