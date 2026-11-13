// The fix of one page's metadata (ARCHITECTURE.md 4.13): which file, which
// action, and what the page sends today.

/** @import { Finding, PageRecord } from '../types.js' */
/** @import { FIXABLE_CHECKS } from './fixes.js' */
/** @import { PlanContext } from './fix-common.js' */

import { clip } from '../util/strings.js';
import { CURRENT_CLIP, MAX_SHARED, pathOf, plainPath } from './fix-common.js';
import { htmlHow, nextHow } from './fix-texts.js';
import { isHtmlFile } from './html-routes.js';

const PAGE_FILE = /^page\.(?:js|jsx|ts|tsx)$/;
const LAYOUT_FILES = ['layout.tsx', 'layout.jsx', 'layout.ts', 'layout.js'];
const OG_TAGS = new Set(['og:title', 'og:image']);

/**
 * What a page sent for the tags a metadata fix is about. Text from the page, clipped.
 * @param {PageRecord} page
 */
function currentOf(page) {
  /** @type {Record<string, string>} */
  const og = {};
  for (const name of ['title', 'description', 'image', 'url', 'type']) {
    if (typeof page.og[name] === 'string') og[name] = clip(page.og[name], CURRENT_CLIP);
  }
  return {
    titles: page.titles.slice(0, 3).map((title) => clip(title, CURRENT_CLIP)),
    meta_descriptions: page.meta_descriptions.slice(0, 3).map((text) => clip(text, CURRENT_CLIP)),
    canonicals: page.canonicals.slice(0, 5).map(({ href, source, in_head }) => ({ href: clip(href, CURRENT_CLIP), source, in_head })),
    og,
  };
}

/**
 * Layout files above a file of the app folder, nearest first.
 * @param {string} file     Relative to the source folder.
 * @param {string} appDir
 * @param {Set<string>} files
 * @returns {string[]}
 */
function layoutsAbove(file, appDir, files) {
  /** @type {string[]} */
  const found = [];
  const parts = file.split('/').slice(0, -1);
  while (parts.join('/').length >= appDir.length && parts.length > 0) {
    const dir = parts.join('/');
    const layout = LAYOUT_FILES.map((name) => `${dir}/${name}`).find((candidate) => files.has(candidate));
    if (layout) found.push(layout);
    if (dir === appDir) break;
    parts.pop();
  }
  return found;
}

/**
 * Plan the fix of a page finding, or refuse it with the reason.
 * @param {PlanContext} ctx
 * @param {Finding} finding
 * @param {typeof FIXABLE_CHECKS[string]} fix
 */
export function planPage(ctx, finding, fix) {
  const { files, appDir, pages, byCheckAndUrl, siteUrl, inProject, listed, refuse, base } = ctx;
  const { source } = finding;
  if (!source || finding.url === null) {
    return refuse(finding, 'The audit could not say which source file this page comes from (the notes of the run say what limits the mapping), so there is no file to change safely.');
  }
  const file = listed(source.file);
  if (file === null) return refuse(finding, 'The source file this finding names is no longer in the project. Audit again, then plan the fixes from the new run.');
  const html = isHtmlFile(file);
  const name = file.slice(file.lastIndexOf('/') + 1);
  if (!html && !PAGE_FILE.test(name)) {
    return refuse(finding, /^page\.mdx?$/.test(name)
      ? 'The page is a Markdown page. How its metadata is set depends on the project\'s MDX setup, which the plugin does not read.'
      : 'The file that answers this address is not a page file, so it has no metadata export to change.');
  }
  if (!html && fix.action === 'remove_extra') {
    return refuse(finding, 'The page sends this tag more than once. In a Next.js project one comes from the metadata export and the other from a tag written by hand in a layout, a page or a component, and the plugin cannot tell in which file. Search the project for the hand-written tag and remove it.');
  }
  const page = pages.get(finding.url) ?? null;
  let action = /** @type {string} */ (fix.action);
  if (fix.type === 'canonical' && typeof finding.evidence?.observed === 'string' && finding.evidence.observed.startsWith('Canonical links exist')) {
    if (!html) {
      return refuse(finding, 'The page already sends a canonical link that search engines do not read (outside the head, or not a valid URL), and the plugin cannot tell which file writes it. Find that link in the project and correct it; adding a second canonical would make things worse.');
    }
    action = 'repair';
  }
  const missing = fix.type === 'open_graph'
    ? (Array.isArray(/** @type {{missing?: unknown}} */ (finding.evidence?.observed ?? {}).missing)
      ? /** @type {unknown[]} */ (/** @type {{missing: unknown[]}} */ (finding.evidence.observed).missing).filter((tag) => typeof tag === 'string' && OG_TAGS.has(tag)).map(String)
      : [])
    : null;
  if (missing !== null && missing.length === 0) return refuse(finding, 'The finding does not say which Open Graph tags are missing. Audit again with the current version of the plugin.');
  const path = pathOf(finding.url);
  const canonical = fix.type === 'canonical' && path !== null ? { path, url: siteUrl === null ? null : `${siteUrl}${path}` } : null;
  const dynamic = !html && (source.route ?? '').includes('[');
  const sharesWith = fix.action === 'make_unique'
    ? finding.related_urls.slice(0, MAX_SHARED).map((url) => ({ url, file: plainPath(byCheckAndUrl.get(`${finding.check_id}\n${url}`)?.source?.file) }))
    : null;
  const needsSiteUrl = fix.type === 'canonical' || (missing !== null && missing.includes('og:image'));
  const line = Number.isSafeInteger(source.line) && /** @type {number} */ (source.line) > 0 ? source.line : null;
  const texts = { type: fix.type, action, line, missing: missing ?? [], canonical, dynamic, sameFile: sharesWith !== null && sharesWith.some((other) => other.file === source.file), siteUrl };
  ctx.add({
    ...base(finding),
    type: fix.type,
    action,
    kind: html ? 'html' : 'next-app',
    // The name as the project's listing has it, not as the stored run spells it.
    file: inProject(file),
    line,
    route: typeof source.route === 'string' ? clip(source.route, CURRENT_CLIP) : null,
    how: html ? htmlHow(texts) : nextHow(texts),
    needs_site_url: needsSiteUrl,
    current: page === null ? null : currentOf(page),
    ...(!html && appDir !== null ? { layouts: layoutsAbove(file, appDir, files).map(inProject), dynamic } : {}),
    ...(sharesWith !== null ? { shares_with: sharesWith } : {}),
    ...(missing !== null ? { missing } : {}),
    ...(canonical !== null ? { canonical } : {}),
  });
}
