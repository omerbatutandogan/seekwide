// What extraction records for one URL (ARCHITECTURE.md 4.6). No runtime code.

/** @import { RedirectHop } from './net.js' */
/** @import { PageSecurity } from './security.js' */

export {};

/**
 * @typedef {Object} LinkRecord
 * @property {string} href            Raw `href` attribute; '' when the attribute is missing.
 * @property {string|null} url        Normalized absolute URL; null when `href` is missing, invalid or not http(s).
 * @property {string} text            Anchor text: text content plus the `alt` of contained images and the `aria-label` of
 *   contained elements (which replaces their content), whitespace-collapsed, max 300 chars.
 * @property {string|null} aria_label `aria-label` attribute, trimmed; null when absent or empty.
 * @property {string|null} title_attr `title` attribute, trimmed and clipped; null when absent or empty. Google uses it as anchor text when the element has no text.
 * @property {string[]} rel           Lower-cased `rel` tokens.
 * @property {boolean} internal       True when `url` belongs to the audited site.
 * @property {boolean} has_onclick    True when the element has an `onclick` attribute.
 * @property {boolean} [has_handler]  True when the element has another inline event handler (`onmousedown`, `ontouchstart`…), a click
 *   binding of a script framework (`ng-click`, `v-on:click`, `@click`, `x-on:click`, `(click)`, `wire:click`, `hx-get`, `hx-post`), or a
 *   URL in `data-href`, `data-url` or `data-link`: a script may do what the link does. Absent in crawls made before rule set 0.1.5.
 * @property {boolean} [aria_hidden]  True when the element, or an element around it, has `aria-hidden="true"`: it is left out of
 *   what screen readers read, usually as a copy of a link that is named elsewhere. Absent in crawls made before rule set 0.1.5.
 * @property {number|null} line       1-based source line of the element.
 */

/**
 * @typedef {Object} ImageRecord
 * @property {string} src             Raw `src` attribute; '' when missing.
 * @property {string|null} url        Normalized absolute URL or null.
 * @property {string|null} alt        `alt` attribute; null when the attribute is absent ('' means an explicit empty alt).
 * @property {string|null} width
 * @property {string|null} height
 * @property {string|null} loading
 * @property {boolean} has_srcset
 * @property {number|null} line
 * @property {boolean} [aria_hidden]   The element, or an element around it, has `aria-hidden="true"`. This field and those below
 *   come with the media module (rule set 0.1.6); records made before have none of them.
 * @property {string|null} [role]      First token of `role`, lower-cased; null when absent.
 * @property {boolean} [named]         A non-empty `aria-label`, `aria-labelledby` or `title`: a text alternative other than `alt`
 *   (WCAG F65), or a script framework's binding that sets `alt` when the page renders (`:alt`, `v-bind:alt`, `x-bind:alt`, `[alt]`).
 * @property {boolean} [hidden]        Hidden by its own markup: the `hidden` attribute (not `until-found`) or `display: none` inline.
 * @property {boolean} [pixel]         A tracking pixel or spacer: a `width` or `height`, as an attribute or an inline style in px, of 1 or less.
 * @property {boolean} [style_sized]   Its inline style reserves its box: `aspect-ratio`, both `width` and `height` other than `auto`,
 *   or `position: absolute` or `fixed`.
 * @property {boolean} [class_sized] A utility class gives it an aspect ratio or both sizes (`aspect-video`, `size-full`, `w-40 h-12`).
 * @property {boolean} [chrome]        It is in the page's frame, not its content: navigation, a complementary block, or the
 *   page's own header or footer (`<nav>`, `<aside>`, a `<header>` or `<footer>` outside any sectioning element, or their roles).
 * @property {string|null} [fetchpriority]  `fetchpriority`, trimmed and lower-cased; null when absent.
 * @property {boolean} [preloaded]     A `<link rel="preload" as="image">` before it names its `src` or a URL of its `srcset`.
 * @property {boolean} [figure_caption]  It is the only content of a `<figure>` with a non-empty `<figcaption>`, alone or in up to
 *   three wrappers that hold nothing else (a link, a `<picture>` with its sources, a span or div).
 * @property {boolean} [picture_sources]  It is inside a `<picture>` with one or more `<source srcset>`.
 * @property {boolean} [modern_source]  It is inside a `<picture>` with a `<source type="image/avif">` or `type="image/webp"`.
 */

