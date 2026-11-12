# Changelog

Notable changes to Seekwide. Versions follow [semantic versioning](https://semver.org/); the rule set has its own version (`RULES_VERSION`) that changes whenever a check starts reporting something different.

## 0.1.0-alpha.1 (unreleased)

First working version. Rule set 0.1.2.

Rule set 0.1.1 differs from 0.1.0, which only unreleased builds used, in two ways: a module score is 99 at most when a scored check has a failure, and the `aria-label` of an element inside a link (an SVG logo, an icon, an image) counts as the link's text.

### Added

- A polite crawler: robots.txt, crawl-delay, one request at a time, XML sitemaps, template-aware sampling under a page budget, and a hard stop on bot challenges.
- 41 SEO checks, 6 Core Web Vitals checks and 10 link checks, all scripted, each with evidence, a confidence label and a documentation reference that was read when the rule was written.
- Repeatable scores per module, with coverage.
- Findings stored per run in `.seekwide/`, with stable ids so runs can be compared.
- Markdown and self-contained HTML reports, with optional agency name and logo.
- Commands: `/seekwide:basic`, `/seekwide:seo`, `/seekwide:links`, `/seekwide:all`, `/seekwide:report`, `/seekwide:setup`.
- Core Web Vitals in the `seo` module: six scripted checks, three on real-user data from the Chrome UX Report API (LCP, INP, CLS at the 75th percentile) and three on lab data from the PageSpeed Insights API (LCP, CLS, Total Blocking Time). The audit measures the start page and one page from each of the largest groups of similar pages (3 pages in a quick audit, 5 in a full one, at most 10), names them, and shows every value in both report formats.
- An optional `google_api_key` plugin setting, stored by Claude Code as a sensitive value. Without it the audit still completes: the Core Web Vitals checks are skipped with the reason, and coverage shows it. `--no-cwv` turns the measurement off.
- The "Experience" layer of the report is filled when real-user data was collected.
- Repo mode: audit the web project in the current folder and learn which source file each finding comes from. Audit commands run without a URL (or with `--repo`) detect the project, and Claude proposes the command that starts its local server; nothing starts without the user's approval, and the plugin's server starts nothing itself. Supported: Next.js with the App Router (page files, route handlers, route groups, dynamic and catch-all segments, metadata files such as `robots`, `sitemap` and `opengraph-image`, and `public/`) and plain HTML (with the line of the element). Other projects are named and audited by URL.
- A `project_detect` tool, and `source_dir` on `audit_run`. Findings carry `source {file, line, route}` where the file can be determined; it is in `findings_query`, in both report formats and in the run's `repo` summary. Finding ids do not depend on it.
- A canonical link that Next.js streams into the page body is reported by its own check, `seo.canonical.streamed_in_body`, with confidence `likely`, and no longer as a plain misplaced or missing canonical. Rule set 0.1.2 differs from 0.1.1 in this.
- `/seekwide:fix`: metadata fixes for the project in the current folder, from the findings of a saved repo-mode run. In scope: a missing or duplicate title or meta description, a missing canonical, missing Open Graph tags, and a missing sitemap with the robots.txt line that names it; in the `metadata` export or `generateMetadata` of a Next.js App Router page (and the `sitemap` and `robots` metadata files), or in the `<head>` of an HTML file. Every change is shown as a diff and written only after the user says yes; nothing is committed. Claude makes the edits with its own file tools; the plugin's server never writes into a project.
- A `fix_plan` tool: for each finding of a repo-mode run, whether a fix exists, the file and line, what the page sent, and how to change it. Findings that cannot be fixed safely are listed with the reason, and the rest are counted as out of scope.
- The re-audit after fixes: `verify_fixes` on `audit_run` says what became of each fixed finding (closed, still open, replaced by another finding of the same kind, or not verified because the check did not look at the page again), stores it in the new run, and both report formats show it in a "Fixes verified in this run" section.
- `site_url` on `crawl_start`, for a crawl of a local server: the address the project is deployed at. Canonical links, robots.txt `Sitemap:` lines and sitemap entries on that address are read as the same path on the local server, so a project that names its deployed URL is no longer audited as a site whose every page points elsewhere. A crawl of a local server now sends no request to any other address, also when its robots.txt or sitemap redirects away, and links to the deployed site are left out of the external link check. When the address matches nothing the pages name, the audit says so and names the address they use. The audit commands pass it in repo mode when it is known.
- Fixtures: a small Next.js App Router project and a plain HTML site, both with deliberate problems, under `fixtures/`.

### Security

The plugin's own security, reviewed area by area with a reproduction for every finding. No check changed what it reports, so the rule set stays 0.1.2.

- A page can no longer stall the server: a script of spaces no longer makes the Next.js data test take hours, at most 200,000 tags of a page are parsed, URLs longer than 2048 characters are treated as unusable, and robots.txt rules are evaluated in time linear in the URL (a 500 KiB file of wildcard rules and one long URL took minutes before). Sitemaps may nest at most 16 deep and at most 100 files are listed; the link, image and hreflang lists of one page hold at most a million characters, and a crawl stops as truncated when its page records reach 150 million characters.
- A `.seekwide/` folder that comes with someone else's repository can no longer redirect writes out of the project through a symbolic link, exhaust memory with an oversized file, put its own text into `fix_plan`'s instructions or error messages, or make its run the newest for good: such folders and files are refused, stored values that tools put into their own sentences are checked against the forms the plugin writes, and a run dated in the future is refused.
- `fix_plan` puts no file name into `how`; files are named in fields of their own, and the note says which fields are data. A deployed address taken from the saved profile is marked (`site_url_source`), and the fix command asks the user to confirm it. A re-audit takes a check's scope and a result's title from the plugin, never from the stored run.
- The question before a dev server is started shows the `pre` and `post` scripts that `npm run dev` runs too (`dev_server.also_runs`), and says when a script is longer than shown.
- Every tool result that carries text from a page or a saved file is labeled as data and clipped (`crawl_status`, `runs_list` and `profile_get` were not), and control characters, direction overrides and Unicode tag characters are removed from page text.
- When a local project's robots.txt redirects to another address, the blocked crawl names that address and says what to do.
- Pages whose address has a query string are never sent to Google, and each page's host is checked before it is sent.
- A site gets one crawl at a time, and at most three crawls run at once. Argument errors report ten problems at most. A response header named `__proto__` no longer breaks a crawl.
- `/seekwide:setup` no longer saves the profile without Claude Code's permission prompt; `/seekwide:basic`, `/seekwide:seo` and `/seekwide:links` say before the crawl which outside services are contacted.
- CI: GitHub Actions pinned to commit SHAs, Claude Code and the Node.js types pinned to exact versions, install scripts not run, and the checkout does not keep the token.
