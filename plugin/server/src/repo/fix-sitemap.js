// The fix of a missing sitemap (ARCHITECTURE.md 4.13): the files to create
// and edit, and the paths to list.

/** @import { Finding } from '../types.js' */
/** @import { PlanContext } from './fix-common.js' */

import { MAX_SHARED, pathOf } from './fix-common.js';
import { sitemapHow } from './fix-texts.js';

const MAX_SITEMAP_PATHS = 200;

/**
 * Plan the sitemap fix, or refuse it with the reason.
 * @param {PlanContext} ctx
 * @param {Finding} finding
 */
export function planSitemap(ctx, finding) {
  const { sources, files, crawl, siteUrl, appDir, isNext, inProject, refuse, base } = ctx;
  const lines = /** @type {{robots_sitemap_lines?: unknown}} */ (finding.evidence?.observed ?? {}).robots_sitemap_lines;
  if (typeof lines === 'number' && lines > 0) {
    return refuse(finding, 'robots.txt already names a sitemap, and that sitemap could not be read. Correct the address in robots.txt or make it answer; creating a second sitemap would not help.');
  }
  const ext = sources.files.some((file) => /\.tsx?$/.test(file)) ? 'ts' : 'js';
  const sitemapFile = isNext ? `${appDir}/sitemap.${ext}` : 'sitemap.xml';
  const existingSitemap = isNext
    ? [`${appDir}/sitemap.js`, `${appDir}/sitemap.ts`, `${appDir}/sitemap.xml`, 'public/sitemap.xml'].find((file) => files.has(file))
    : files.has('sitemap.xml') ? 'sitemap.xml' : undefined;
  if (existingSitemap) {
    return refuse(finding, 'The project already has a sitemap file (named under example_files), but the server sent no sitemap at /sitemap.xml. Find out why that file is not served before adding another.', inProject(existingSitemap));
  }
  const robotsFile = isNext
    ? [`${appDir}/robots.js`, `${appDir}/robots.ts`, `${appDir}/robots.txt`, 'public/robots.txt'].find((file) => files.has(file))
    : files.has('robots.txt') ? 'robots.txt' : undefined;
  const newRobots = isNext ? `${appDir}/robots.${ext}` : 'robots.txt';
  const indexable = (crawl?.pages ?? []).filter((page) => page.indexability.indexable).map((page) => pathOf(page.url)).filter((path) => path !== null);
  const fromFiles = sources.routes.filter((route) => (isNext ? route.kind === 'page' && !route.route.includes('[') : true)).map((route) => (isNext ? route.route : route.route.replace(/(^|\/)index\.html?$/, '$1')));
  const paths = [...new Set(crawl ? indexable : fromFiles)].sort();
  const dynamicRoutes = isNext ? sources.routes.filter((route) => route.kind === 'page' && route.route.includes('[')).map((route) => route.route) : [];
  ctx.add({
    ...base(finding),
    type: 'sitemap',
    action: 'create',
    kind: isNext ? 'next-app' : 'html',
    file: null,
    line: null,
    route: null,
    how: sitemapHow({ next: isNext, hasRobots: robotsFile !== undefined, siteUrl }),
    needs_site_url: true,
    create: [
      { file: inProject(sitemapFile), purpose: 'The XML sitemap, served at /sitemap.xml.' },
      ...(robotsFile ? [] : [{ file: inProject(newRobots), purpose: 'robots.txt that allows crawling and names the sitemap.' }]),
    ],
    ...(robotsFile ? { edit: [{ file: inProject(robotsFile), purpose: 'Add the line that names the sitemap.' }] } : {}),
    sitemap_paths: paths.slice(0, MAX_SITEMAP_PATHS),
    ...(dynamicRoutes.length > 0 ? { dynamic_routes: dynamicRoutes.slice(0, MAX_SHARED) } : {}),
  });
}
