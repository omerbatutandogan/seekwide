# Seekwide

Site audits for Claude Code that you can re-run and trust. Seekwide crawls a site politely, runs scripted SEO, link, Core Web Vitals, security, image and video checks with evidence for every finding, scores the result the same way every time, and writes a report you can send to a client.

> **Status: 0.1.0, the first release.** Four modules work today, `seo`, `links`, `security` and `media`, plus metadata fixes for a project in its own folder. The roadmap further down lists what is planned and not built yet.

## What it does today

- **Crawls like a well-behaved bot.** It obeys robots.txt for every page, sitemap and redirect step it requests, identifies itself, sends about one request per second, stays on the site you named, and stops when a site challenges it.
- **Runs 77 scripted checks** (62 scored, 15 informational): robots.txt, indexing, canonicals, sitemaps, redirects, HTTPS, titles, meta descriptions, headings, duplicate content, structured data syntax, Core Web Vitals, broken and redirected links, links search engines cannot follow, anchor text, orphan pages, broken external links, signs of a hacked site, security headers, alt text, image sizes and formats, broken images, images robots.txt keeps from Google, video captions and video structured data. The full list is in [docs/checks.md](docs/checks.md).
- **Measures Core Web Vitals** for the pages that matter most: the start page, then one page from each of the largest groups of similar pages (three pages with `/seekwide:basic`, five with `/seekwide:seo` and `/seekwide:all`). Real-user values (LCP, INP and CLS at the 75th percentile) come from the Chrome UX Report, lab values (LCP, CLS and Total Blocking Time) from PageSpeed Insights. The report names the pages it measured and shows every value, good ones included. This needs a Google API key; see [Core Web Vitals](#core-web-vitals).
- **Scores the same data the same way, every time.** Checks are code, not model judgment, so the same data always gets the same findings, ids and scores, and two audits can be compared finding by finding. What can differ between two audits of an unchanged site is what is fetched or measured at audit time: the answers of external sites, Google's lab test, the real-user data (a 28-day window that moves every day), and whether Google answered at all. A comparison says so when a lab finding changed or a check ran in only one of the two audits.
- **Shows its evidence.** Each finding has the URL, what was observed, what was expected, a confidence label, and a link to the documentation the rule is based on.
- **Looks for signs that a site was hacked**, from outside and from the pages it crawls anyway: links and frames that the page's own markup hides from visitors, pharmaceutical, gambling and counterfeit spam on a site that is not about those, pages in a writing system the site does not use, and scripts from sites no other page uses. It also checks the security headers of the start page. See [Security signals](#security-signals).
- **Checks images and videos**: alt text that is missing or is only a file name, images without the size that keeps a page from jumping as it loads, a main image that is lazy-loaded, and, for up to 50 image files per audit, broken files, JPEG and PNG where WebP or AVIF would serve, very large files, and images that robots.txt keeps from Google. For video: captions and `VideoObject` structured data. See [Images and video](#images-and-video).
- **Names the source file** when you audit a project in its own folder (repo mode). For a Next.js App Router project or a plain HTML site, the audit runs against the project's local server and each finding says which file it comes from: `app/about/page.tsx` for the route `/about`, or `services.html:17` for a broken link on line 17. See [Auditing a project in its folder](#auditing-a-project-in-its-folder).
- **Fixes what it found, and checks the fix.** For a project audited in its folder, `/seekwide:fix` proposes changes for metadata findings (a missing or duplicate title or meta description, a missing canonical, missing Open Graph tags, a missing sitemap) in the file each one comes from. Every change is shown as a diff and written only after you say yes; nothing is committed. A second audit then says, finding by finding, whether it is closed, still open, replaced by another finding, or could not be verified. See [Fixing findings](#fixing-findings).
- **Writes a report** as Markdown and as one self-contained HTML file, with an optional agency name and logo. The HTML prints cleanly to PDF.
- **Keeps facts and advice apart.** Claude writes the summary and can suggest better titles, and the report labels those parts as suggestions. They never change a score.

## What it does not do

- It does not promise rankings, traffic or inclusion in AI answers. It reports what is measurably wrong today.
- It does not run JavaScript. Content that appears only after scripts run is not seen.
- It does not get around firewalls, CAPTCHAs or robots.txt. When a site blocks it, it says so and stops. Pages the site refuses to serve to the crawler are counted and left out of the checks; they are never reported as errors of the site.
- It does not measure Core Web Vitals of every page. A lab test takes many seconds and Google limits how many can be run, so a few pages stand for the rest.
- It does not change your code by itself. The plugin's own server never writes into a project. With `/seekwide:fix`, Claude edits files with its normal tools, after showing you each diff and getting your yes, and it never commits. Only metadata fixes exist; images, links and content are not touched.
- It does not look for cloaking or sneaky redirects, and it does not test a site's defences. Finding cloaking needs a request that pretends to be Google, which this crawler never sends, so a clean security result is not proof of a clean site.
- It does not look at images themselves: it cannot tell whether alt text describes a picture, and it does not write alt text or convert images. It has no AI search or local SEO modules yet.

## Requirements

- Claude Code
- Node.js 22 or later on your `PATH` (the plugin's server runs with `node`)

## Install

Both ways below load the plugin in place from your copy, and Claude Code does not install packages into a folder it loads in place. So install the plugin's two small dependencies (`parse5` and `robots-parser`) in that folder first, with the exact versions the lockfile pins:

```bash
npm ci --ignore-scripts
```

From a local copy, for one session:

```bash
claude --plugin-dir /path/to/seekwide
```

As an installed plugin, using this repository as its own marketplace:

```bash
claude plugin marketplace add /path/to/seekwide
```

```bash
claude plugin install seekwide@seekwide
```

When Claude Code installs the plugin from a marketplace it fetches, such as this repository on GitHub, it copies the plugin into its own cache and installs the two dependencies there itself, from `package-lock.json`: the exact versions it pins, with npm from your `PATH` and without running any package's install scripts.

## Commands

| Command | What it does | Default page budget |
|---|---|---|
| `/seekwide:basic [url]` | Quick SEO and link audit | 25 |
| `/seekwide:seo [url]` | Technical and on-page SEO audit, with suggested titles and descriptions | 100 |
| `/seekwide:links [url]` | Link audit, including external links | 100 |
| `/seekwide:security [url]` | Signs that the site was hacked or misused, and the security headers of its start page | 100 |
| `/seekwide:media [url]` | Images and video: alt text, sizes, formats, broken files, robots.txt for Google, captions and video structured data | 100 |
| `/seekwide:all [url]` | Every installed module in one report | 200 |
| `/seekwide:fix [run-id]` | Fix metadata findings of an audit of the project in this folder, with your approval for each change, then audit again to verify | The first audit's |
| `/seekwide:report [run-id]` | Rebuild a report, brand it, or compare two audits | — |
| `/seekwide:setup [url]` | Save a project profile and report branding | — |

Audit commands accept `--pages N` to change the page budget and `--compare` to show what changed since the previous audit in the same folder. `/seekwide:basic`, `/seekwide:seo` and `/seekwide:all` also accept `--no-cwv`, which skips Core Web Vitals so that nothing is sent to Google.

To audit a site running on your own machine, give a `localhost` or `127.0.0.1` URL. Seekwide then connects to that address and port only; it never follows a link, a redirect or a sitemap to another local port.

## Auditing a project in its folder

Run an audit command without a URL (or with `--repo`) inside a web project, and Seekwide audits the project itself:

1. It looks at the folder to see what kind of project it is. **Next.js with the App Router** and **plain HTML** are supported. For anything else it says so in plain words, and you can still audit the site by its address.
2. Claude proposes the command that starts the project's local server: the project's own `dev` script (for example `npm run dev`), or Python's built-in static server for a plain HTML folder, bound to `127.0.0.1`. **Nothing starts without your approval**: the plugin tells Claude to ask you in the conversation first, in every permission mode, because starting a dev server runs the project's code; Claude also shows the scripts that command runs. The plugin's own server never starts or runs anything. If the server is already running, give its `localhost` address and nothing is started.
3. The local address is crawled like any other site.
4. Each finding gets `source`: the file, the route and, for plain HTML, the line.

| Project | `source.file` | `source.line` | `source.route` |
|---|---|---|---|
| Next.js App Router | The file of the route that answers the URL: `page.*`, a route handler (`route.*`), a metadata file (`robots.*`, `sitemap.*`, `opengraph-image.*` and the like) or a file in `public/`. Route groups, dynamic segments and catch-all segments are followed. For a missing `lang` attribute or viewport: the root layout | Not given | `/blog/[slug]` |
| Plain HTML | The file the server sent for the URL | The line of the element; the `<head>` for a missing title, description, canonical, viewport or Open Graph tag; none when no one line is the place (a missing `h1`, thin content) | The URL path |

What to know:

- **The source is never read to guess what a page contains.** A title made at request time (`generateMetadata`) exists only in the page the server sends, and that page is what the audit measures. The file only says where a fix belongs.
- **Next.js: the file is the starting point.** The plugin does not read the project's code, so it gives no line, and an element shared by several pages (navigation, footer) usually lives in a layout or a component the page imports. A route is named only when the server's answer fits it: a URL that redirected or answered 404 gets no file, and a route with a dynamic segment (`[slug]`) is named only for a URL that answered 200. The settings in `next.config` are not read. When the file mentions `basePath`, `rewrites` or `pageExtensions`, the audit says so, because a URL those settings change gets no source file; with `basePath` or `rewrites`, routes with a dynamic segment are not named at all, and a route of fixed segments that the setting moves can still be named wrongly. Routes in a `pages/` folder are not mapped.
- **Next.js: a canonical sent in the body is a likely finding.** Next.js 15.2 and later can append a page's title, description and canonical link to `<body>` when the metadata is not ready in time ([streaming metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata#streaming-metadata)). Google documents that a canonical link in the body is ignored, and Next.js states that crawlers which run JavaScript read streamed metadata correctly. Seekwide cannot settle that, so it reports such a page as `seo.canonical.streamed_in_body` with confidence `likely`, says how to get the metadata into the head, and does not report it as a plain misplaced canonical. This applies to audits of live sites as well.

- **Plain HTML: a file is named only when it is what the server sent.** If the page the server sent differs from the file (an edit after the crawl, or a server that rewrites pages), the finding gets no source file and the audit says how many files differed.
- **Some findings have no file**: a missing sitemap, or a property of the server such as HTTPS. On a local server the HTTPS findings describe the dev server, not your live site.
- **Core Web Vitals are not measured** for a local site. Its address is never sent to Google.
- The project folder is the boundary. Symbolic links are not followed, `node_modules` and dot folders are not read, and nothing in the project is imported or executed by the plugin. File paths in the stored run and in the reports are relative to the project folder.

**Monorepos.** When the folder you run the command in is the root of a monorepo (npm, Yarn or Bun `workspaces` in `package.json`, or `pnpm-workspace.yaml`) and not a web project itself, Seekwide lists the workspaces that are supported web projects, and Claude asks which one to audit. The command then runs in that folder, the package manager and the installed dependencies are found at the workspace root too, and files are named as paths from the root (`apps/web/app/pricing/page.jsx`). Workspace patterns of plain folder names, with or without a final `/*`, are expanded; `**` and negations are not.

**Tested with** Next.js 15.5 (`next dev`) and 16.4 (`next dev` and `next start`), JavaScript and TypeScript, `app/` and `src/app/`, and an npm workspaces monorepo; the fixtures for each are under `fixtures/`. Next.js 16.4's `next dev` may write an `AGENTS.md` file into the project; that file comes from Next.js, not from Seekwide. On Windows the static server for a plain HTML folder is proposed as `python`, not `python3`.

## Fixing findings

`/seekwide:fix` works on a saved audit of the project in the current folder (run `/seekwide:seo` without a URL first). It never works on a site audited by URL only, because then there is no source file to change, and it never fixes something no finding reports.

What it can fix, and where the change goes:

| Finding | Next.js App Router | Plain HTML |
|---|---|---|
| Missing or duplicate title or meta description | The `metadata` export or `generateMetadata` of the page file | `<title>` and `<meta name="description">` in the `<head>` |
| Missing canonical | `alternates.canonical` on the page, `metadataBase` in the root layout | `<link rel="canonical">` in the `<head>` |
| Missing Open Graph title or image | `openGraph` in the page's metadata | `<meta property="og:…">` in the `<head>` |
| No sitemap | `app/sitemap.js` (or `.ts`), and the sitemap line in `app/robots.js` or `robots.txt` | `sitemap.xml`, and the `Sitemap:` line in `robots.txt` |

How it goes:

1. The plugin reads the saved run and says, for each finding, whether a fix exists, which file it belongs in and what the page sends today. A finding it cannot fix safely is listed with the reason and left alone: for example a second `<title>` in a Next.js project, where the plugin cannot tell which file writes it, or a canonical that Next.js streamed into the body, which is a choice about the project and not a tag to move.
2. Claude reads the file and shows you the change as a diff. A new title or description is Claude's suggestion and is labelled as one.
3. **Nothing is written until you say yes**, for one change or for the set. Claude then edits the file with its normal tools, so Claude Code's own permission prompts apply too. **Nothing is committed.**
4. The local server is crawled again and the run is saved as a run of its own. For each fixed finding the report says:
   - **Closed**: the finding is gone, and the check measured the same page again.
   - **Still open**: it is still reported.
   - **Replaced**: it is gone, but the page now has another finding of the same kind (a title was added and is a duplicate).
   - **Not verified**: it is gone, but the check did not look at the page this time (not crawled, an error status, no longer indexable). Nothing is claimed.

Canonical links, `og:image` and sitemaps contain the address your site is deployed at, which a local server does not know. Give it with `--site https://www.example.com`, or save it once with `/seekwide:setup`; Claude asks when it is missing and never guesses a domain. During the second audit that address is passed to the crawl, so that a canonical link, a link or a sitemap entry on it is read as the same page on the local server, and a page linked only by its full deployed address is crawled too. The audit requests nothing from the deployed site: a crawl of a local server sends no request to any other address, and the other links to the deployed site are left out of the external link check. The address has to be the one your pages name, scheme and host name included; when it matches nothing, the audit says so and names the address the pages use.

Limits: an `og:image` is added only when the project has an image for it; a route with a dynamic segment needs its value built in `generateMetadata`, which Claude writes from the data the route already uses or asks about; MDX pages are not changed. A fix verified on a dev server should be audited again on the live site after it ships.

## How the scores work

Each module gets a score from 0 to 100. Every check looks at a set of pages or links, and each one passes or fails. The module score is the weighted average of the checks' pass rates, with weights from 1 to 5 that follow severity. It is rounded to a whole number, and 100 is kept for a module with no failure in a scored check: one failure makes it 99 at most.

- **Info checks** are rules of thumb, such as title length. They are reported and never change a score.
- **Coverage** is the share of a module's checks that could run. A check that needs a complete crawl, an XML sitemap or Core Web Vitals data is skipped when the audit does not have it, and the report says why. Score and coverage are always shown together.
- **Confidence** is `confirmed` for a measured fact and `likely` for a strong signal that can have a legitimate exception.

There is no single overall score on purpose: a blocked site and a long title do not add up to one meaningful number.

The security headers are counted, not scored: the report says "0 of 3 recommended headers set", because a score of 0/100 for three headers of one page reads like a verdict on the site.

## Core Web Vitals

Core Web Vitals are part of the `seo` module. Google does the measuring, in two ways:

| | Lab data | Field data |
|---|---|---|
| What it is | One simulated load of the page on an emulated mid-range phone | What real Chrome users on phones experienced over the last 28 days |
| Source | PageSpeed Insights API | Chrome UX Report API |
| Metrics | LCP, CLS, Total Blocking Time (the lab stand-in for INP) | LCP, INP, CLS, at the 75th percentile |
| Covers | Each measured page | The whole site, and each measured page with enough visits |
| Confidence | `likely`: one run, and values change from run to run | `confirmed`: a measured fact about real visits |

A value passes when it is in Google's "good" range: LCP of 2.5 s or less, INP of 200 ms or less, CLS of 0.1 or less, Total Blocking Time of 200 ms or less.

**The Google API key is optional, and without it you get no Core Web Vitals today.** The Chrome UX Report API requires a key. PageSpeed Insights accepts requests without one in principle, but when this was built (November 2026) Google refused every keyless request with "quota exceeded". The audit never fails because of that: the six Core Web Vitals checks are reported as skipped with the reason, and the coverage figure shows it.

To get a key, create an API key in the Google Cloud console and enable the PageSpeed Insights API and the Chrome UX Report API for its project. Then run `/plugin` in Claude Code, pick Seekwide on the Installed tab, choose "Configure options" and paste the key into "Google API key". Claude Code keeps it in your system's secure storage. Enter the key in that field only: a key pasted into a chat with Claude becomes part of the conversation.

The plugin's server gets the key when it starts. A Claude Code session that was already open when you saved the key keeps running without it and reports that no key is set; start a new session to use it. `claude plugin configure seekwide@seekwide` shows which settings are saved, without showing the key. A saved value that no request can carry (one with a space or a line break inside, a character outside plain ASCII, or more than 256 characters) is reported as a key that cannot be used, and then nothing is sent to Google.

Core Web Vitals are measured once per crawl. Another audit of the same crawl, with the same number of pages, rates the same numbers again and says that it reused them, so two audits of one crawl cannot disagree because a lab test came out differently. Crawl again for a new measurement. A measurement in which Google returned nothing is not kept, so the next audit asks again.

Field data exists only for sites and pages with enough visits from Chrome users. A small site often has none, and that says nothing about its speed.

## Security signals

Google can warn searchers about a hacked site or show its pages lower. A hack is usually built so that the owner does not notice it, so the `security` module looks for what an owner does not see:

| Check | What it reports | Confidence |
|---|---|---|
| Hidden link to another site | Links that the page's own markup hides (`display:none`, the `hidden` attribute, `visibility:hidden`, a font size of 1 pixel or less, a box moved 1000 pixels or more off its place, a box of 2 pixels or less that clips its content) or that sit on a single punctuation character, to sites that no visible link on the crawled pages goes to | likely |
| Spam terms the site is not about | Two or more matches of pharmaceutical, gambling or counterfeit-goods spam terms in a page's text and link addresses, when the start page's title, description and headings are about something else | likely |
| Page in a writing system the site does not use | A large part of a page in, say, Japanese or Cyrillic on a site that hardly uses it, when the page's `lang` does not declare that language | likely |
| Hidden frame from another site | An `<iframe>` of 2 pixels or less, or hidden by its markup, that loads another site | likely |
| Script or frame from a site no other page uses | Code worth a look; a video or map on one page shows up here too | info |
| Security headers of the start page | Strict-Transport-Security, `X-Content-Type-Options: nosniff`, clickjacking protection (`frame-ancestors` or X-Frame-Options), Content-Security-Policy, and a referrer policy that sends full addresses to other sites | confirmed |

What to know:

- **It sends nothing new.** The module reads the pages the crawl fetched anyway, with the same user agent and robots.txt rules. It requests no path the site does not link to or list (no `/wp-admin/`, `/.env` or `/.git/`), tries nothing against the site, and never pretends to be Google or a browser.
- **A clean result is not proof of a clean site.** Many hacks show their spam only to Google's crawler or to visitors who arrive from a Google search. Search Console's Security issues report is where Google says what it found.
- **Content a visitor opens is not hidden.** Google allows tabs, accordions, menus and pop-ups, so an element built to be opened does not count: a dialog, menu, tab panel or popover, content right after a control marked with `aria-expanded`, or an element whose `id` a control on the page names (`aria-controls`, `data-bs-target`, a link to `#its-id`). A link to a site that is linked visibly on any crawled page does not count either, and neither does a link to the same organisation's other domains (acme.de from acme.com) or a share link of the page on a known share service (Facebook, X, LinkedIn, Pinterest, WhatsApp, Telegram, Reddit, Tumblr, VK, Mastodon Share). On a shared hosting domain such as `vercel.app`, `github.io` or `myshopify.com`, another customer's host is another site. Not read: style sheets, classes and scripts; `opacity: 0`, which animated pages use for content they fade in; and white text on a white background, which needs rendering. A menu or slider that a script opens without any of these marks can still be reported, which is why the finding is `likely` and shows the element.
- **Security headers are not Google ranking factors.** They protect visitors, and the audit counts them ("2 of 3 recommended headers set") instead of scoring them. Google's page experience documentation lists HTTPS but no security header, and Google has said that the HSTS header does not affect Search. They are checked on the start page and only for a deployed site: the headers of a server on your own machine say nothing about the live one.
- **Findings are signs, not verdicts.** Every signal except the headers can have a legitimate exception, so it is `likely`, and each finding shows the element, the terms or the frame it is about.
- **Not checked yet:** outdated WordPress core, plugins and themes. A plugin's version cannot be read reliably from a page, and the vulnerability databases that allow use by agencies need an account of each user's own. Admin accounts, file integrity and backups cannot be seen from outside; the report lists them as things to check by hand.

## Images and video

The `media` module checks what search engines and visitors get from a site's images and videos:

| Check | What it reports | Confidence |
|---|---|---|
| Image without alt text | An `<img>` with no `alt` attribute and no other text alternative (`aria-label`, `aria-labelledby`, `title`). `alt=""` marks a decorative image and is never reported | confirmed |
| Alt text that is a file name or a placeholder | `alt="IMG_0423"`, `alt="chart.jpg"`, `alt="image"`, `alt="0001"`: text that WCAG lists as no alternative | confirmed |
| Image without width and height | A content image (not in the navigation, header, footer or sidebar) with no size in its markup, inline style or utility classes, so the page can jump when it arrives. A style sheet often reserves the space, which the crawler does not read, so it does not change the score | info |
| Main image is lazy-loaded | An image the page marks as its most important one (`fetchpriority="high"` or a preload) that also has `loading="lazy"` | confirmed |
| Broken image | The file answers 404 or 410 | confirmed |
| JPEG, PNG or BMP instead of WebP or AVIF | A file of 32 KiB or more that comes back in a legacy format although the request accepted WebP and AVIF, from a server that does not say it picks the format per browser | likely |
| Image file over 500 KiB | A rule of thumb; it does not change the score | info |
| Image blocked for Google by robots.txt | A content image on the site's own domain that the robots.txt of its host keeps from Googlebot or Googlebot-Image | likely |
| Video without captions | A `<video>` that may have sound and has no `<track kind="captions">`. Whether it has speech cannot be told from the page | info |
| VideoObject missing a required property | `name`, `thumbnailUrl` or `uploadDate` | confirmed |

What to know:

- **Image files are checked with a few small requests.** Up to 50 per audit, taken page by page, after the external links are checked. The robots.txt of each host the images are on is read first and obeyed; then each file gets a `HEAD` request that says WebP and AVIF are accepted, as a browser's would, and a `GET` that reads at most 1 KiB when the `HEAD` says too little. No image is downloaded whole, and every request carries the crawler's own user agent. A tracking pixel is never requested, and a site that challenged or rate-limited the crawler gets no image request.
- **It is the image host's robots.txt that counts.** Google reads the robots.txt of the host that serves an image, so an image on a CDN is governed by the CDN's file, not the site's.
- **Some findings need a second look.** A style sheet can reserve an image's size, which the crawler does not read. A server can choose the image format by the browser it sees rather than by what the request accepts, and this crawler never claims to be a browser; files whose server says so are left out. Captions can be part of the picture or loaded by a player script. Those findings are `likely` or informational.
- **Measured on real sites.** Before release the module was run on 19 real sites and a sample of its findings was judged by hand; the rules that were often wrong or not worth acting on were narrowed, made informational or removed (a check for pages with a video and no `VideoObject` was removed, because which page is a watch page cannot be told from its markup).
- **Not measured:** what an image shows (so whether alt text fits it), images and videos that scripts add, images in CSS backgrounds, and images much larger than the box they are shown in, which needs layout. Fixes for images come later.

## Files it writes

Run audits from the folder that belongs to the site. An agency keeps one folder per client.

```
.seekwide/
  .gitignore              keeps audit data out of git
  profile.json            from /seekwide:setup
  runs/index.json         audit history
  runs/<run-id>/findings.json
  runs/<run-id>/report.md
  runs/<run-id>/report.html
```

Crawl results are cached in the plugin's data directory, each with the Core Web Vitals measured for it, and can be deleted at any time.

That is all the plugin's own server writes. Apart from that `.seekwide/` folder inside the project folder, it never creates or changes a file of your project. The changes `/seekwide:fix` makes are made by Claude with Claude Code's file tools, after you approved each diff.

## Network and data

Seekwide has no telemetry and no backend. This is everything it sends or fetches:

| Where | What | When |
|---|---|---|
| The site you audit | HTTP requests for pages, `robots.txt` and XML sitemaps, and, for a file that one of its redirects leads to, a `HEAD` request (then a `GET` that reads at most 16 KB when the HEAD fails or answers with an error status), with the user agent `seekwide/<version> (+https://github.com/omerbatutandogan/seekwide)`. If the start URL redirects to another host, that host becomes the site. | Every audit |
| Sites the audited site links to | The `robots.txt` of each site, then a `HEAD` request for the link, and a `GET` when the HEAD fails or answers with an error status. At most 50 links are checked, each through at most 5 redirects. A redirect step gets the same requests, and only when the robots.txt of the site it leads to allows it. This also covers the destination of a redirect that leaves the audited site. | Audits that include the `links` module |
| Hosts that serve the audited pages' images (the site itself, or a CDN) | The `robots.txt` of each host, then for each image a `HEAD` request that says AVIF and WebP are accepted, and a `GET` for its first byte (`Range: bytes=0-0`, reading at most 1 KiB) when the HEAD fails, answers with an error status or gives no size. At most 50 images per audit, each through at most 5 redirects, one request per host at the crawl's rate (one a second by default; slower when the host's robots.txt asks), after the external link check and never at the same time, and nothing new after 90 seconds. A tracking pixel and video files are never requested. | Audits that include the `media` module, except when the site challenged or rate-limited the crawler (then nothing on its own host). For a site on your own machine only images on its own address are requested |
| Google PageSpeed Insights API (`pagespeedonline.googleapis.com`) | The URL of each page whose Core Web Vitals are measured: 3 pages with `/seekwide:basic`, 5 with `/seekwide:seo` and `/seekwide:all`, never more than 10. One request per page, with your Google API key when one is set. Google then loads those pages itself to test them. | Audits that include the `seo` module, unless you pass `--no-cwv`, the site is on your own machine, or the Google API key that is set cannot be used. Once per crawl: another audit of the same crawl reuses the numbers |
| Google Chrome UX Report API (`chromeuxreport.googleapis.com`) | The origin of the site and the URLs of the same pages, one request each (4 with `/seekwide:basic`, 6 with `/seekwide:seo` and `/seekwide:all`, never more than 11), with your Google API key | The same audits, and only when a Google API key is set |
| Anthropic | Tool results that Claude reads during the session: scores, findings, Core Web Vitals values, and short page excerpts when Claude drafts a suggestion | Every audit, as part of your Claude Code session |

The `security` module adds nothing to this table: it reads the pages the crawl already fetched. The `media` module adds the row on image hosts.

Nothing else leaves your machine. What Claude reads is covered by the terms of your Claude account. If you audit a client's site, the findings and page excerpts become part of your Claude session.

The Google API key is sent to those two Google APIs only, in a request header and never in a URL. It is not written to `.seekwide/`, to the crawl cache or to a log. The tools that Claude calls are not given the key and return nothing that contains it, so Claude never sees it. A site on your own machine or on a private network address is never named to Google.

`/seekwide:fix` sends nothing anywhere new either. Its plan is made from the saved run and from what repo mode reads of the project (file names, `package.json`, the text of `next.config`); the source files Claude reads to write a change, and the diffs it shows, are part of your Claude session like any file Claude reads. The deployed address you give for canonical links and sitemaps is written into your files and used to interpret the local crawl; the audit does not contact it.

Repo mode sends nothing anywhere new. It reads file names in the project folder, `package.json`, and the HTML files that were served as pages, all on your machine. The file paths it finds (relative to the project folder) and the text of the project's `dev` script become part of the tool results that Claude reads, like the rest of the audit. The local server is started by Claude Code, with your approval, not by the plugin.

Pages, sitemaps and redirect targets on other hosts are never fetched during the crawl. The one exception is a `robots.txt` that redirects to another host: it is read from there, as search engines do. An audit of a site on your own machine does not make that exception: it requests nothing outside the local address. Seekwide refuses to connect to private network addresses, and to `localhost` unless that is the site you asked it to audit.

## Settings

All three are optional. Set them in Claude Code: run `/plugin`, pick Seekwide on the Installed tab and choose "Configure options".

| Setting | Meaning |
|---|---|
| Report brand name | Shown as "Prepared by" on reports |
| Report logo file | Absolute path to a PNG, JPEG, WebP or SVG of 200 KB or less |
| Google API key | Lets audits measure [Core Web Vitals](#core-web-vitals). Kept in your system's secure storage |

A project profile (`/seekwide:setup`) overrides them for one client.

## Roadmap

Planned, in this order, and not built yet:

1. Alt text written from the image itself, and fixes for images and internal links.
2. Answer and AI search readiness, entity checks against Wikidata, E-E-A-T, international, local, programmatic pages, conversion.
3. Search Console and Bing Webmaster Tools data, backlinks, measured AI visibility, app stores and social search.
4. WordPress core and plugin vulnerabilities, using Wordfence Intelligence with your own key.

Seekwide will never pretend to be a search engine's crawler to look for cloaking.

## Development

```bash
npm ci
```

```bash
npm test
```

```bash
claude plugin validate . --strict --profile directory
```

```bash
node scripts/check-directory-rules.js
```

CI runs the tests on Linux, macOS and Windows with Node.js 22 and 26; the type check, the generated docs, the directory rules and `claude plugin validate` run on Linux.

The skill flows (asking before a dev server starts, stopping it, showing diffs before a fix, the wording of suggestions, blocked crawls and security findings) are covered by an eval suite under [`evals/`](evals/README.md), run with `claude plugin eval`. It drives a real Claude session, so it costs tokens and is not part of CI.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes the modules and their contracts. [docs/CHECKS-SPEC.md](docs/CHECKS-SPEC.md) specifies every check. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE)
