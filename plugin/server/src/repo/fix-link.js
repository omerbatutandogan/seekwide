// The fix of one internal link (ARCHITECTURE.md 4.13): a link that goes
// through a redirect is pointed at the final address, and a link to a broken
// page is changed to a page the site has, or removed, as the user decides.
// Which link it is, where it points and where it ends are read from the
// stored crawl, never from the text of the stored run.

/** @import { Finding, LinkRecord, PageRecord } from '../types.js' */
/** @import { FIXABLE_CHECKS } from './fixes.js' */
/** @import { PlanContext } from './fix-common.js' */

import { hrefSelector } from '../checks/links/helpers.js';
import { clip } from '../util/strings.js';
import { CURRENT_CLIP, MAX_SHARED, pathOf, resolvePageFile } from './fix-common.js';
import { linkHow } from './fix-texts.js';
import { isHtmlFile } from './html-routes.js';

/** Pages offered as targets for a link to a broken page. */
export const MAX_CANDIDATES = 20;

/** Redirect statuses that say the move is temporary (as `links.internal.redirect` reads them). */
const TEMPORARY = new Set([302, 303, 307]);

/**
 * The links of a page that the finding is about: those whose selector is the
 * finding's, in document order.
 * @param {PageRecord} page
 * @param {string|null} selector
 * @returns {LinkRecord[]}
 */
function linksOf(page, selector) {
  if (typeof selector !== 'string') return [];
  return page.links.filter((link) => link.internal && link.url !== null && hrefSelector(link.href) === selector);
}

/**
 * The href to write for an address of the audited site, in the form the
 * link already has: a path when the href is relative, the deployed address
 * followed by the path when it is a full URL (a local server's own address is
 * never written into a project).
 * @param {string} href    The href the link has.
 * @param {string} url     The address to link to, on the crawled origin.
 * @param {string|null} siteUrl
 * @returns {{href: string|null, needsSiteUrl: boolean}}
 */
function hrefFor(href, url, siteUrl) {
  const path = pathOf(url);
  if (path === null) return { href: null, needsSiteUrl: false };
  let hash = '';
  try {
    hash = new URL(url).hash;
  } catch {
    // pathOf parsed it already.
  }
  if (!/^[a-z][a-z\d+.-]*:|^\/\//i.test(href.trim())) return { href: `${path}${hash}`, needsSiteUrl: false };
  return siteUrl === null ? { href: null, needsSiteUrl: true } : { href: `${siteUrl}${path}${hash}`, needsSiteUrl: false };
}

/**
 * Pages a link to a broken page could point to instead: the indexable HTML
 * pages of the crawl, those that share the most leading path segments with
 * the broken address first, then by path.
 * @param {Map<string, PageRecord>} pages
 * @param {string} target
 * @returns {string[]}
 */
function candidatesFor(pages, target) {
  const segments = (/** @type {string} */ path) => path.split(/[/?]/).filter(Boolean);
  const wanted = segments(pathOf(target) ?? '');
  /** @type {{path: string, shared: number}[]} */
  const found = [];
  for (const page of pages.values()) {
    if (page.status !== 200 || !page.is_html || !page.indexability.indexable || page.url !== page.final_url) continue;
    const path = pathOf(page.url);
    if (path === null) continue;
    const parts = segments(path);
    let shared = 0;
    while (shared < parts.length && shared < wanted.length && parts[shared] === wanted[shared]) shared += 1;
    found.push({ path, shared });
  }
  found.sort((a, b) => b.shared - a.shared || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return [...new Set(found.map((entry) => clip(entry.path, CURRENT_CLIP)))].slice(0, MAX_CANDIDATES);
}

/**
 * Plan the fix of an internal-link finding, or refuse it with the reason.
 * @param {PlanContext} ctx
 * @param {Finding} finding
 * @param {typeof FIXABLE_CHECKS[string]} fix
 */
export function planLink(ctx, finding, fix) {
  const { pages, siteUrl, inProject, refuse, base, crawl } = ctx;
  const resolved = resolvePageFile(ctx, finding);
  if (resolved === null) return;
  const { file, source } = resolved;
  if (crawl === null) {
    return refuse(finding, 'The crawl this audit was made from is no longer stored, so the plugin cannot tell which link the finding is about or where it should point. Audit again, then plan the fixes from the new run.');
  }
  const page = finding.url === null ? undefined : pages.get(finding.url);
  const links = page ? linksOf(page, finding.selector) : [];
  if (links.length === 0) {
    return refuse(finding, 'The stored crawl has no link on this page that matches the finding, so there is nothing to point elsewhere. Audit again, then plan the fixes from the new run.');
  }
  const targetUrl = /** @type {string} */ (links[0].url);
  const target = pages.get(targetUrl);
  if (!target) return refuse(finding, 'The stored crawl has no record of the address this link points to. Audit again, then plan the fixes from the new run.');
  const html = isHtmlFile(file);
  const href = links[0].href;
  /** @type {string|null} */
  let newHref = null;
  let needsSiteUrl = false;
  let temporary = false;
  let external = false;
  if (fix.action === 'retarget') {
    temporary = target.redirect_chain.length > 0 && target.redirect_chain.every((hop) => TEMPORARY.has(hop.status));
    external = target.final_external;
    if (external) newHref = clip(target.final_url, CURRENT_CLIP);
    else ({ href: newHref, needsSiteUrl } = hrefFor(href, target.final_url, siteUrl));
    if (newHref === null && !needsSiteUrl) return refuse(finding, 'The address the redirect ends at is not one the plugin can write as a link. Look at the redirect and change the link by hand.');
  }
  // Every page of the run that links to the same address through the same href, for one change in a shared file.
  const alsoOn = ctx.findingsOf(finding.check_id)
    .filter((other) => other.id !== finding.id && other.selector === finding.selector && other.url !== null)
    .map((other) => /** @type {string} */ (other.url))
    .slice(0, MAX_SHARED);
  const line = Number.isSafeInteger(source.line) && /** @type {number} */ (source.line) > 0 ? source.line : null;
  ctx.add({
    ...base(finding),
    type: 'internal_link',
    action: fix.action,
    kind: html ? 'html' : 'next-app',
    file: inProject(file),
    line,
    route: typeof source.route === 'string' ? clip(source.route, CURRENT_CLIP) : null,
    how: linkHow({ action: fix.action, html, line, occurrences: links.length, temporary, external, needsSiteUrl, shared: alsoOn.length > 0 }),
    needs_site_url: needsSiteUrl,
    current: {
      href: clip(href, CURRENT_CLIP),
      target_url: clip(targetUrl, CURRENT_CLIP),
      status: target.status,
      final_url: clip(target.final_url, CURRENT_CLIP),
      final_status: target.final_status,
      occurrences: links.length,
    },
    new_href: newHref,
    ...(fix.action === 'retarget' ? { temporary, external } : { candidates: candidatesFor(pages, targetUrl) }),
    ...(alsoOn.length > 0 ? { also_on: alsoOn } : {}),
    ...(!html ? { layouts: ctx.layoutsOf(file).map(inProject) } : {}),
  });
}
