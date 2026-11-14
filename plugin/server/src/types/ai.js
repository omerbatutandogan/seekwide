// What the ai module reads and records (rule set 0.2.0): what robots.txt tells
// the AI crawlers, the page-level signals, /llms.txt, the site's stated AI
// policy and the summary a run keeps. No runtime code.

export {};

/**
 * One AI usage preference value from robots.txt, read with `net/ai-prefs.js`.
 * @typedef {Object} AiPreferenceLine
 * @property {string} value            As written, clipped (untrusted text).
 * @property {boolean} valid
 * @property {string|null} problem     'syntax' or 'value' when not valid.
 * @property {Record<string, string>} values  Known labels and their values.
 */

/**
 * What the site's robots.txt, as read during the crawl, tells the AI crawlers of `data/ai-bots.json` (`crawl/ai-robots.js`).
 * @typedef {Object} AiRobots
 * @property {string} url              The start page's final URL, where access was asked.
 * @property {'ok'|'missing'|'unreachable'} status  The robots.txt status.
 * @property {Record<string, {allowed: boolean, group: 'own'|'fallback'|'named'|'star'|'none'}>} agents  By token: whether
 *   the crawler may fetch the start page, and which group decided (its own, a fallback token's, none because the file names
 *   it without a rule, `*`, or none at all).
 * @property {{group: 'rules'|'empty'|'none', allowed: boolean|null}} policy  The `__usage_ai-training` group: whether it has
 *   rules, names the token without one, or is absent, and whether it allows the start page (null without rules).
 * @property {number} pages_asked      Html pages of the site's origin whose access was asked for the counted crawlers.
 * @property {Record<string, string[]>} blocked_pages  For each counted crawler that may read the start page, the pages
 *   asked that it may not read; sorted, at most 200.
 * @property {AiPreferenceLine[]} content_usage   The first `Content-Usage` lines.
 * @property {AiPreferenceLine[]} content_signal  The first `Content-Signal` lines.
 * @property {number} preference_lines  `Content-Usage` and `Content-Signal` lines in the file.
 */

/**
 * The ai module's reading of one page (`PageRecord.ai`). Absent on records made before rule set 0.2.0; empty on records
 * that are not html, apart from the X-Robots-Tag directives.
 * @typedef {Object} AiPageRecord
 * @property {string[]} bingbot        Lower-cased directives Bing reads: `<meta name="robots">`, `<meta name="bingbot">`, and
 *   `X-Robots-Tag` lines for every crawler or for bingbot; at most 50.
 * @property {number} nosnippet_elements  `span`, `div` and `section` elements with a `data-nosnippet` attribute, the ones Google
 *   honours (counted up to 1000).
 * @property {number} nosnippet_words  Visible words inside them.
 * @property {boolean|null} nosnippet_h1  Whether the page's first `<h1>` is inside such an element; null without an `<h1>`.
 * @property {number} body_scripts     `<script>` elements inside `<body>` (counted up to 1000).
 * @property {string|null} empty_mount The id of an empty application mount element (`root`, `__next`, `app`, `__nuxt`)
 *   that is a child of `<body>`, when one has nothing in it but whitespace and comments; null otherwise.
 */

/**
 * The site's stated policy for AI crawlers, from the project profile (`profile.ai_policy`).
 * 'allow_all': AI search and training may read the site. 'allow_search': AI search may, training may not. 'block_all':
 * neither may.
 * @typedef {'allow_all'|'allow_search'|'block_all'} AiPolicy
 */

/**
 * What the site answered at /llms.txt (`net/llms-txt.js`).
 * @typedef {Object} LlmsTxtResult
 * @property {string} url
 * @property {'found'|'not_found'|'unverifiable'|'disallowed'} outcome  'found': status 200 with a text body that is not an
 *   HTML page, at the address or after redirects on the site. 'not_found': 404 or 410, an empty body, an HTML page (a site
 *   that answers every address with a page), or a redirect to the start page. 'unverifiable': a refusal, another status, a
 *   network error, a redirect off the site or past 3 steps, or a robots.txt that could not be read. 'disallowed': robots.txt
 *   does not allow the crawler to request it, so it was not requested.
 * @property {number} status           Status of the first answer; 0 when there was none.
 * @property {string|null} reason
 * @property {string|null} final_url   Where redirects ended, when there were any.
 * @property {string|null} content_type  Media type, lower-cased.
 * @property {string|null} h1          The first line that is a Markdown H1 (`# `), clipped; null when there is none or the
 *   file was not found.
 * @property {number} links            Markdown links `[name](url)` in the part read (counted up to 10,000).
 * @property {number} bytes            Bytes read.
 * @property {boolean} truncated       The file is longer than the part read.
 */

/**
 * What a run records about the ai module: the data date, the stated policy, what robots.txt says to each crawler and
 * what /llms.txt answered. Never any text from the site.
 * @typedef {Object} AiSummary
 * @property {string} bots_verified    The date the vendor pages behind `data/ai-bots.json` were last read.
 * @property {AiPolicy|null} policy    The profile's stated policy, when the profile speaks for the audited site.
 * @property {'ok'|'missing'|'unreachable'|null} robots  robots.txt as read for the AI crawlers; null when nothing was asked.
 * @property {true} [robots_error]  Working out what robots.txt tells AI crawlers failed (`CrawlResult.ai_robots_error`).
 * @property {number} [robots_refused]  The status robots.txt answered when it may have refused this crawler (a 4xx other than
 *   404 and 410, or too many redirects), so access was not judged; absent otherwise.
 * @property {{token: string, allowed: boolean}[]} agents  Each known token except the preference token, in the data file's order.
 * @property {'disallow'|'allow'|'empty'|'none'|'unknown'} training_preference  The `__usage_ai-training` group at the start page;
 *   'unknown' when robots.txt was not read for AI crawlers (refused, unreadable, or a crawl made before rule set 0.2.0).
 * @property {number} preference_lines  `Content-Usage` and `Content-Signal` lines in robots.txt.
 * @property {{url: string, outcome: LlmsTxtResult['outcome'], status: number}|null} llms_txt  Null when it was not requested.
 */
