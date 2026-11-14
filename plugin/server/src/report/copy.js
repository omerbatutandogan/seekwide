// Fixed wording shared by the Markdown and HTML reports. Keeping it in one
// place means both formats say exactly the same thing.

export const TITLE = 'SEO and link audit';

const TITLE_WORDS = /** @type {Record<string, string>} */ ({ seo: 'SEO', links: 'link', security: 'security', media: 'media', smo: 'social sharing', aso: 'app' });

/**
 * The report's title. A run of only the seo and links modules keeps the title
 * reports have always had; one with any other module names the modules it ran.
 * @param {unknown} modules  `run.modules_requested`.
 * @returns {string}
 */
export function reportTitle(modules) {
  const names = Array.isArray(modules) ? ['seo', 'links', 'security', 'media', 'smo', 'aso'].filter((name) => modules.includes(name)) : [];
  if (names.every((name) => name === 'seo' || name === 'links')) return TITLE;
  const words = names.map((name) => TITLE_WORDS[name]);
  const joined = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)} audit`;
}

export const SEVERITY_LABELS = Object.freeze({ critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' });

export const CONFIDENCE_LABELS = Object.freeze({ confirmed: 'Confirmed', likely: 'Likely' });

export const MODULE_LABELS = Object.freeze({
  seo: 'SEO', links: 'Links', security: 'Security', security_headers: 'Security headers', media: 'Media', smo: 'Social sharing', aso: 'App links',
});

export const BLOCK_REASONS = Object.freeze({
  robots_unreachable: 'robots.txt could not be read, so the crawler did not continue',
  robots_disallow: 'robots.txt disallows the start URL',
  bot_challenge: 'the site answered with a bot challenge and the crawler did not try to get past it',
  rate_limited: 'the site kept answering "too many requests"',
});

export const ROBOTS_STATUS = Object.freeze({
  ok: 'Found and read.',
  missing: 'The site has no robots.txt (the server answered with a 4xx status), so every URL was allowed.',
  unreachable: 'Could not be read (server error or network failure), so the crawler treated every URL as disallowed.',
});

/** What a re-audit says about a finding that was fixed. */
export const FIX_OUTCOME_LABELS = Object.freeze({ closed: 'Closed', replaced: 'Replaced', open: 'Still open', unverified: 'Not verified' });

export const FIXES_NOTE = 'Closed means the finding is gone and the check measured the same page again. Replaced means it is gone but the page now has another finding of the same kind. Not verified means it is gone, but the check did not look at the page this time, so nothing is claimed.';

export const NO_DATA = 'No data in this version';

/** For a layer this version can measure, when a run brought no data for it. */
export const NO_DATA_RUN = 'No data in this run';

/**
 * Four of the five layers of reporting. The fifth, experience, depends on what
 * a run collected and is built in vitals.js; it sits between AI visibility and
 * business results.
 */
export const STATIC_LAYERS = Object.freeze([
  {
    name: 'Technical eligibility (this run)',
    measured: true,
    text: 'Whether search engines can reach, index and understand the pages that were crawled. Measured by the scripted checks in this report. Not covered: whether the pages are actually indexed.',
    source: '',
  },
  { name: 'Search visibility', measured: false, text: 'Impressions, clicks and positions in search results.', source: 'Google Search Console and Bing Webmaster Tools.' },
  { name: 'AI visibility', measured: false, text: 'Whether and how AI search and assistants mention or cite the brand.', source: 'the Search Console generative AI report and sampled AI answers.' },
  { name: 'Business results', measured: false, text: 'Leads, sales and revenue.', source: 'Analytics and CRM data.' },
]);

/**
 * The Search visibility layer of a run without imported search data. This
 * version can fill it from an export, so it has no data in this run, not in this version.
 */
export const SEARCH_LAYER_EMPTY = Object.freeze({
  name: 'Search visibility',
  measured: false,
  status: NO_DATA_RUN,
  text: 'Impressions, clicks and positions in search results.',
  detail: "Source: an export of Search Console's Performance report or of Bing Webmaster Tools' Search Performance report, imported into the project. None was imported for this report.",
});

/** How imported search data is read and used, for the method section. */
export const SEARCH_METHOD = Object.freeze({
  label: 'How search data is used',
  text: 'The search performance figures come from export files the user downloaded from Google Search Console or Bing Webmaster Tools and imported; Seekwide did not measure them. ' +
    'Search Console exports at most 1,000 rows of a table, so a page missing from the export can still have impressions. Click-through rate is clicks divided by impressions, and averages of position are weighted by impressions. ' +
    "The export's pages are matched to the audit by address, normalized the way the crawler normalizes links. " +
    'Findings of the same severity are listed by the impressions of their pages; the checks, findings and scores do not depend on the data.',
});

export const RATING_LABELS = Object.freeze({ good: 'Good', 'needs improvement': 'Needs improvement', poor: 'Poor' });

export const VITALS_LEGEND =
  'Field values are the 75th percentile among real Chrome users on phones over 28 days, from the Chrome UX Report. Lab values come from one simulated load on an emulated mid-range phone, run by PageSpeed Insights, and change from run to run. Good means a Largest Contentful Paint (LCP) of 2.5 s or less, an Interaction to Next Paint (INP) of 200 ms or less, a Cumulative Layout Shift (CLS) of 0.1 or less and a Total Blocking Time (TBT) of 200 ms or less. A dash means Google has no value.';

export const SUGGESTIONS_NOTE =
  'Written from the findings by the model that ran the audit. These are interpretation, not measurement, and they do not change any score.';

export const SUMMARY_NOTE = 'Written summary (interpretation, not scored). The measured facts are in the sections below.';

export const SCORE_NOTE =
  'A score is the weighted pass rate, from 0 to 100, of the checks that ran; 100 means no scored check found a failure. Coverage is the share of the module\'s checks that ran. Checks that did not run and informational checks do not change a score. ' +
  'The security module has two results: Security, a score for signs that the site was hacked, and Security headers, a count of the recommended response headers the start page sets (Strict-Transport-Security on https, nosniff and protection against framing), which protect visitors and say nothing about a hack.';

export const CONFIDENCE_NOTE = 'Confirmed means a measured fact. Likely means a strong signal that can have a legitimate exception, so review it before acting.';

/** What the security module looks at, and what an audit from outside cannot see. */
export const SECURITY_METHOD = Object.freeze([
  {
    label: 'How security signals are found',
    text: "The security checks read the same pages as the rest of the audit, with the same user agent: links and frames that the page's own markup hides, scripts and frames from other sites, spam terms, text in a writing system the site does not use, and the security headers of the start page. No other path is requested, nothing is tried against the site, and the crawler never pretends to be Google. Many hacks show their spam only to Google's crawler or to visitors who arrive from Google, so a clean result here does not prove that the site is clean; Search Console's Security issues report shows what Google found. Security headers protect visitors and are not Google ranking factors.",
  },
  {
    label: 'What an outside audit cannot see',
    text: 'Check these by hand: who has an admin account and whether each one is still needed; whether the files on the server match the versions you installed (core, plugins, themes); whether backups exist and can be restored; whether the software is up to date; and the Security issues and Manual actions reports in Search Console.',
  },
]);

/** What the media module looks at, what it requests, and what it cannot see. */
export const MEDIA_METHOD = Object.freeze({
  label: 'How images and videos are checked',
  text: "The media checks read the <img> and <video> elements, embedded video players and JSON-LD of the crawled pages. Up to 50 of the image files the pages show are then checked, chosen page by page: the robots.txt of each image host is read first and obeyed, then each file gets a HEAD request that says AVIF and WebP are accepted, and a GET that reads at most 1 KiB when the HEAD says too little. No image is downloaded whole, so formats and sizes come from the server's headers. Images that scripts add, images in CSS backgrounds, and whether alt text describes the image well are not measured; neither are captions that are part of the picture or loaded by a player.",
});

/** What the smo module looks at, what it requests, and what it cannot see. */
export const SMO_METHOD = Object.freeze({
  label: 'How sharing previews are checked',
  text: "The social sharing checks read the Open Graph and Twitter card tags of the crawled pages, where they stand in the HTML and how many bytes come before the end of the <head>, against what Facebook, WhatsApp, LinkedIn and the Open Graph protocol document. Up to 20 sharing images (og:image) are then checked: the robots.txt of each image host is read first and obeyed, then one GET reads at most the first 64 KiB of the file, enough for its pixel size; no image is downloaded whole. robots.txt is asked whether Meta's preview crawler, the one that documents that it obeys robots.txt, may fetch the start page. No request is ever sent to a social platform, and the crawler never pretends to be one of their crawlers, so what a platform shows after its own caching and its own rules is not measured: check a page in the platform's own preview tool.",
});

/** What the aso module looks at, what it requests, and what it cannot see. */
export const ASO_METHOD = Object.freeze({
  label: 'How app links are checked',
  text: "The app checks read Apple's Smart App Banner tag on the crawled pages, then request the site's /.well-known/apple-app-site-association and /.well-known/assetlinks.json once each, after robots.txt, the way Apple and Google expect them: over https, without a redirect, as JSON. Whether the files are required, and which app identifiers they must list, comes from the apps the site profile declares; without a profile only a file the site serves is judged. Apple reads the file through its own content delivery network, which can get another answer than this crawler (a region, a firewall). App store pages are not requested: no request is ever sent to Google Play.",
});

/**
 * @param {{pluginVersion: string, rulesVersion: string, vitals?: boolean, repo?: boolean, security?: boolean, media?: boolean,
 *          smo?: boolean, aso?: boolean, search?: boolean}} run
 *   `vitals`: the run asked for Core Web Vitals, so the method says how they are measured.
 *   `repo`: the findings name source files, so the method says how those were found.
 *   `security`: the run included the security module, so the method says what it can and cannot see.
 *   `media`: the run included the media module, so the method says what it requests and what it cannot see.
 *   `smo`, `aso`: the run included the social sharing or app module, so the method says what it requests and cannot see.
 *   `search`: the report shows imported search data, so the method says where it comes from and what it changes.
 * @returns {{label: string, text: string}[]}
 */
export function methodSections({ pluginVersion, rulesVersion, vitals = false, repo = false, security = false, media = false, smo = false, aso = false, search = false }) {
  const vitalsMethod = {
    label: 'How Core Web Vitals are measured',
    text: 'Only a few pages are measured, because each test takes many seconds: the start page, then one page from each of the largest groups of similar pages. Google loads each of them once on an emulated mid-range phone (PageSpeed Insights); that is the lab data, and it changes from run to run. Field data is what real Chrome users on phones experienced over 28 days (Chrome UX Report); it exists only for sites and pages with enough visits, and collecting it needs a Google API key. The URLs of the measured pages are sent to Google.',
  };
  return [
    {
      label: 'How the crawl works',
      text: 'Seekwide fetches pages one at a time at a limited rate, obeys robots.txt, and identifies itself with the user agent shown in the scope section. It reads the HTML the server sends and does not run JavaScript. When a site challenges or blocks it, it stops and does not try to get past the block.',
    },
    {
      label: 'What a finding is',
      text: 'Every finding comes from a scripted check that code ran on the crawled data, and the evidence is shown with it. Confirmed means the problem is a measured fact. Likely means a strong signal that can have a legitimate exception, so review it before acting.',
    },
    ...(vitals ? [vitalsMethod] : []),
    ...(repo ? [{
      label: 'How source files are found',
      text: "The audit ran against the project's own local server. The address of each finding is matched to the file that answers it: by the routing rules of the Next.js App Router, or by its path for plain HTML. The file says where a fix belongs. Everything a finding reports was measured on the page the server sent, never read from the source code.",
    }] : []),
    ...(security ? SECURITY_METHOD : []),
    ...(media ? [MEDIA_METHOD] : []),
    ...(smo ? [SMO_METHOD] : []),
    ...(aso ? [ASO_METHOD] : []),
    ...(search ? [SEARCH_METHOD] : []),
    { label: 'How scores work', text: SCORE_NOTE },
    {
      label: 'What is not measured',
      text: 'The written summary and the suggestions, when present, are interpretation and never change a score. The layers marked "No data" were not measured at all, and a layer marked "Imported data" holds figures the user supplied.',
    },
    { label: 'Versions', text: `Seekwide ${pluginVersion}, rules ${rulesVersion}. A different rules version can change findings without any change to the site.` },
    {
      label: 'Limits',
      text: 'This audit does not predict rankings or traffic. Fixing the findings removes obstacles and ambiguity for search engines; it does not guarantee any position, traffic or revenue.',
    },
  ];
}
