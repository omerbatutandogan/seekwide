# Check specification (rules 0.1.2)

Every scripted check the plugin ships is defined here. The code in `server/src/checks/` implements this table exactly; `docs/checks.md` is generated from the code for users.

## How to read the tables

- **Unit**: what the check counts. It returns one result (pass or fail) per unit and nothing for anything else. The score uses the pass rate over units.
- **Fails when**: the condition for a `fail` result. Everything else in the unit set is a `pass`.
- **Sev / W**: severity and weight. Weight 0 means the check never changes the score; those are `info` checks based on rules of thumb.
- **Conf**: `confirmed` is a measured fact. `likely` is a strong signal that can have a legitimate exception.
- **Needs**: capabilities the audit must provide. The crawl provides `full_crawl`, `sitemap` and `robots`; the external link check provides `outbound`; the Core Web Vitals measurement provides `lab_data` and `field_data`. The engine skips the check otherwise, with the reason the collector gave.
- **Doc**: key into the reference list at the end.

Terms:

- *html page*: a record with status 200 and `is_html` (`ctx.htmlPages`).
- *indexable page*: a record with `indexability.indexable` (`ctx.indexablePages`).
- *effective canonical*: an entry in `page.canonicals` with `in_head: true` and a non-null `url`.
- *noindex*: `indexability.reasons` contains `noindex_meta` or `noindex_header`.
- *could not read*: `isUnverifiable(record)` is true. The site's firewall challenged the crawler, the site rate-limited it, or a redirect led to a URL that robots.txt disallows. That says something about the audit and nothing about the site, so such a record is never a unit and never a broken target.
- *start page*: `ctx.resolve(crawl.start_url)`.
- *tested page*: an entry of `ctx.vitals.pages`, one of the few pages whose Core Web Vitals were measured.

Evidence strings taken from a page are clipped with `clip()`. `related_urls` are sorted.

## Source files (repo mode)

A finding can carry `source: {file, line, route}`: the file of the user's project that the finding comes from. It is added after the checks ran, by `repo/sources.js` (ARCHITECTURE.md 4.12), only in an audit that was given a source folder, and only where the file can be determined. It is not part of a check's result, of the finding id or of the score, so the same crawl gives the same ids with and without it.

- `file`: path relative to the project folder.
- `line`: the line of the element in `file`, or null. Given for HTML files only.
- `route`: the Next.js route (`/blog/[slug]`) or the URL path.

