// Fixed wording shared by the Markdown and HTML reports. Keeping it in one
// place means both formats say exactly the same thing.

export const TITLE = 'SEO and link audit';

const TITLE_WORDS = /** @type {Record<string, string>} */ ({ seo: 'SEO', links: 'link', security: 'security' });

/**
 * The report's title. A run without the security module keeps the title
 * reports have always had; one with it names the modules it ran.
 * @param {unknown} modules  `run.modules_requested`.
 * @returns {string}
 */
export function reportTitle(modules) {
  const names = Array.isArray(modules) ? ['seo', 'links', 'security'].filter((name) => modules.includes(name)) : [];
  if (!names.includes('security')) return TITLE;
  const words = names.map((name) => TITLE_WORDS[name]);
  const joined = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)} audit`;
}

export const SEVERITY_LABELS = Object.freeze({ critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' });

export const CONFIDENCE_LABELS = Object.freeze({ confirmed: 'Confirmed', likely: 'Likely' });

export const MODULE_LABELS = Object.freeze({ seo: 'SEO', links: 'Links', security: 'Security', security_headers: 'Security headers' });

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
  { name: 'Search visibility', measured: false, text: 'Impressions, clicks and positions by query.', source: 'Google Search Console and Bing Webmaster Tools.' },
  { name: 'AI visibility', measured: false, text: 'Whether and how AI search and assistants mention or cite the brand.', source: 'the Search Console generative AI report and sampled AI answers.' },
  { name: 'Business results', measured: false, text: 'Leads, sales and revenue.', source: 'Analytics and CRM data.' },
]);

export const RATING_LABELS = Object.freeze({ good: 'Good', 'needs improvement': 'Needs improvement', poor: 'Poor' });

export const VITALS_LEGEND =
  'Field values are the 75th percentile among real Chrome users on phones over 28 days, from the Chrome UX Report. Lab values come from one simulated load on an emulated mid-range phone, run by PageSpeed Insights, and change from run to run. Good means a Largest Contentful Paint (LCP) of 2.5 s or less, an Interaction to Next Paint (INP) of 200 ms or less, a Cumulative Layout Shift (CLS) of 0.1 or less and a Total Blocking Time (TBT) of 200 ms or less. A dash means Google has no value.';

export const SUGGESTIONS_NOTE =
  'Written from the findings by the model that ran the audit. These are interpretation, not measurement, and they do not change any score.';

export const SUMMARY_NOTE = 'Written summary (interpretation, not scored). The measured facts are in the sections below.';

export const SCORE_NOTE =
  'A score is the weighted pass rate, from 0 to 100, of the checks that ran; 100 means no scored check found a failure. Coverage is the share of the module\'s checks that ran. Checks that did not run and informational checks do not change a score. ' +
  'The security module has two scores: Security for signs that the site was hacked, and Security headers for the response headers of the start page, which protect visitors and say nothing about a hack.';

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

/**
 * @param {{pluginVersion: string, rulesVersion: string, vitals?: boolean, repo?: boolean, security?: boolean}} run
 *   `vitals`: the run asked for Core Web Vitals, so the method says how they are measured.
 *   `repo`: the findings name source files, so the method says how those were found.
 *   `security`: the run included the security module, so the method says what it can and cannot see.
 * @returns {{label: string, text: string}[]}
 */
export function methodSections({ pluginVersion, rulesVersion, vitals = false, repo = false, security = false }) {
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
    { label: 'How scores work', text: SCORE_NOTE },
    {
      label: 'What is not measured',
      text: 'The written summary and the suggestions, when present, are interpretation and never change a score. The layers marked "No data" were not measured at all.',
    },
    { label: 'Versions', text: `Seekwide ${pluginVersion}, rules ${rulesVersion}. A different rules version can change findings without any change to the site.` },
    {
      label: 'Limits',
      text: 'This audit does not predict rankings or traffic. Fixing the findings removes obstacles and ambiguity for search engines; it does not guarantee any position, traffic or revenue.',
    },
  ];
}
