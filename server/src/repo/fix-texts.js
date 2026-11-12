// The wording of fix instructions. Fixed text written by the plugin. The only
// values put into it are the deployed origin and line numbers the plugin
// counted itself. File names are not part of it: they are named by the fields
// of the fix (file, create, edit), because a repository chooses its own file
// names. Nothing a page sent, not even the path of its URL, is ever part of it.

/**
 * @typedef {Object} FixTextInput
 * @property {'title'|'meta_description'|'canonical'|'open_graph'|'sitemap'} type
 * @property {string} action
 * @property {number|null} line
 * @property {string[]} missing       Open Graph tags that are missing.
 * @property {{path: string, url: string|null}|null} canonical  Only whether the full URL is known is used here.
 * @property {boolean} dynamic        Next.js: the file answers more than one address.
 * @property {boolean} sameFile       A duplicate whose other pages come from the same file.
 * @property {string|null} siteUrl    The origin the site is deployed at, when known.
 */

const NEED_SITE_URL = 'The deployed address of the site is not known: ask the user for it (for example https://www.example.com) before writing this.';
const SUGGESTION = 'The wording is yours to propose: label it as a suggestion and base it on what the page is about, which you learn by reading this file.';
const CLIENT_COMPONENT = 'If the file starts with "use client" it cannot export metadata: put the metadata in a layout file in the same folder instead, creating one that only returns its children if there is none.';

/**
 * @param {number|null} line
 * @returns {string}
 */
const headAt = (line) => (Number.isSafeInteger(line) && /** @type {number} */ (line) > 0 ? `inside <head> (line ${line})` : 'inside <head>');

/**
 * How to make a metadata fix in a Next.js App Router page file.
 * @param {FixTextInput} input
 * @returns {string}
 */
export function nextHow({ type, action, missing, canonical, dynamic, sameFile, siteUrl }) {
  const where = dynamic
    ? 'This file answers more than one address, so the value has to be built from the route\'s params in generateMetadata; a fixed value would repeat on every page of the route.'
    : 'Set it in this file\'s metadata export, or in what its generateMetadata returns when the file has one.';
  const field = type === 'title' ? 'title' : 'description';
  if (type === 'title' || type === 'meta_description') {
    if (action === 'make_unique') {
      return [
        `This page sends the same ${field} as the pages under shares_with. Give it a ${field} of its own.`,
        where,
        sameFile ? 'The other pages come from this same file, so the value must differ per address.' : `A ${field} that a layout sets (see layouts) is inherited by every page below it that sets none; change the page, not the layout.`,
        CLIENT_COMPONENT,
        SUGGESTION,
      ].join(' ');
    }
    return [`The page sends no ${field}. Add ${field} to the page's metadata.`, where, CLIENT_COMPONENT, SUGGESTION].join(' ');
  }
  if (type === 'canonical') {
    return [
      'Add alternates: { canonical: … } to the page\'s metadata, with the path given under canonical.path.',
      where,
      `Next.js turns that path into a full URL with metadataBase, which belongs in the metadata of the root layout (the last entry of layouts): metadataBase: new URL('${siteUrl ?? 'https://<deployed host>'}'). Add it there when it is missing; without it the canonical is sent as a relative URL, which is a finding of its own.`,
      siteUrl === null ? NEED_SITE_URL : '',
      CLIENT_COMPONENT,
    ].filter(Boolean).join(' ');
  }
  return [
    `Add openGraph to the page's metadata with the missing tags (${missing.join(', ')}).`,
    where,
    'openGraph.title can repeat the page\'s title.',
    missing.includes('og:image')
      ? 'openGraph.images needs an image that exists in the project (for example a file under public/) and becomes a full URL through metadataBase in the root layout. Do not invent an image: when the project has none, ask the user, and if there is none leave og:image out and say that the finding stays open.'
      : '',
    'A page\'s openGraph object replaces the one a layout sets as a whole, so repeat any fields of the layout\'s that should stay.',
    CLIENT_COMPONENT,
  ].filter(Boolean).join(' ');
}

