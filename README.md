# Seekwide

Site audits for Claude Code that you can re-run and trust. Seekwide crawls a site politely, runs scripted SEO, link and Core Web Vitals checks with evidence for every finding, scores the result the same way every time, and writes a report you can send to a client.

> **Status: alpha (0.1.0-alpha.1).** Two modules work today: `seo` and `links`. The roadmap further down lists what is planned and not built yet.

## What it does today

- **Crawls like a well-behaved bot.** It obeys robots.txt for every page, sitemap and redirect step it requests, identifies itself, sends about one request per second, stays on the site you named, and stops when a site challenges it.
- **Runs 56 scripted checks** (47 scored, 9 informational): robots.txt, indexing, canonicals, sitemaps, redirects, HTTPS, titles, meta descriptions, headings, duplicate content, structured data syntax, Core Web Vitals, broken and redirected links, links search engines cannot follow, anchor text, orphan pages and broken external links. The full list is in [docs/checks.md](docs/checks.md).
- **Measures Core Web Vitals** for the pages that matter most: the start page, then one page from each of the largest groups of similar pages (three pages with `/seekwide:basic`, five with `/seekwide:seo` and `/seekwide:all`). Real-user values (LCP, INP and CLS at the 75th percentile) come from the Chrome UX Report, lab values (LCP, CLS and Total Blocking Time) from PageSpeed Insights. The report names the pages it measured and shows every value, good ones included. This needs a Google API key; see [Core Web Vitals](#core-web-vitals).
- **Scores the same data the same way, every time.** Checks are code, not model judgment, so the same data always gets the same findings, ids and scores, and two audits can be compared finding by finding. What can differ between two audits of an unchanged site is what is fetched or measured at audit time: the answers of external sites, Google's lab test, the real-user data (a 28-day window that moves every day), and whether Google answered at all. A comparison says so when a lab finding changed or a check ran in only one of the two audits.
- **Shows its evidence.** Each finding has the URL, what was observed, what was expected, a confidence label, and a link to the documentation the rule is based on.
- **Writes a report** as Markdown and as one self-contained HTML file, with an optional agency name and logo. The HTML prints cleanly to PDF.
- **Keeps facts and advice apart.** Claude writes the summary and can suggest better titles, and the report labels those parts as suggestions. They never change a score.

## What it does not do

- It does not promise rankings, traffic or inclusion in AI answers. It reports what is measurably wrong today.
- It does not run JavaScript. Content that appears only after scripts run is not seen.
- It does not get around firewalls, CAPTCHAs or robots.txt. When a site blocks it, it says so and stops. Pages the site refuses to serve to the crawler are counted and left out of the checks; they are never reported as errors of the site.
- It does not measure Core Web Vitals of every page. A lab test takes many seconds and Google limits how many can be run, so a few pages stand for the rest.
- It has no image, AI search, local SEO or code-fix modules yet.

## Requirements

- Claude Code
- Node.js 22 or later on your `PATH` (the plugin's server runs with `node`)

## Install

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

Claude Code installs the plugin's two small dependencies (`parse5` and `robots-parser`) when it installs the plugin.

## Commands

| Command | What it does | Default page budget |
|---|---|---|
| `/seekwide:basic <url>` | Quick SEO and link audit | 25 |
| `/seekwide:seo <url>` | Technical and on-page SEO audit, with suggested titles and descriptions | 100 |
| `/seekwide:links <url>` | Link audit, including external links | 100 |
| `/seekwide:all <url>` | Every installed module in one report | 200 |
| `/seekwide:report [run-id]` | Rebuild a report, brand it, or compare two audits | — |
| `/seekwide:setup [url]` | Save a project profile and report branding | — |

Audit commands accept `--pages N` to change the page budget and `--compare` to show what changed since the previous audit in the same folder. `/seekwide:basic`, `/seekwide:seo` and `/seekwide:all` also accept `--no-cwv`, which skips Core Web Vitals so that nothing is sent to Google.

To audit a site running on your own machine, give a `localhost` or `127.0.0.1` URL. Seekwide then connects to that address and port only; it never follows a link, a redirect or a sitemap to another local port.

## How the scores work

Each module gets a score from 0 to 100. Every check looks at a set of pages or links, and each one passes or fails. The module score is the weighted average of the checks' pass rates, with weights from 1 to 5 that follow severity. It is rounded to a whole number, and 100 is kept for a module with no failure in a scored check: one failure makes it 99 at most.

- **Info checks** are rules of thumb, such as title length. They are reported and never change a score.
- **Coverage** is the share of a module's checks that could run. A check that needs a complete crawl, an XML sitemap or Core Web Vitals data is skipped when the audit does not have it, and the report says why. Score and coverage are always shown together.
- **Confidence** is `confirmed` for a measured fact and `likely` for a strong signal that can have a legitimate exception.

There is no single overall score on purpose: a blocked site and a long title do not add up to one meaningful number.

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

To get a key, create an API key in the Google Cloud console and enable the PageSpeed Insights API and the Chrome UX Report API for its project. Then run `/plugin` in Claude Code, pick Seekwide on the Installed tab, choose "Configure options" and paste the key into "Google API key". Claude Code keeps it in your system's secure storage.

Field data exists only for sites and pages with enough visits from Chrome users. A small site often has none, and that says nothing about its speed.

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

Crawl results are cached in the plugin's data directory and can be deleted at any time.

## Network and data

Seekwide has no telemetry and no backend. This is everything it sends or fetches:

| Where | What | When |
|---|---|---|
| The site you audit | HTTP requests for pages, `robots.txt` and XML sitemaps, and, for a file that one of its redirects leads to, a `HEAD` request (then a `GET` that reads at most 16 KB when the HEAD fails or answers with an error status), with the user agent `seekwide/<version> (+https://github.com/omerbatutandogan/seekwide)`. If the start URL redirects to another host, that host becomes the site. | Every audit |
| Sites the audited site links to | The `robots.txt` of each site, then a `HEAD` request for the link, and a `GET` when the HEAD fails or answers with an error status. At most 50 links are checked, each through at most 5 redirects. A redirect step gets the same requests, and only when the robots.txt of the site it leads to allows it. This also covers the destination of a redirect that leaves the audited site. | Audits that include the `links` module |
| Google PageSpeed Insights API (`pagespeedonline.googleapis.com`) | The URL of each page whose Core Web Vitals are measured: 3 pages with `/seekwide:basic`, 5 with `/seekwide:seo` and `/seekwide:all`, never more than 10. One request per page, with your Google API key when one is set. Google then loads those pages itself to test them. | Audits that include the `seo` module, unless you pass `--no-cwv` or the site is on your own machine |
| Google Chrome UX Report API (`chromeuxreport.googleapis.com`) | The origin of the site and the URLs of the same pages, one request each (4 with `/seekwide:basic`, 6 with `/seekwide:seo` and `/seekwide:all`, never more than 11), with your Google API key | The same audits, and only when a Google API key is set |
| Anthropic | Tool results that Claude reads during the session: scores, findings, Core Web Vitals values, and short page excerpts when Claude drafts a suggestion | Every audit, as part of your Claude Code session |

Nothing else leaves your machine. What Claude reads is covered by the terms of your Claude account. If you audit a client's site, the findings and page excerpts become part of your Claude session.

The Google API key is sent to those two Google APIs only, in a request header and never in a URL. It is not written to `.seekwide/`, to the crawl cache or to a log. The tools that Claude calls are not given the key and return nothing that contains it, so Claude never sees it. A site on your own machine or on a private network address is never named to Google.

Pages, sitemaps and redirect targets on other hosts are never fetched during the crawl. The one exception is a `robots.txt` that redirects to another host: it is read from there, as search engines do. Seekwide refuses to connect to private network addresses, and to `localhost` unless that is the site you asked it to audit.

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

1. Developer mode: audit a local project and apply metadata fixes as reviewable diffs.
2. Images and video, including alt text written from the image.
3. Answer and AI search readiness, entity checks against Wikidata, E-E-A-T, international, local, programmatic pages, conversion.
4. Search Console and Bing Webmaster Tools data, backlinks, measured AI visibility, app stores and social search.

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

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes the modules and their contracts. [docs/CHECKS-SPEC.md](docs/CHECKS-SPEC.md) specifies every check. See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE)
