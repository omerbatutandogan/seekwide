# Changelog

Notable changes to Seekwide. Versions follow [semantic versioning](https://semver.org/); the rule set has its own version (`RULES_VERSION`) that changes whenever a check starts reporting something different.

## 0.1.0-alpha.1 (unreleased)

First working version. Rule set 0.1.1.

Rule set 0.1.1 differs from 0.1.0, which only unreleased builds used, in two ways: a module score is 99 at most when a scored check has a failure, and the `aria-label` of an element inside a link (an SVG logo, an icon, an image) counts as the link's text.

### Added

- A polite crawler: robots.txt, crawl-delay, one request at a time, XML sitemaps, template-aware sampling under a page budget, and a hard stop on bot challenges.
- 40 SEO checks and 10 link checks, all scripted, each with evidence, a confidence label and a documentation reference that was read when the rule was written.
- Repeatable scores per module, with coverage.
- Findings stored per run in `.seekwide/`, with stable ids so runs can be compared.
- Markdown and self-contained HTML reports, with optional agency name and logo.
- Commands: `/seekwide:basic`, `/seekwide:seo`, `/seekwide:links`, `/seekwide:all`, `/seekwide:report`, `/seekwide:setup`.
- Core Web Vitals in the `seo` module: six scripted checks, three on real-user data from the Chrome UX Report API (LCP, INP, CLS at the 75th percentile) and three on lab data from the PageSpeed Insights API (LCP, CLS, Total Blocking Time). The audit measures the start page and one page from each of the largest groups of similar pages (3 pages in a quick audit, 5 in a full one, at most 10), names them, and shows every value in both report formats.
- An optional `google_api_key` plugin setting, stored by Claude Code as a sensitive value. Without it the audit still completes: the Core Web Vitals checks are skipped with the reason, and coverage shows it. `--no-cwv` turns the measurement off.
- The "Experience" layer of the report is filled when real-user data was collected.
