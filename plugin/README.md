# Seekwide

Claude Code plugin for site audits you can re-run and trust: scripted SEO, Core Web Vitals, links, signs of a hacked site, images and video, social sharing previews and app links, with evidence for every finding, repeatable scores, a client-ready report and fixes verified by a second audit.

This folder is the plugin as Claude Code installs it. The full documentation is in the [repository](https://github.com/omerbatutandogan/seekwide); the links are at the end.

## Install

You need Claude Code, and Node.js 22 or later with npm on your `PATH` (the plugin's server runs with `node`). In Claude Code, add the repository as a plugin marketplace, then install the plugin from it:

```
/plugin marketplace add omerbatutandogan/seekwide
```

```
/plugin install seekwide@seekwide
```

Start a new Claude Code session, then audit a site:

```
/seekwide:basic https://www.your-site.com
```

## Commands

| Command | What it does |
|---|---|
| `/seekwide:basic [url]` | Quick SEO and link audit |
| `/seekwide:seo [url]` | Technical and on-page SEO audit, with suggested titles and descriptions |
| `/seekwide:links [url]` | Link audit, including external links |
| `/seekwide:security [url]` | Signs that the site was hacked or misused, and the security headers of its start page |
| `/seekwide:media [url]` | Images and video: alt text, sizes, formats, broken files, robots.txt for Google, captions and video structured data |
| `/seekwide:smo [url]` | Social sharing previews: Open Graph tags, where they stand in the HTML, the sharing image's size and weight, and robots.txt for Meta's preview crawler |
| `/seekwide:aso [url]` | The site's side of its apps: the Smart App Banner, and the association files for iOS universal links and Android App Links |
| `/seekwide:all [url]` | Every installed module in one report |
| `/seekwide:fix [run-id]` | Fix metadata findings of an audit of the project in this folder, with your approval for each change, then audit again to verify |
| `/seekwide:report [run-id]` | Rebuild a report, brand it, or compare two audits |
| `/seekwide:setup [url]` | Save a project profile and report branding |

## Settings

All three are optional. Set them in Claude Code: run `/plugin`, pick Seekwide on the Installed tab and choose "Configure options".

| Setting | Meaning |
|---|---|
| Report brand name | Shown as "Prepared by" on reports |
| Report logo file | Absolute path to a PNG, JPEG, WebP or SVG of 200 KB or less |
| Google API key | Lets audits measure Core Web Vitals. Kept in your system's secure storage |

## What it sends where

Seekwide has no telemetry and no backend. In short (the [full table](https://github.com/omerbatutandogan/seekwide#network-and-data) in the repository's README gives every request, its limits and its exceptions):

- **The site you audit:** requests for pages, `robots.txt` and XML sitemaps, about one per second, with the user agent `seekwide/<version> (+https://github.com/omerbatutandogan/seekwide)`. It obeys robots.txt and never gets past a block.
- **Sites the audited site links to, and the hosts of its images:** the `robots.txt` of each, then a `HEAD` request (a `GET` when the `HEAD` fails or answers with an error status) for at most 50 links and 50 images, in the audits that include the `links` and `media` modules; and for at most 20 sharing images (`og:image`) one `GET` of at most their first 64 KiB, with the `smo` module.
- **The audited site's app files:** `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`, one `GET` each after robots.txt, with the `aso` module.
- **Never:** Google Play and social platforms (Facebook, Instagram, X, LinkedIn, Pinterest, TikTok, YouTube, Telegram, Discord and others), not even their robots.txt. Links and images there are listed as not checked.
- **Google PageSpeed Insights and Chrome UX Report APIs:** the URLs of the pages whose Core Web Vitals are measured (3 with `/seekwide:basic`, 5 with `/seekwide:seo` and `/seekwide:all`, never more than 10), and with a Google API key also the site's origin, unless you pass `--no-cwv` or the site is on your own machine. The key is sent to these two APIs only, in a request header, never in a URL.
- **Anthropic:** the tool results that Claude reads during your session: scores, findings, Core Web Vitals values and short page excerpts. When you audit a project in its folder, the file paths it finds and the text of its `dev` script are part of those results, and with `/seekwide:fix` the source files Claude reads and the diffs it shows are part of your session like any file Claude reads. When you import a Search Console or Bing export (a file in the project folder; no request is sent), its totals and the pages' clicks and impressions are part of those results too.

## More

- [Full README](https://github.com/omerbatutandogan/seekwide/blob/main/README.md): install, a sample report, how the scores work, the list of checks and every network request in detail.
- [SECURITY.md](https://github.com/omerbatutandogan/seekwide/blob/main/SECURITY.md): what the plugin protects against and how to report a vulnerability.
- [CHANGELOG.md](https://github.com/omerbatutandogan/seekwide/blob/main/CHANGELOG.md): what changed in each release.

[MIT license](LICENSE). `server/data/public-suffixes.txt` is a compact copy of the [Public Suffix List](https://publicsuffix.org/) and stays under the [Mozilla Public License 2.0](https://mozilla.org/MPL/2.0/), as its header says.
