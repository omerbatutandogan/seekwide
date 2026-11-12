# How Seekwide audits

Read this when a user asks how scores are built, what a label means, or why the audit will not promise results.

## Measured facts and suggestions are kept apart

- **Findings** come from scripted checks. The same data always gets the same findings, ids and scores, so two audits can be compared line by line. What can differ between two audits of an unchanged site is what is fetched or measured at audit time: the answers of external sites, Google's lab test, the real-user data (a 28-day window that moves every day), and whether Google answered at all. The lab test is a new simulated page load each time, which is why its findings are labelled `likely`.
- **Suggestions** come from the model: a better title, a summary, advice. They are useful, but they are judgment. They are labelled as suggestions in the report and never change a score.

## Scores

Each module (SEO, links) gets a score from 0 to 100.

- Every check looks at a set of units, such as pages or links, and each unit passes or fails.
- A check's pass rate is passed units divided by all its units.
- The module score is the weighted average of those pass rates. Weights run from 1 to 5 and follow severity.
- The score is a whole number. 100 means no scored check found a failure; a single failure makes the score 99 at most, however many units passed.
- Info checks have weight 0. They are rules of thumb, such as title length, and never move a score.
- Checks that could not run, and checks with nothing to look at, are left out of the average. That includes the Core Web Vitals checks when Google gave no data.
- A module gets no score when none of its scored checks had anything to look at, for example when the site blocked the crawl on its first page. The result then says why instead of showing a number.

**Coverage** is the share of a module's checks that ran. A score of 90 with 60% coverage says less than a score of 80 with full coverage, so the two are always shown together. A skipped check lists its reason, for example "needs a complete crawl".

There is no single overall score. Problems that stop a site from being indexed and cosmetic problems do not add up to one meaningful number.

## Severity and confidence

Severity orders the fixes:

- **Critical**: the site or a key page cannot be crawled or indexed.
- **High**: clearly hurts crawling, indexing or how pages appear.
- **Medium**: worth fixing; affects quality or consistency.
- **Low**: small improvements.
- **Info**: a rule of thumb, not an error.

Confidence says how sure the finding is:

- **Confirmed**: a measured fact, such as a page answering 404.
- **Likely**: a strong signal that can have a legitimate exception, such as a canonical that points to another domain. Worth checking by hand.

Every check links to the documentation its rule is based on, with the date the rule was last checked against it.

## Core Web Vitals

Core Web Vitals are Google's three measures of how a page feels to use: how fast the main content shows (Largest Contentful Paint, LCP), how fast the page reacts to input (Interaction to Next Paint, INP), and how much the layout moves while it loads (Cumulative Layout Shift, CLS). Google counts a page as good at an LCP of 2.5 seconds or less, an INP of 200 milliseconds or less and a CLS of 0.1 or less, for three out of four visits.

Seekwide does not measure them itself. Google does, in two ways:

- **Field data** is what real Chrome users on phones experienced over the last 28 days, from the Chrome UX Report. It is the number that matters, and its findings are `confirmed`. It exists only for sites and pages with enough visits; "no data" says nothing about speed.
- **Lab data** is one simulated load of a page on an emulated mid-range phone, from PageSpeed Insights. It is useful for explaining a problem and for comparing before and after a fix, but it changes from run to run, so its findings are `likely`. A lab test has no user, so it cannot measure INP; Total Blocking Time stands in for it.

Only a few pages are measured, because each lab test takes many seconds and Google limits how many can be run: the start page, then one page from each of the largest groups of similar pages. A slow template shows on every page that uses it, so those pages say the most. The result and the report name every measured page and why it was chosen.

Measuring sends the URLs of those pages to Google. It needs a Google API key, set in the plugin's options: field data always requires one, and Google currently refuses lab tests without one. Without a key the audit is still complete; the Core Web Vitals checks are skipped, the reason is given, and coverage shows it.

## What the crawler does and does not do

- It identifies itself as `seekwide` with a link to the project, and never pretends to be a browser or another bot.
- It obeys robots.txt, including crawl-delay up to 10 seconds.
- It sends one request at a time, about one per second.
- It stops when a site challenges it (a firewall or CAPTCHA page) and reports that. It never tries to get past a block.
- It refuses to connect to private network addresses.
- It reads HTML only. It does not run JavaScript, so content that appears only after scripts run is not seen. Many crawlers work the same way, which makes this a useful view, but it is not the whole picture for script-heavy sites.

## Why there are no promises

The audit shows what is measurably wrong today. It cannot predict rankings, traffic, or whether an AI assistant will cite a page: those depend on competitors, on how search engines weigh things, and on changes nobody outside them can see. A report that promises results is guessing.

Search engines and AI search products still rest on the same foundation: pages that can be crawled, indexed and understood. That foundation is what this version measures.

## What this version covers

Three modules: `seo` (crawling, indexing, canonicals, sitemaps, redirects, HTTPS, titles, descriptions, headings, duplicate content, structured data syntax, Core Web Vitals), `links` (internal, outbound, anchors, orphans) and `security` (signs of a hacked site that can be seen from outside: hidden links and frames, spam terms, pages in another writing system, scripts from sites no other page uses, and the security headers of the start page). A clean security result is not proof of a clean site: many hacks show their spam only to Google's crawler, and this crawler never pretends to be Google.

Not in this version: images and video, AI search visibility, local SEO, international targeting, and fixes applied to code. The report marks the layers it has no data for instead of leaving them out.