No source is given to a site-level finding without a URL, to `seo.https.site_not_https`, `seo.https.not_enforced` and `seo.cwv.*` (they are about the server or about Google's measurements), or to a finding whose URL no file of the project answers. In a Next.js project that includes a URL that redirected or answered 404, and a URL that only a route with a dynamic segment matches unless it answered 200.

## SEO module (`checks/seo/`)

### Site level (`scope: 'site'`)

| Id | Unit | Fails when | Sev / W | Conf | Needs | Doc |
|---|---|---|---|---|---|---|
| `seo.robots.unreachable` | One unit, `url` = robots.txt URL | `robots.status` is `unreachable` (429, 5xx or no answer; more than five redirects count as a missing file, as they do for Google) | high / 4 | confirmed | — | ROBOTS_SPEC |
| `seo.robots.disallow_all` | One unit when `robots.status` is `ok`, `url` = robots.txt URL | `disallows_all` or `disallows_all_googlebot` | critical / 5 | confirmed | — | ROBOTS_INTRO |
| `seo.sitemap.missing` | One unit, `url` = null, when sitemaps were looked for (`sitemap.loaded`). None when the crawl stopped before that, or when robots.txt lists no sitemap and `/sitemap.xml` could not be read: robots.txt does not allow it (the URL itself, or the URL it redirects to), or it redirects to another host | `sitemap.files` is empty | low / 1 | confirmed | — | SITEMAP_OVERVIEW |
| `seo.sitemap.file_error` | Each sitemap file, `url` = file URL. A file that was not read is not a unit: type `external` (on another host) or `disallowed` (robots.txt does not allow the crawler to request it, or could not be read) | file `type` is `unreachable` or `invalid` | medium / 3 | confirmed | — | SITEMAP_BUILD |
| `seo.indexing.homepage_noindex` | One unit when the start page is an html page | the start page is noindex | critical / 5 | confirmed | — | NOINDEX |
| `seo.https.site_not_https` | One unit, `url` = site origin | the site origin is not https | high / 4 | confirmed | — | HTTPS |
| `seo.https.not_enforced` | One unit when the site is https and `http_probe` is not null, `url` = probe URL | `http_probe.enforced` is false | high / 4 | confirmed | — | ENABLE_HTTPS |

### Page level (`scope: 'page'`)

| Id | Unit | Fails when | Sev / W | Conf | Needs | Doc |
|---|---|---|---|---|---|---|
| `seo.http.server_error` | Every record whose status is 200 or above and not 3xx, except records the crawler could not read (`isUnverifiable`) | status is 500 or above | high / 4 | confirmed | — | HTTP_STATUS |
| `seo.http.fetch_failed` | Every record, except records the crawler could not read (`isUnverifiable`) | status is 0 | medium / 3 | likely | — | NETWORK_ERRORS |
| `seo.redirect.chain` | Every redirect record (status 3xx) | `redirect_chain` has 2 or more hops | medium / 2 | confirmed | — | SITE_MOVE |
| `seo.redirect.broken` | Every redirect record, except one that leaves the site (`final_external`) or ends at a URL the crawler could not read | `fetch_error` is set (a loop, more than 10 hops, a bad `Location`, a failed request), or `final_status` is 400 or above | high / 4 | confirmed | — | HTTP_STATUS |
| `seo.title.missing` | Every indexable page | no title with non-empty text | high / 4 | confirmed | — | TITLE |
| `seo.title.multiple` | Every html page | more than one `<title>` | medium / 2 | confirmed | — | HTML_TITLE |
| `seo.title.duplicate` | Every indexable page that has a non-empty title. The first non-empty title is the one compared | another indexable page has the same title (compared lower-cased and whitespace-collapsed) | medium / 3 | confirmed | — | TITLE |
| `seo.title.too_long` | Every indexable page that has a non-empty title (the first non-empty one is measured) | estimated width is over 580 px (Arial, 20 px) | info / 0 | likely | — | TITLE |
| `seo.title.too_short` | Every indexable page that has a non-empty title (the first non-empty one is measured) | fewer than 10 characters | info / 0 | likely | — | TITLE |
| `seo.meta_description.missing` | Every indexable page | no meta description with non-empty content | low / 2 | confirmed | — | SNIPPET |
| `seo.meta_description.multiple` | Every html page | more than one meta description | low / 1 | confirmed | — | HTML_META_DESCRIPTION |
| `seo.meta_description.duplicate` | Every indexable page that has a non-empty meta description. The first non-empty one is compared | another indexable page has the same description (compared lower-cased and whitespace-collapsed) | low / 1 | confirmed | — | SNIPPET |
| `seo.meta_description.too_long` | Every indexable page that has a non-empty meta description (the first non-empty one is measured) | more than 160 characters | info / 0 | likely | — | SNIPPET |
| `seo.h1.missing` | Every indexable page | no `h1` with non-empty text | medium / 2 | confirmed | — | TITLE |
| `seo.h1.multiple` | Every indexable page | more than one `h1` with non-empty text | info / 0 | likely | — | HEADINGS |
| `seo.headings.skipped_level` | Every indexable page with one or more headings | a heading is more than one level deeper than the heading before it | info / 0 | likely | — | HEADINGS |
| `seo.canonical.missing` | Every indexable page, except one whose only canonicals are `streamed` (see `seo.canonical.streamed_in_body`) | no effective canonical | low / 1 | confirmed | — | CANONICAL |
| `seo.canonical.multiple` | Every html page with one or more effective canonicals | the effective canonicals name more than one distinct URL | high / 4 | confirmed | — | CANONICAL |
| `seo.canonical.outside_head` | Every html page with one or more canonicals from HTML that are not `streamed` | a canonical link element is outside `<head>` and is not marked `streamed` | medium / 2 | confirmed | — | CANONICAL |
| `seo.canonical.streamed_in_body` | Every html page with one or more canonicals from HTML | a canonical is marked `streamed`: a Next.js App Router page (inline `self.__next_f` data scripts) sent it in `<body>` together with the `<title>`. Google documents that a body canonical is ignored; Next.js states that crawlers which run JavaScript read streamed metadata correctly. Such a page is not a unit of `seo.canonical.missing` | medium / 2 | likely | — | CANONICAL |
| `seo.canonical.invalid` | Every html page with one or more canonicals | a canonical has a null `url` (empty, malformed or not http/https) | medium / 3 | confirmed | — | CANONICAL |
| `seo.canonical.relative` | Every html page with one or more canonicals | a canonical `href`, trimmed, does not start with `http://` or `https://` (in any letter case) | low / 1 | confirmed | — | CANONICAL |
| `seo.canonical.target_not_ok` | Every html page whose effective canonicals name exactly one URL, that URL differs from the page URL, a record exists for it, and the crawler could read it | the target's status is not 200, or it is not HTML, or it is noindex | high / 4 | confirmed | — | CANONICAL |
| `seo.canonical.cross_host` | Every html page with one or more effective canonicals | a canonical's host differs from the site host (compared with `hostKey`) | medium / 2 | likely | — | CANONICAL_TROUBLESHOOTING |
| `seo.indexing.noindex_in_sitemap` | Every html page listed in a sitemap | the page is noindex | high / 4 | confirmed | sitemap | SITEMAP_BUILD |
| `seo.sitemap.url_not_ok` | Every record listed in a sitemap, except records the crawler could not read | status is not 200 | medium / 3 | confirmed | sitemap | SITEMAP_BUILD |
| `seo.sitemap.url_canonicalized` | Every html page listed in a sitemap | `indexability.reasons` contains `canonical_elsewhere` | medium / 2 | confirmed | sitemap | SITEMAP_BUILD |
| `seo.https.mixed_content` | Every html page with an https URL | `mixed_content` is not empty | medium / 3 | confirmed | — | MIXED_CONTENT |
| `seo.mobile.viewport_missing` | Every html page | `viewport` is null or empty | medium / 3 | confirmed | — | RESPONSIVE |
| `seo.html.lang_missing` | Every html page | `html_lang` is null | low / 1 | confirmed | — | LANG |
| `seo.content.duplicate_body` | Every indexable page with 50 or more words and a non-empty `text_hash` | another such page has the same `text_hash` | medium / 3 | confirmed | — | CANONICAL |
| `seo.content.thin` | Every indexable page | fewer than 100 words | info / 0 | likely | — | HELPFUL_CONTENT |
| `seo.structured_data.invalid_json` | Every JSON-LD block on an html page, `selector` = `jsonld[<n>]` (1-based) | the block is not valid JSON | medium / 3 | confirmed | — | STRUCTURED_DATA |
| `seo.social.og_incomplete` | Every indexable page | `og.title` or `og.image` is missing | info / 0 | likely | — | OPEN_GRAPH |

Notes:

- Duplicate checks (`seo.title.duplicate`, `seo.meta_description.duplicate`, `seo.content.duplicate_body`) return a result for every page in the unit set. Failing results give the size of the group in `evidence` and list its other pages in `related_urls`. Evidence never copies page text in bulk: lists in evidence hold at most five entries.
- `seo.title.too_long` estimates width with Arial advance widths (units per em of 2048) at 20 px. Characters without a table entry count as 1139 units; CJK and other full-width characters count as 2048. Evidence: `{observed: {characters, estimated_px}, expected: '580 px or less'}`.
- `seo.canonical.multiple`: compare normalized URLs. A header canonical and a link element that name the same URL are not a conflict.
- Selectors: `head > title`, `meta[name=description]`, `link[rel=canonical]`, `h1`, `html`, `meta[name=viewport]`. Site-level checks use no selector.
- `http_probe` is null, so `seo.https.not_enforced` has no unit, when the http request failed or was refused (429 or a bot challenge), when robots.txt does not allow it, or when the site is on a port other than the default.
- A redirect that leads to a file and not a page (judged by its URL) is followed with a `HEAD` request. When the HEAD fails or answers 400 or above (429 and bot challenges excepted), a `GET` limited to 16 KB is sent and its answer is used. The answer sets the redirect's `final_status`, so `seo.redirect.broken` and `links.internal.broken` see it, but the file gets no record of its own.

### Core Web Vitals (`checks/seo/cwv.js`)

These checks read `ctx.vitals`, which `vitals/measure.js` collects from two Google services before the checks run (`docs/ARCHITECTURE.md`, 4.11). The checks themselves do no I/O.

| Id | Unit | Fails when | Sev / W | Conf | Needs | Doc |
|---|---|---|---|---|---|---|
| `seo.cwv.field_lcp` | The site's origin when the Chrome UX Report has a Largest Contentful Paint value for it (`url` = null, `selector` = `origin`), and each tested page it has a value for | the 75th percentile is above 2500 ms | medium / 3 | confirmed | field_data | LCP |
| `seo.cwv.field_inp` | The same, for Interaction to Next Paint | the 75th percentile is above 200 ms | medium / 3 | confirmed | field_data | INP |
| `seo.cwv.field_cls` | The same, for Cumulative Layout Shift | the 75th percentile is above 0.1 | medium / 3 | confirmed | field_data | CLS |
| `seo.cwv.lab_lcp` | Each tested page with a lab Largest Contentful Paint value | the value is above 2500 ms | low / 2 | likely | lab_data | LIGHTHOUSE_LCP |
| `seo.cwv.lab_cls` | Each tested page with a lab Cumulative Layout Shift value | the value is above 0.1 | low / 2 | likely | lab_data | CLS |
| `seo.cwv.lab_tbt` | Each tested page with a lab Total Blocking Time value | the value is above 200 ms | low / 1 | likely | lab_data | LIGHTHOUSE_TBT |

Notes:

- **Tested pages.** Measuring is slow and rate-limited, so only a few pages are measured: 3 by default, at most 10. The start page comes first when it is indexable. The other indexable pages are grouped by `templateSignature` (first path segment and number of segments), and one page is taken from each group, largest group first (then the group whose pages are closest to the start page, then by signature). Inside a group the page with the smallest `depth` is taken, then the first by URL; a page found only in the sitemap comes last. A slow template shows on every page that uses it, so one page per group says the most per request. When more pages are asked for than there are groups, the groups are gone through again for their next page. Each tested page records why it was chosen.
- **Field data** is what real Chrome users on phones experienced over the last 28 days, from the Chrome UX Report API (`formFactor: PHONE`). The value compared is the 75th percentile, as Google's own assessment does. Phones are used because the lab test also emulates a phone and because the documented thresholds are the mobile ones. The origin record covers every page of the site; a tested page has its own record only when it has enough visits. An origin or page the report has no data for is not a unit: that says the page has too few visits from Chrome users, nothing about its speed.
- **Lab data** is one simulated page load by PageSpeed Insights (`strategy: MOBILE`, `category: PERFORMANCE`), which runs Lighthouse on an emulated mid-range phone. Times are rounded to whole milliseconds and the layout shift score to three decimals before they are compared. A page PageSpeed Insights could not test is not a unit.
- **Interaction to Next Paint has no lab check.** A page load without a user has no interactions, so Lighthouse cannot measure it. Total Blocking Time is the lab stand-in; it is not a Core Web Vital, which is why it weighs least.
- **Confidence.** A field value is a measured fact about real visits, so the field checks are `confirmed`. A lab value comes from one simulated load and changes from run to run, so the lab checks are `likely`: a value near the threshold is worth a second run.
- **When the data is missing.** `field_data` is provided when the Chrome UX Report API answered for the origin or for a tested page, with a record or with "no data". Without a Google API key it is never provided, because that API requires one. `lab_data` is provided when PageSpeed Insights returned values for one or more tested pages. When Google refuses a request (no quota, a key it does not accept), does not answer in time, or the site is on the user's own machine (or the crawl does not record that it is not), the capability is missing and the checks that need it are skipped. The skip reason is the collector's plain statement of what happened. A missing capability never fails the audit.
- Evidence, field: `{observed: {p75_ms, rating, good_loads}, expected: 'A 75th percentile of 2500 ms or less', detail}`. For layout shift, `p75` replaces `p75_ms`. `rating` is `needs improvement` or `poor` (above 4000 ms, 500 ms and 0.25). `good_loads` is the share of page loads inside the good range, as a percentage, and is left out when Google's histogram does not use the same boundary. `detail` names the form factor, the collection period, and whether the value is for the whole site or for the page.
- Evidence, lab: `{observed: {lcp_ms | cls | tbt_ms, rating}, expected, detail}`. `rating` uses 4000 ms, 0.25 and 600 ms as the upper bounds of "needs improvement", the mobile bounds Lighthouse documents. When Google was redirected and tested another URL, `detail` names it: the finding stays on the tested page, because that is what a phone visiting it gets.
- Thresholds live in `vitals/thresholds.js`, so the checks and the reports cannot disagree.

## Links module (`checks/links/`)

| Id | Scope | Unit | Fails when | Sev / W | Conf | Needs | Doc |
|---|---|---|---|---|---|---|---|
| `links.internal.broken` | page | For each html page, each distinct internal link target that has a record. Not a unit when the crawler could not read the target, or the target redirects off the site or to a URL the crawler could not read. `url` = the linking page, `selector` = `a[href="<raw href>"]` of the first such link | the target's `final_status` is 0 or 400 and above | high / 4 | confirmed | — | HTTP_STATUS |
| `links.internal.redirect` | page | For each html page, each distinct internal link target that has a record | the target is a redirect record and its chain ends in a 200–399 response, leaves the site, or ends at a URL the crawler could not read | low / 2 | confirmed | — | SITE_MOVE |
| `links.internal.nofollow` | page | For each html page, each distinct internal link target | any link to that target on the page has `nofollow` in `rel` | low / 1 | confirmed | — | QUALIFY_LINKS |
| `links.internal.insecure` | page | When the site is https: for each html page, each distinct internal link target | the link's URL starts with `http://` | low / 1 | confirmed | — | ENABLE_HTTPS |
| `links.anchor.uncrawlable` | page | Every `<a>` element on an html page, internal or not | the trimmed `href` starts with `javascript:` (any case), or `href` is empty and the element has `onclick` | medium / 2 | confirmed | — | LINKS |
| `links.anchor.empty` | page | Every `<a>` element with a non-null `url` on an html page | `text` is empty and both `aria_label` and `title_attr` are null. `text` already holds image `alt` text and the `aria-label` of elements inside the link | medium / 2 | confirmed | — | LINKS |
| `links.anchor.generic` | page | Every `<a>` element with a non-null `url` and non-empty `text` on an html page | the text, lower-cased with punctuation removed, is in the generic-anchor list | info / 0 | likely | — | LINKS |
| `links.orphan.sitemap_only` | site | Every internal sitemap URL other than the start URL and the start page's URL, `url` = that URL | no html page links to it, directly or through a redirect | medium / 2 | likely | full_crawl, sitemap | LINKS |
| `links.depth.deep` | page | Every indexable page with a non-null `depth` | `depth` is greater than 4 | info / 0 | likely | — | SITE_STRUCTURE |
| `links.outbound.broken` | page | Every external URL in `ctx.outbound` whose outcome is not `unverifiable`. That covers external link targets and the destinations of redirects that leave the site. `url` = the first page (sorted) that links to it, or to the internal URL that redirects there; `selector` = `a[href="<raw href>"]`; `related_urls` = the other linking pages | outcome is `broken` | medium / 2 | likely | outbound | HTTP_STATUS |

Notes:

- "Distinct internal link target" means distinct normalized `link.url` values among links with `internal: true` and a non-null `url`. A page that links to itself is included.
- `links.internal.broken` and `links.internal.redirect` look the target up in `ctx.pageByUrl`. A target with no record (not crawled) is not a unit.
- The crawl does not fetch pages of other sites; a robots.txt that redirects to another host is the one thing it reads from there. A redirect that leaves the site has `final_external: true` and `final_status` 0; its destination is checked with the external links, and a broken one is reported by `links.outbound.broken` on the page that links to the redirecting URL.
- External link results: `broken` means 404, 410, or a host name that does not exist. A site that refuses automated requests, a robots.txt rule, a timeout or a temporary DNS failure gives `unverifiable`, which is not a unit.
- `links.orphan.sitemap_only`: build the set of linked URLs from every internal link on every html page, adding `ctx.resolve(link.url)?.url` so a link to a redirect counts for its destination. A link from a page to itself does not count.
- Selectors of the form `a[href="…"]` escape `\` and `"` inside the href.
- Generic-anchor list (compared after lower-casing and removing punctuation): English "click here", "here", "read more", "more", "learn more", "this", "link", "this link", "this page", "continue", "continue reading", "details", "more info", "more information"; Turkish "tıklayın", "buraya tıklayın", "burada", "buraya", "devamı", "devamını oku", "daha fazla", "detaylar", "incele"; German "hier", "hier klicken", "mehr", "weiterlesen", "mehr erfahren"; Spanish "aquí", "haz clic aquí", "leer más", "más", "ver más"; French "ici", "cliquez ici", "lire la suite", "en savoir plus", "plus".

## Reference list

Each check's `doc_ref` is one of these URLs. Every page was fetched and read against its rule on 2026-11-11, which is the `last_verified` date in the code. When you change a rule, read its page again and update the date.

| Key | URL |
|---|---|
| ROBOTS_INTRO | https://developers.google.com/search/docs/crawling-indexing/robots/intro |
| ROBOTS_SPEC | https://developers.google.com/crawling/docs/robots-txt/robots-txt-spec |
| NOINDEX | https://developers.google.com/search/docs/crawling-indexing/block-indexing |
| CANONICAL | https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls |
| CANONICAL_TROUBLESHOOTING | https://developers.google.com/search/docs/crawling-indexing/canonicalization-troubleshooting |
| SITEMAP_OVERVIEW | https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview |
| SITEMAP_BUILD | https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap |
| TITLE | https://developers.google.com/search/docs/appearance/title-link |
| HTML_TITLE | https://html.spec.whatwg.org/multipage/semantics.html#the-title-element |
| SNIPPET | https://developers.google.com/search/docs/appearance/snippet |
| HTML_META_DESCRIPTION | https://html.spec.whatwg.org/multipage/semantics.html#meta-description |
| HTTP_STATUS | https://developers.google.com/crawling/docs/troubleshooting/http-status-codes |
| NETWORK_ERRORS | https://developers.google.com/crawling/docs/troubleshooting/dns-network-errors |
| SITE_MOVE | https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes |
| LINKS | https://developers.google.com/search/docs/crawling-indexing/links-crawlable |
| QUALIFY_LINKS | https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links |
| SITE_STRUCTURE | https://developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure |
| RESPONSIVE | https://web.dev/articles/responsive-web-design-basics |
| HTTPS | https://web.dev/articles/why-https-matters |
| ENABLE_HTTPS | https://web.dev/articles/enable-https |
| MIXED_CONTENT | https://web.dev/articles/what-is-mixed-content |
| LANG | https://www.w3.org/WAI/WCAG22/Understanding/language-of-page.html |
| HEADINGS | https://www.w3.org/WAI/tutorials/page-structure/headings/ |
| STRUCTURED_DATA | https://developers.google.com/search/docs/appearance/structured-data/sd-policies |
| HELPFUL_CONTENT | https://developers.google.com/search/docs/fundamentals/creating-helpful-content |
| OPEN_GRAPH | https://ogp.me/ |
| LCP | https://web.dev/articles/lcp |
| INP | https://web.dev/articles/inp |
| CLS | https://web.dev/articles/cls |
| LIGHTHOUSE_LCP | https://developer.chrome.com/docs/lighthouse/performance/lighthouse-largest-contentful-paint |
| LIGHTHOUSE_TBT | https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time |

The Core Web Vitals measurement rests on these pages as well. They were read on 2026-11-11, together with the machine-readable description of each API (PageSpeed Insights revision 20261109, Chrome UX Report revision 20261110):

| Subject | URL |
|---|---|
| The thresholds, the 75th percentile, and Total Blocking Time as the lab stand-in for Interaction to Next Paint | https://web.dev/articles/vitals |
| The good, needs-improvement and poor ranges of the field metrics, and how Google assesses a page | https://developers.google.com/speed/docs/insights/v5/about |
| PageSpeed Insights API: endpoint, parameters and response | https://developers.google.com/speed/docs/insights/rest/v5/pagespeedapi/runpagespeed |
| PageSpeed Insights API: Google plans to stop including Chrome UX Report data in its response and recommends the Chrome UX Report API | https://developers.google.com/speed/docs/insights/v5/get-started |
| Chrome UX Report API: endpoint, request, metric names, the API key requirement, and the limit of 150 queries a minute | https://developer.chrome.com/docs/crux/api |
| Chrome UX Report API: the "not found" answer for an origin or page without enough data | https://developer.chrome.com/docs/crux/guides/crux-api |
| Which pages and origins the Chrome UX Report includes | https://developer.chrome.com/docs/crux/methodology |
| Sending a Google API key in the `x-goog-api-key` header, so that it is not part of a URL | https://cloud.google.com/docs/authentication/api-keys-use |

Observed on 2026-11-11, not documented: a PageSpeed Insights request without an API key was refused with HTTP 429, because the daily quota of the shared keyless project was 0. The Chrome UX Report API refuses a request without a key with HTTP 403.

Rules without direct official support, kept on purpose and marked accordingly:

- `seo.content.thin`: Google states that it has no preferred word count. The check is `info`.
- `seo.h1.multiple`: no official rule limits a page to one `h1`. The check is `info`.
- `seo.canonical.missing`: Google recommends canonicals and does not require them. The check is `low` with weight 1.
- `seo.canonical.target_not_ok`: the documentation does not name this case; the finding is a measured fact (the canonical target does not answer 200, is not HTML, or is noindex).
- `links.depth.deep`: the page says Google uses the number of links needed to reach a page; the threshold of 4 is a rule of thumb. The check is `info`.