/**
 * How to make a metadata fix in an HTML file.
 * @param {FixTextInput} input
 * @returns {string}
 */
export function htmlHow({ type, action, line, missing, canonical, siteUrl }) {
  if (type === 'title' || type === 'meta_description') {
    const tag = type === 'title' ? '<title>' : '<meta name="description">';
    if (action === 'remove_extra') {
      return `The file has more than one ${tag}. Keep one ${headAt(null)} and remove the others. When they differ, ask the user which one to keep.`;
    }
    if (action === 'make_unique') {
      const onLine = Number.isSafeInteger(line) && /** @type {number} */ (line) > 0 ? ` on line ${line}` : '';
      return `This page has the same ${type === 'title' ? 'title' : 'meta description'} as the pages under shares_with. Change the ${tag} element${onLine} to one of its own. ${SUGGESTION}`;
    }
    return `The file has no ${tag} with text. Add one ${headAt(line)}${type === 'title' ? '' : ', as <meta name="description" content="…">'}. ${SUGGESTION}`;
  }
  if (type === 'canonical') {
    const href = canonical?.url ? 'the address given under canonical.url' : 'the deployed address of the site followed by the path under canonical.path';
    const need = siteUrl === null ? ` ${NEED_SITE_URL}` : '';
    if (action === 'repair') {
      return `The file already has a canonical link that search engines do not read: it is outside <head>, or its address is not valid. Do not add a second one. Move that link ${headAt(line)}, before any element that belongs in the body, and give it the full address: <link rel="canonical" href="…"> with ${href}.${need}`;
    }
    return `Add <link rel="canonical" href="…"> ${headAt(line)}, with ${href}. Use the full address; a relative href is a finding of its own.${need}`;
  }
  return [
    `Add the missing Open Graph tags ${headAt(line)}: ${missing.map((tag) => `<meta property="${tag}" content="…">`).join(' and ')}.`,
    'og:title can repeat the page\'s title.',
    missing.includes('og:image')
      ? `og:image needs the full URL of an image that exists in the project. Do not invent one: when the project has no suitable image, ask the user, and if there is none leave og:image out and say that the finding stays open.${siteUrl === null ? ` ${NEED_SITE_URL}` : ''}`
      : '',
  ].filter(Boolean).join(' ');
}

/**
 * How to add a sitemap and name it in robots.txt. The files are named by the
 * fix's `create` and `edit` entries, not here.
 * @param {{next: boolean, hasRobots: boolean, siteUrl: string|null}} input
 * @returns {string}
 */
export function sitemapHow({ next, hasRobots, siteUrl }) {
  const site = siteUrl ?? 'https://<deployed host>';
  const need = siteUrl === null ? ` ${NEED_SITE_URL}` : '';
  if (next) {
    return [
      `Create the first file under create: a file whose default export is a function that returns an array of { url } objects, one per page, each with the full deployed address (${site} plus the path). Next.js serves it at /sitemap.xml.`,
      'List the pages under sitemap_paths. A route under dynamic_routes has addresses the file names do not show: take them from the data the route itself uses, or ask the user; never make addresses up.',
      hasRobots
        ? `Then name the sitemap in the file under edit: sitemap: '${site}/sitemap.xml' in a robots.js or robots.ts file, or a line "Sitemap: ${site}/sitemap.xml" in a robots.txt file. Keep the rules that are there.`
        : `The project has no robots file. Create the second file under create: its default export returns { rules: [{ userAgent: '*', allow: '/' }], sitemap: '${site}/sitemap.xml' }.`,
    ].join(' ') + need;
  }
  return [
    `Create the first file under create: an XML <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"> with one <url><loc>…</loc></url> per page under sitemap_paths, each <loc> the full deployed address (${site} plus the path).`,
    hasRobots
      ? `Then add the line "Sitemap: ${site}/sitemap.xml" to the file under edit, keeping the rules that are there.`
      : `The project has no robots.txt. Create the second file under create with "User-agent: *", "Allow: /" and the line "Sitemap: ${site}/sitemap.xml".`,
  ].join(' ') + need;
}
