# Security

## Reporting a vulnerability

Please report security problems privately through GitHub's "Report a vulnerability" button on the repository's Security tab. Do not open a public issue for them. You should get a first answer within a week.

Useful details: the version, what you did, what happened, and what you expected.

## What Seekwide is built to resist

Seekwide fetches pages from sites it does not control and hands the results to a model, so it treats everything it reads as untrusted.

- **Requests to private networks.** Every request goes through one function that refuses loopback, private, link-local and other non-public addresses. The check is made on the address the connection actually uses, and again on every redirect. A local site can be audited only when its own address is the one the user named, and then only that host and port are reachable: links, redirects and sitemaps that point at another local port are refused. The server enforces this; it does not rely on the model.
- **Leaving the site.** The crawl stays on the site it was asked to audit: links, sitemaps and redirects that point to another host are recorded, not fetched. Three cases reach another host on purpose. If the start URL itself redirects to another host, that host becomes the audited site. If a robots.txt redirects to another host, it is read from there, as search engines do. And the `links` module tests up to 50 external links, with one or two requests for the link and for each of at most 5 redirect steps, after reading the robots.txt of every site it contacts. Redirects are followed one step at a time, and robots.txt is checked before each step. Credentials inside a URL are removed before any request.
- **Instructions hidden in pages.** Page content is returned to the model as data inside structured fields, with a note saying so, and is clipped. The skills tell the model to treat it as material to audit. Nothing taken from a page is run as a command.
- **Markup in reports.** Every value written into the HTML report is escaped. Only `http` and `https` URLs become links. The report has no scripts and loads nothing from the network.
- **Path tricks.** Project folders must be absolute paths, and run ids are checked against a strict pattern before they are used in a file path. A report logo is accepted only when its content really is a PNG, JPEG, WebP or SVG image, and a logo named by a project profile has to be inside the project folder, so a profile cannot pull another file into a report.
- **Oversized or endless responses.** Responses are limited in size, time and redirect count, also after decompression. What one page can contribute is capped as well (headings, links, images and the other lists), so a page built to be expensive cannot stall the server or fill the disk.
- **Other users on the machine.** The crawl cache is readable only by the user who ran the audit.
- **Leaking the Google API key.** The key is optional. Claude Code stores it in the system's secure storage and hands it to the server in an environment variable. The server reads it in one place and sends it only to Google's PageSpeed Insights and Chrome UX Report APIs, over HTTPS, in a request header, so it is never part of a URL. Those requests follow no redirect, so the key cannot be passed on to another host. The key is not written to `.seekwide/`, to the crawl cache or to a log. No tool receives it: the tools are handed one function that has the key bound in, and of the server's environment only the report brand and logo settings. No tool result contains it, so the model never sees it. When Google refuses a request, the audit reports a fixed sentence of its own and not Google's message, which can name the key's Google Cloud project.
- **Telling Google about a private site.** Measuring Core Web Vitals sends the URLs of a few audited pages to Google (3 to 5, depending on the command, and never more than 10). A site on the user's own machine or on a private network address is never sent. The crawl records whether the site is local, and a crawl that does not say so is treated as local. For a public site whose URLs should stay private, `--no-cwv` turns the measurement off.

## What it does not protect against

- A model can still be misled by page content despite the precautions above. Review suggestions before acting on them.
- A logo set in the plugin settings, or passed to the report tool, can be any PNG, JPEG, WebP or SVG file of 200 KB or less that you can read, and it is embedded in the report. Only a logo named by a project profile is limited to the project folder. Look at a report before you send it.
- Seekwide does not sandbox Claude Code. The usual Claude Code permission prompts apply.
- Another program running as the same user can read the environment of the server process, and with it the Google API key. Restrict the key in the Google Cloud console to the two APIs it is used for, so that a leaked key is of little use.

## Supported versions

Only the latest release gets fixes while the project is in alpha.
