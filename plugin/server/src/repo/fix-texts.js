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

/**
 * How to fix an internal link: point a redirected link at the final address,
 * or change or remove a link to a broken page. The href to write and the
 * candidate pages are named by the fix's fields (new_href, candidates), not
 * here.
 * @param {{action: string, html: boolean, line: number|null, occurrences: number, temporary: boolean, external: boolean, needsSiteUrl: boolean, shared: boolean}} input
 * @returns {string}
 */
export function linkHow({ action, html, line, occurrences, temporary, external, needsSiteUrl, shared }) {
  const onLine = Number.isSafeInteger(line) && /** @type {number} */ (line) > 0 ? ` on line ${line}` : '';
  const where = html
    ? `The link is in this file${onLine}.${occurrences > 1 ? ` The page has ${occurrences} links with the same href (current.occurrences): change each of them.` : ''}`
    : 'Find the link whose href is current.href: in this page file, in a layout under layouts, or in a component they import. A link in a header, footer or menu is shared by many pages, so one change there fixes all of them.';
  const sharedText = shared ? ' The pages under also_on have the same link: when it comes from a shared file, one change fixes them all, and their findings can be verified together.' : '';
  const built = html ? '' : ' If the href is built from data (a list of routes, a CMS, a config file), change the data rather than the code that renders it, and say so.';
  const keep = 'Change only the href: keep the link text and the other attributes.';
  if (action === 'retarget') {
    return [
      where,
      needsSiteUrl
        ? `It is written as a full URL, so the new one needs the deployed address of the site. ${NEED_SITE_URL}`
        : 'Change its href to new_href, the address the redirect ends at.',
      keep,
      temporary ? 'The redirect is temporary (302, 303 or 307), which a site can mean, for example for a login, a region or a cart: ask the user whether the page moved for good before changing the link.' : '',
      external ? 'The redirect ends on another site, so the link would then point there: ask the user whether that is what the link should do.' : '',
      built,
      sharedText,
    ].filter(Boolean).join(' ');
  }
  return [
    where,
    'It points to an address that answered an error. Ask the user what it should point to: one of the pages under candidates (pages the site has, closest addresses first), the new address of the page if it moved, or no link at all (keep the text, drop the link, when that reads well). Never point it to an address the site does not have, and never choose for the user.',
    keep,
    built,
    sharedText,
  ].filter(Boolean).join(' ');
}

/**
 * How to fix the markup of a page's images: give them their size, load the
 * main image eagerly, or write their alt text from the image itself. The
 * images are named by the fix's `images`, not here.
 * @param {{action: string, html: boolean, count: number, listed: number, unsized: number, remote: number}} input
 * @returns {string}
 */
export function imageHow({ action, html, count, listed, unsized, remote }) {
  const which = listed < count ? `The first ${listed} of the ${count} images are under images; fix those, then audit again for the rest.` : 'The images are under images.';
  const where = html
    ? 'Each entry gives the src and, when known, the line of the <img> in this file.'
    : 'Find each image by its src: in this page file, in a layout under layouts, or in a component they import. A src built from data is changed where the data is.';
  if (action === 'add_size') {
    return [
      which,
      where,
      html
        ? 'Add width and height attributes with the pixel size under size (the intrinsic size of the file, read from its first bytes). CSS can still scale the image (width: 100%; height: auto).'
        : 'For next/image, give width and height with the pixel size under size, or use fill inside a sized parent. For a plain <img>, add width and height attributes.',
      unsized > 0
        ? `For ${unsized === 1 ? 'one image' : `${unsized} images`} the size is null: the file is not in the project (another host, or an image Next.js built from an import), or its header could not be read. Read the size from the file yourself or ask the user; never guess a size.`
        : '',
      'This check is informational: a style sheet the crawler does not read may already reserve the box. Look at the CSS for the image first, and leave it when its box is already set there.',
    ].filter(Boolean).join(' ');
  }
  if (action === 'write_alt') {
    return [
      which,
      where,
      'For each image, open the file under file with your file-reading tool and look at the picture itself, then read the page around the image in the source file. Write alt text from what the picture shows and what it does there: a short phrase, in the language of the page; for a linked image, where the link goes; for a picture of text (a logo, a button, a banner), that text. When the picture adds nothing the surrounding text does not say, propose alt="" and say why.',
      'Never write it from the file name, from a placeholder that is there, or from text copied from another page, and never describe what you cannot see. Show each alt text as a suggestion in the diff; the user can reword it.',
      remote > 0
        ? `For ${remote === 1 ? 'one image' : `${remote} images`} file is null: the picture is not a file of the project (another host, or an image Next.js built from an import). Do not download it. Ask the user to describe it, or find the imported file in the source and look at that; otherwise leave the image and say that its finding stays open.`
        : '',
      'When the same picture appears on other pages, one alt text written in the shared component fixes all of them.',
    ].filter(Boolean).join(' ');
  }
  return [
    which,
    where,
    html
      ? 'Remove loading="lazy" from each one (eager is the default) and keep fetchpriority="high" or the preload.'
      : 'Remove loading="lazy" from each one. For next/image, use the option that its documentation for the project\'s Next.js version gives for the image above the fold, instead of lazy loading.',
    'If a plugin, theme or shared image component adds lazy loading to every image, change it there so that the main image is excluded, and say so.',
  ].join(' ');
}