/**
 * One `<video>` element (media module).
 * @typedef {Object} VideoRecord
 * @property {string|null} url         Normalized URL of `src`, else of the first `<source src>`; null when neither gives one.
 * @property {boolean} muted
 * @property {boolean} autoplay
 * @property {boolean} controls
 * @property {boolean} aria_hidden
 * @property {boolean} hidden          Hidden by its own markup, as for images.
 * @property {string[]} tracks         `kind` of each `<track>` child as browsers read it: `subtitles` when missing, `metadata` when unknown.
 * @property {number|null} line
 */

/**
 * An embedded player of a known video platform (media module).
 * @typedef {Object} VideoEmbedRecord
 * @property {'iframe'|'embed'|'object'} tag
 * @property {string} url
 * @property {string} platform        'youtube', 'vimeo', 'wistia', 'dailymotion', 'brightcove', 'jwplayer', 'loom', 'vidyard' or 'tiktok'.
 * @property {number|null} line
 */

/**
 * Which of Google's required properties a JSON-LD `VideoObject` has.
 * @typedef {Object} VideoObjectSummary
 * @property {boolean} name
 * @property {boolean} thumbnail_url
 * @property {boolean} upload_date
 */

/**
 * @typedef {Object} CanonicalRef
 * @property {string} href            Raw value.
 * @property {string|null} url        Normalized absolute URL or null when invalid.
 * @property {'html'|'header'} source `<link rel="canonical">` or an HTTP `Link` header.
 * @property {boolean} in_head        True for header canonicals and for link elements inside `<head>`. Google ignores canonicals outside `<head>`.
 * @property {boolean} [streamed]     True for a link element outside `<head>` that a Next.js App Router page sent in `<body>`
 *   as streamed metadata: the page has `self.__next_f` data scripts and its `<title>` is in the body too. It stays
 *   `in_head: false`; the flag moves the finding from `seo.canonical.outside_head` to `seo.canonical.streamed_in_body`.
 * @property {number|null} line
 */

/**
 * @typedef {Object} HreflangRef
 * @property {string} hreflang
 * @property {string} href
 * @property {string|null} url
 * @property {'html'|'header'} source
 */

/**
 * @typedef {Object} Heading
 * @property {1|2|3|4|5|6} level
 * @property {string} text            Whitespace-collapsed text, max 300 chars.
 * @property {number|null} line
 */

/**
 * One `<meta name="apple-itunes-app">`, Apple's Smart App Banner (aso module).
 * @typedef {Object} AppBannerRecord
 * @property {string} content         The `content` attribute, whitespace-collapsed and clipped.
 * @property {boolean} in_head        The tag is inside `<head>`.
 * @property {number|null} line
 */

/**
 * What the smo and aso modules read from a page (rule set 0.1.9).
 * @typedef {Object} SocialRecord
 * @property {{key: string, line: number|null}[]} outside_head  `og:title`, `og:description`, `og:url`, `og:image` (also
 *   given by `og:image:url` or `og:image:secure_url`) and `apple-itunes-app` when the page gives them with content only
 *   outside `<head>`, in that order, with the line of the first.
 * @property {boolean} streamed       A Next.js App Router page sent its metadata in `<body>` (as for canonicals, `streamed`),
 *   and something is in `outside_head`.
 * @property {{bytes: number, by: 'head'|'og'}|null} head_end  Where the parsed `<head>` ends ('head'), or else where the
 *   last `og:` meta tag ends ('og'), in bytes of the response; null when neither is known.
 * @property {AppBannerRecord[]} app_banners  Every Smart App Banner meta tag, at most 5.
 * @property {string[]} rel_me        Normalized URLs of the `<a>` and `<link>` elements with `rel="me"`, each once, at most 50.
 */

/**
 * An organisation, business or person described in JSON-LD, and how many `sameAs` URLs it gives (smo module).
 * @typedef {Object} ProfileEntity
 * @property {string} type
 * @property {number} same_as
 */

/**
 * @typedef {Object} JsonLdBlock
 * @property {boolean} valid          False when the script content is not valid JSON.
 * @property {string[]} types         `@type` values found at the top level and in `@graph`.
 * @property {string|null} error      Parser message when `valid` is false.
 * @property {number|null} line
 * @property {VideoObjectSummary[]} [videos]  Every `VideoObject` in the block, anywhere in it, in document order (media module).
 * @property {ProfileEntity[]} [profiles]  Every Organization, business or Person at the top level of the block or in its
 *   `@graph`, in document order (smo module, rule set 0.1.9). Absent in records made before.
 */

/**
 * @typedef {Object} Indexability
 * @property {boolean} indexable
 * @property {string[]} reasons  Why the URL is not indexable as it stands. Values:
 *   'fetch_error', 'redirect', 'status_<code>', 'not_html', 'noindex_meta', 'noindex_header', 'canonical_elsewhere'.
 */

