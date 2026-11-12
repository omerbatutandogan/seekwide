// Questions the security checks share. Pure.

/** @import { CheckContext, PageRecord, PageSecurity, SecurityHeaders } from '../../types.js' */

import { onDeployedHost } from '../../crawl/deployed.js';

/** The date every rule of this module was read against its documentation. */
export const VERIFIED = '2026-11-12';

/**
 * @typedef {PageRecord & {security: PageSecurity}} SecuredPage
 */

/**
 * @param {unknown} value
 * @returns {value is SecurityHeaders}
 */
function validHeaders(value) {
  const headers = /** @type {Partial<SecurityHeaders>|null} */ (value);
  return typeof headers === 'object' && headers !== null
    && (headers.hsts_max_age === null || typeof headers.hsts_max_age === 'number')
    && typeof headers.nosniff === 'boolean'
    && (headers.csp === null || headers.csp === 'header' || headers.csp === 'meta')
    && Array.isArray(headers.frame_ancestors) && headers.frame_ancestors.every((sources) => typeof sources === 'string')
    && Array.isArray(headers.x_frame_options) && headers.x_frame_options.every((option) => typeof option === 'string')
    && (headers.referrer_policy === null || typeof headers.referrer_policy === 'string');
}

/**
 * True when the record carries the security signals in the shape this
 * version writes. Records written before the module existed do not, and are
 * not units of its checks; neither is a record whose signals are damaged.
 * @param {PageRecord} page
 * @returns {page is SecuredPage}
 */
export function hasSecurity(page) {
  const security = /** @type {Partial<PageSecurity>|undefined} */ (page.security);
  return typeof security === 'object' && security !== null && Array.isArray(security.hidden_links)
    && Array.isArray(security.visible_hosts) && Array.isArray(security.embeds)
    && typeof security.spam_terms === 'object' && security.spam_terms !== null
    && typeof security.topic_terms === 'object' && security.topic_terms !== null
    && typeof security.scripts === 'object' && security.scripts !== null && validHeaders(security.headers);
}

/**
 * For a crawl of a local server that was told where the project is deployed,
 * whether a URL is on the deployed site, which is the same site and not another
 * one. Always false for any other crawl.
 * @param {CheckContext} ctx
 * @returns {(url: string) => boolean}
 */
export function deployedSite(ctx) {
  const deployed = ctx.crawl.options.deployed_origin;
  return deployed ? (url) => onDeployedHost(url, deployed) : () => false;
}

/**
 * The html pages (status 200, HTML) that carry the security signals, in crawl order.
 * @param {CheckContext} ctx
 * @returns {SecuredPage[]}
 */
export function securedPages(ctx) {
  return ctx.htmlPages.filter(hasSecurity);
}

/**
 * The start page when it is an html page with the security signals: the page
 * that says what the site is about. Null otherwise.
 * @param {CheckContext} ctx
 * @returns {SecuredPage|null}
 */
export function securedStartPage(ctx) {
  const start = ctx.resolve(ctx.site.start_url);
  if (!start || start.status !== 200 || !start.is_html || !hasSecurity(start)) return null;
  return start;
}

/**
 * `tag[attribute="value"]` with `\` and `"` escaped, as the links module writes selectors.
 * @param {string} tag
 * @param {string} attribute
 * @param {string} value
 * @returns {string}
 */
export function attributeSelector(tag, attribute, value) {
  return `${tag}[${attribute}="${value.replace(/["\\]/g, '\\$&')}"]`;
}

/**
 * @param {string} a
 * @param {string} b
 */
export function compareText(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
