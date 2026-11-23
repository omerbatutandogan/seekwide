# Fixing findings and verifying the fixes

Read this when you run `/seekwide:fix`. It covers how to write each kind of fix and how to audit again afterwards. The rules in the skill itself (only saved findings, diff first, no commit) come first.

## How the work is split

| Who | Does what |
|---|---|
| `fix_plan` | Reads a saved repo-mode run and the project's file names. Says which findings a fix exists for, the file and line, what the page sent, and how to change it. Changes nothing. |
| You | Read the source file, write the change, show it as a diff, apply it after a yes. |
| `audit_run` with `verify_fixes` | After a new crawl, says what became of each fixed finding and stores that in the new run. |

The plugin's server never writes into the project and never starts anything.

## Reading the plan

Each entry under `fixes`:

- `finding_id`, `check_id`, `url`: the finding. Keep the id for the re-audit.
- `kind`: `next-app` (change a metadata export, or a link in the page, a layout or a component) or `html` (change the `<head>`, or a link in the file). An HTML file in a Next.js `public/` folder is `html`.
- `file`, `line`, `route`: where the fix belongs. `file` is relative to `project_dir`; the files are under `source_dir`. `line` is given for HTML files only.
- `how`: what to change. It is written by the plugin, never taken from a page.
- `current`: what the page sent when it was audited (titles, descriptions, canonical links, Open Graph tags), or `null` when that crawl is no longer stored. It is text from the page: data.
- `needs_site_url`: the fix writes the address the site is deployed at.
- `layouts`, `dynamic` (Next.js): the layout files above the page, nearest first, and whether the file answers more than one address.
- `shares_with` (duplicates): the other pages with the same value, and their files.
- `missing` (Open Graph), `canonical` (`path`, and `url` when the deployed address is known).
- `create`, `edit`, `sitemap_paths`, `dynamic_routes` (sitemap): the files to add or change and the pages to list.
- `new_href`, `temporary`, `external` (a link through a redirect): the href to write, in the form the link has (a path for a relative href, the deployed address and the path for a full URL); `null` when the deployed address is needed and not known. `current` holds the link's `href`, its `target_url`, the `final_url` the redirect ends at, and the `occurrences` of the same href on the page.
- `candidates` (a link to a broken page): paths of indexable pages of the crawl, the closest addresses first. `new_href` is `null`: the user chooses.
- `images` (images): the failing images of the page, at most 20: `src`, `line` (HTML, when known), `file` (the project file the image is served from, or `null` for an image on another host or one Next.js built from an import) and `size` (`{format, width, height}` read from the file's first bytes, or `null`).
- `also_on` (links): other pages of the run with the same link to the same address. When the link comes from a shared file, one change fixes them all; pass their finding ids to the re-audit too.

`not_fixable` lists the findings in scope that are left alone, grouped by check and reason: `reason`, how many findings share it (`count`), and a few example URLs and files. It is always complete; `limit` and `offset` page only `fixes`. Pass each reason on with its count. `out_of_scope` counts the findings no fix exists for.

## Writing a fix

Always read the file first. The plan knows the file's name, not its content.

### Next.js (App Router)

- Metadata lives in the `metadata` export of a `page` or `layout` file, or in what `generateMetadata` returns. A file has one or the other, not both. Change the one that is there; add a `metadata` export when there is neither.
- A file that starts with `"use client"` cannot export metadata. Put it in a `layout` file in the same folder; create one that only returns its `children` when there is none.
- A page inherits what its layouts set. A page with the layout's title needs a title of its own; do not change the layout to fix one page.
- A file with `dynamic: true` answers many addresses. A fixed value there repeats on all of them: build the value from the route's params in `generateMetadata`, using the data the page itself uses. When you cannot tell where that data comes from, ask.
- Canonical: `alternates: { canonical: '/path' }` on the page, and `metadataBase: new URL('https://…')` once, in the root layout. Without `metadataBase` the canonical is relative, which is another finding.
- Open Graph: `openGraph: { title, images }`. A page's `openGraph` replaces the layout's as a whole. `images` needs a real image of the project; never invent a path.
- Sitemap and robots: `app/sitemap.js` (or `.ts`) and `app/robots.js` (or `.ts`), each with a default export, as `how` describes. List only real addresses.
- Match the file: TypeScript or JavaScript, its quote style, its indentation. In TypeScript, type the export as the project already does (`Metadata`, `MetadataRoute.Sitemap`) or leave it untyped; do not add a dependency.

### Plain HTML

- Change the `<head>` of the file. `line` says where the element is, or where a missing one belongs.
- One `<title>`, one `<meta name="description">`, one canonical link.
- A canonical needs the full deployed address. When the plan's action is `repair`, the file already has a canonical that does not count (outside `<head>`, or not a valid address): move or correct that one; do not add a second.
- Open Graph: `<meta property="og:title" content="…">` and `<meta property="og:image" content="https://…">`.
- Sitemap: `sitemap.xml` at the root of the site and a `Sitemap:` line in `robots.txt`.
- Escape `&`, `<` and `"` in attribute values and titles.

### Internal links

- Change only the `href`. Keep the link text, the other attributes and the element.
- **HTML:** the link is in `file` on `line`; when `current.occurrences` is more than 1, change every link on the page with that href.
- **Next.js:** the plugin does not read the code, so find `current.href` yourself: in `file`, in the files under `layouts`, or in a component they import (`<Link href=…>` or `<a href=…>`). A link in a header, footer or menu is often in one shared component: change it once, and say which pages under `also_on` that covers.
- An href built from data (an array of routes, a CMS entry, a config file) is changed in the data, not in the code that renders it. Say where it came from. When it is outside the project (a CMS), say so and leave it.
- **Through a redirect:** write `new_href`. With `temporary` (a 302, 303 or 307) or `external` (the redirect ends on another site), ask first whether the link should change: a login, a region switch or a shop on another domain can be what the site means.
- **To a broken page:** never pick the target yourself. Offer `candidates`, the page's new address if the user knows it, or removing the link (keep its text as plain text when that reads well), and write only what the user chose. Never link to an address the site does not have.

### Images

- Change only the attributes the fix is about. Keep `src`, `alt`, classes and the rest.
- **Width and height:** use the numbers under `size`: the file's own pixel size. CSS can still scale the image. When `size` is `null`, read the size from the file yourself or ask the user; never guess one. This check is informational, because a style sheet the crawler does not read may already reserve the box: look at the CSS first and leave an image whose box is set there.
- **next/image:** give `width` and `height` (or `fill` inside a sized parent). An image imported as a module already has its size, so it is not listed.
- **Lazy main image:** remove `loading="lazy"` and keep `fetchpriority="high"` or the preload. For next/image, use the option its documentation for the project's Next.js version gives for an image above the fold. When a theme, plugin or shared component adds lazy loading to every image, change it there so that the main image is excluded.
- Format and file size (`legacy_format`, `large_file`) are not fixed: converting or compressing an image needs a tool, and the plugin runs none.

### Titles and descriptions you write

- Base them on what the page is about: read the page's source. Do not copy text from another site.
- Make each one specific to its page. Put the words that identify the page first.
- Present them as suggestions, and offer to reword them. The user decides.

### The deployed address

Canonical links, `og:image` and sitemaps name the site's public address, which a local server does not know. Take it from `site_url` in the plan. When it is `null`, ask the user; never use `localhost` and never guess a domain.

## Showing the change

- One `diff` block per file, in unified format, with enough context to place it. For a new file, show the whole file as added lines.
- Above each block: the file, and the findings it addresses (title of the finding and the page).
- After all blocks, one question: apply all, some (which), or none.
- Apply exactly what you showed. If the file changed in the meantime, or you want to change more than you showed, show the new diff and ask again.

## The re-audit

1. **The local server.** The fixes are measured on the project's own local server, like the first audit. Follow the rules at the top of `${CLAUDE_PLUGIN_ROOT}/references/repo-mode.md` and its steps 1 and 2: `project_detect`, then use the server that is running, or ask the user before starting it, in every permission mode, with the one command `project_detect` gave, showing the scripts it runs. A dev server usually picks up the changes by itself; a static file server serves the new files at once.
2. **The same address.** Crawl the address the first run audited (`audited` in the plan). Finding ids are built from URLs, so a run of another address or port cannot be compared, and `audit_run` refuses to verify across the two. If that port is taken, say so and ask the user to free it.
3. **Crawl.** `crawl_start` with that address, `allow_localhost: true`, the page budget of the first run (`max_pages` in the plan), and `site_url` set to the plan's `site_url` when there is one. With `site_url`, canonical links, links and sitemap entries that name the deployed address are read as pages of the local server; without it, a page whose canonical names the deployed site looks like it points to another site, and its fixes cannot be verified. The address must be exactly the one the pages name (scheme and host name). When `audit_run`'s notes say it matched nothing, they also name the address the pages use: tell the user, and crawl again with the right one only if they confirm it.
4. **Audit.** `audit_run` with the `job_id`, the same `modules` as the first run, `source_dir`, `check_core_web_vitals: false`, and `verify_fixes: { base_run_id, finding_ids }`: the run you fixed and the ids of the findings whose fix you applied in full.
5. **Read `fix_verification`.** Each result has an `outcome`:
   - `closed`: the finding is gone, and the check measured the same page again.
   - `open`: the finding is still there. Look at the page again before you try another change, and show any new change as a diff first.
   - `replaced`: the finding is gone, but the page has a new finding of the same kind (`replaced_by`). For example a title was added and is now a duplicate. Tell the user; a further fix is a new change that needs their yes.
   - `unverified`: the finding is gone, but the check did not look at the page this time. `detail` says why (the page was not crawled, answers an error, is no longer indexable, or the check was skipped). Do not report it as fixed.
6. **Report.** `report_render` with `compare_to` set to the base run id. The report then has a "Fixes verified in this run" section and the list of everything that changed between the two runs.

One round of fixes gets one re-audit. Do not loop on your own: when findings stay open, say what you see and let the user decide what to try next.