/**
 * Everything the audit knows about one URL. One record per requested URL.
 *
 * A URL that redirects gets its own record with the 3xx `status`, an empty
 * content section and `final_url` pointing at the end of the chain; the content
 * at the end of the chain is stored in that final URL's own record.
 *
 * @typedef {Object} PageRecord
 * @property {string} url               Normalized URL of this record.
 * @property {number} status            HTTP status this URL answered with; 0 when the request failed.
 * @property {string} final_url         URL at the end of the redirect chain (equals `url` when there is none).
 * @property {number} final_status      Status at the end of the redirect chain (equals `status` when there is none); 0 when the end was not fetched or the request failed.
 * @property {boolean} final_external   True when the redirect chain leaves the audited site. The crawl does not fetch other sites, so
 *   `final_url` is the first URL outside the site and `final_status` is 0. The destination is checked with the external links instead.
 * @property {RedirectHop[]} redirect_chain  Hops from this URL to `final_url`; empty when there is no redirect.
 * @property {number|null} depth        Clicks from the start URL; null when the URL was found only in a sitemap.
 * @property {('start'|'link'|'sitemap'|'redirect')[]} discovered_via
 * @property {string|null} content_type Lower-cased media type without parameters.
 * @property {Record<string, string>} headers  Selected response headers, lower-cased names. Empty for redirect records and failed requests.
 * @property {boolean} is_html
 * @property {number} bytes
 * @property {number} fetch_ms          Timing only; never used in findings.
 * @property {string|null} fetch_error  Why this URL has no usable response, or null. A `FetchError.code`, or one of:
 *   'bot_challenge' (the site's firewall challenged the crawler on this URL), 'rate_limited' (the site answered 429),
 *   'robots_disallowed' (a redirect led to a URL that robots.txt does not allow, or whose robots.txt could not be read;
 *   it was not fetched).
 *   Those three say something about the audit, not about the site; see `isUnverifiable` in checks/page-helpers.js.
 * @property {string|null} html_lang    `lang` attribute of `<html>`, trimmed; null when absent or empty.
 * @property {string[]} titles          Text of each HTML `<title>` element in the document, whitespace-collapsed (empty titles are kept as ''). SVG titles are not included.
 * @property {string[]} meta_descriptions  `content` of each `<meta name="description">`, whitespace-collapsed.
 * @property {string[]} meta_robots     Lower-cased directive tokens from `<meta name="robots">` and `<meta name="googlebot">`.
 * @property {string[]} x_robots        Lower-cased directive tokens from `X-Robots-Tag` values that apply to all crawlers or to googlebot.
 * @property {CanonicalRef[]} canonicals
 * @property {HreflangRef[]} hreflang
 * @property {Heading[]} headings
 * @property {string|null} viewport     `content` of `<meta name="viewport">`; null when absent.
 * @property {Record<string, string>} og       Open Graph properties without the "og:" prefix; first value wins.
 * @property {Record<string, string>} twitter  Twitter card properties without the "twitter:" prefix; first value wins.
 * @property {LinkRecord[]} links       Every `<a>` element in document order.
 * @property {ImageRecord[]} images
 * @property {JsonLdBlock[]} jsonld
 * @property {string[]} mixed_content   http:// subresource URLs referenced by an https page (max 20).
 * @property {number} word_count        Words in the visible body text.
 * @property {string} text_hash         sha1 of the normalized visible body text; '' when there is none.
 * @property {string} text_excerpt      First 2000 characters of the visible body text.
 * @property {Indexability} indexability
 * @property {PageSecurity} [security]  Signals for the security module. Absent in records made before it existed.
 * @property {VideoRecord[]} [videos]   Every `<video>` element (media module). Absent in records made before it existed.
 * @property {VideoEmbedRecord[]} [video_embeds]  Players of known video platforms in `<iframe>`, `<embed>` or `<object>`.
 * @property {boolean} [video_markup]  An element whose `itemtype` (microdata) or `typeof` (RDFa) names `VideoObject`.
 * @property {SocialRecord} [social]  Meta tag places, the end of the head, Smart App Banners and rel="me" links (smo and aso
 *   modules). Absent in records made before rule set 0.1.9.
 * @property {string[]} [limits_reached]  The caps that stopped the reading of this page, when any did: `tags` (the
 *   document was parsed up to its 200,000th tag), a list at its cap by field name (`links`, `images`, `headings`…),
 *   `list_chars`, and the security scan's (`security.hosts`, `security.hidden_hosts`, `security.visible_hosts`,
 *   `security.embeds`, `security.references`). Absent when none did, and in records made before 0.1.1.
 */
