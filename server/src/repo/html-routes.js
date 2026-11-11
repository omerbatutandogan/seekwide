// Plain HTML: which file a static server sends for a URL path.

import { pathSegments } from './next-routes.js';

/**
 * The file a static file server answers a URL path with, or null. `/` is
 * `index.html`; `/about` is the file `about` itself, then `about.html`, then
 * `about/index.html`; `/about/` is `about/index.html`. `.htm` is accepted
 * wherever `.html` is. Matching is exact and case-sensitive against the
 * project's file list, so a path can never name a file outside the project.
 *
 * @param {Set<string>} files  Files of the project, relative to its folder, forward slashes.
 * @param {string} pathname    The path of a URL, still percent-encoded.
 * @returns {string|null}
 */
export function matchHtmlFile(files, pathname) {
  const segments = pathSegments(pathname);
  if (segments === null || segments.some((segment) => segment === '.' || segment === '..' || /[/\\\0]/.test(segment))) return null;
  const key = segments.join('/');
  const index = [`${key === '' ? '' : `${key}/`}index.html`, `${key === '' ? '' : `${key}/`}index.htm`];
  const candidates = key === '' ? index
    : pathname.endsWith('/') ? [...index, `${key}.html`, `${key}.htm`]
      : [key, `${key}.html`, `${key}.htm`, ...index];
  return candidates.find((candidate) => files.has(candidate)) ?? null;
}

/**
 * @param {string} file
 * @returns {boolean}
 */
export function isHtmlFile(file) {
  return /\.html?$/i.test(file);
}
