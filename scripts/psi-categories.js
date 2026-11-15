#!/usr/bin/env node
// Measure what asking PageSpeed Insights for the ACCESSIBILITY and
// BEST_PRACTICES categories costs, next to the PERFORMANCE category the plugin
// always asks for, with your own Google API key. Development tool: it is not
// part of the plugin and the plugin never runs it.
//
//   SEEKWIDE_GOOGLE_API_KEY=... node scripts/psi-categories.js https://example.com/ https://example.com/contact
//
// The key is read from the environment and sent in the x-goog-api-key header,
// as the plugin sends it; it is never printed, logged or put in a URL. For each
// page the script sends two requests one after the other (the order changes
// from page to page) and prints one JSON line each: the time to the whole
// answer, the size of the answer, the HTTP status, and, for the request with
// the extra categories, the outcome of the Lighthouse audits Seekwide reads or
// cross-checks (score and number of items; never their text) and whether the
// answer carries the full-page screenshot's node boxes. Then one Chrome UX
// Report query per origin for the experimental ad metrics prints its status
// and which metrics came back. Google's error messages are not printed (they
// can name your Google Cloud project); only the HTTP status and Google's
// status word are.

const PSI = 'https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed';
const CRUX = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
const AUDITS = ['target-size', 'label', 'errors-in-console', 'paste-preventing-inputs', 'autocomplete-valid'];
const AD_METRICS = ['experimental_ad_density', 'experimental_ad_count', 'experimental_ad_cpu', 'experimental_ad_kilobytes'];

const key = (process.env.SEEKWIDE_GOOGLE_API_KEY ?? '').trim();
const pages = process.argv.slice(2).filter((arg) => /^https?:\/\//.test(arg));
if (key === '' || pages.length === 0) {
  console.error('Usage: SEEKWIDE_GOOGLE_API_KEY=<your key> node scripts/psi-categories.js <page URL> [<page URL> ...]');
  process.exit(2);
}

/** @param {unknown} value @returns {Record<string, any>} */
const obj = (value) => (value !== null && typeof value === 'object' ? /** @type {Record<string, any>} */ (value) : {});

/** Google's status word of an error answer, never its message. @param {string} text */
function googleStatus(text) {
  try {
    const status = obj(obj(JSON.parse(text)).error).status;
    return typeof status === 'string' && /^[A-Z_]{1,40}$/.test(status) ? status : null;
  } catch {
    return null;
  }
}

/** @param {string} page @param {boolean} extra */
async function psi(page, extra) {
  const query = new URLSearchParams({ url: page, category: 'PERFORMANCE', strategy: 'MOBILE' });
  if (extra) {
    query.append('category', 'ACCESSIBILITY');
    query.append('category', 'BEST_PRACTICES');
  }
  const started = performance.now();
  const response = await fetch(`${PSI}?${query}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(120_000) });
  const text = await response.text();
  const line = { page, categories: extra ? 'PERFORMANCE+ACCESSIBILITY+BEST_PRACTICES' : 'PERFORMANCE', status: response.status, ms: Math.round(performance.now() - started), bytes: Buffer.byteLength(text) };
  if (!response.ok) return { ...line, google_status: googleStatus(text) };
  const lighthouse = obj(obj(JSON.parse(text)).lighthouseResult);
  const audits = obj(lighthouse.audits);
  const nodes = obj(obj(lighthouse.fullPageScreenshot).nodes);
  return {
    ...line,
    lighthouse_version: typeof lighthouse.lighthouseVersion === 'string' ? lighthouse.lighthouseVersion.slice(0, 20) : null,
    ...(extra ? {
      audits: Object.fromEntries(AUDITS.map((id) => {
        const audit = obj(audits[id]);
        const items = obj(audit.details).items;
        return [id, audits[id] === undefined ? 'missing' : { mode: String(audit.scoreDisplayMode).slice(0, 20), score: typeof audit.score === 'number' ? audit.score : null, items: Array.isArray(items) ? items.length : null }];
      })),
    } : {}),
    screenshot_node_boxes: Object.keys(nodes).length,
  };
}

/** @param {string} origin */
async function cruxAds(origin) {
  const started = performance.now();
  const response = await fetch(CRUX, {
    method: 'POST', headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ origin, formFactor: 'PHONE', metrics: AD_METRICS }), signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const line = { crux_ads_origin: origin, status: response.status, ms: Math.round(performance.now() - started) };
  if (!response.ok) return { ...line, google_status: googleStatus(text) };
  return { ...line, metrics_returned: Object.keys(obj(obj(obj(JSON.parse(text)).record).metrics)).filter((name) => AD_METRICS.includes(name)) };
}

/** @param {number[]} values */
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? null : sorted[Math.floor((sorted.length - 1) / 2)];
};

const results = [];
for (const [index, page] of pages.entries()) {
  for (const extra of index % 2 === 0 ? [false, true] : [true, false]) {
    try {
      const line = await psi(page, extra);
      results.push(line);
      console.log(JSON.stringify(line));
    } catch (error) {
      console.log(JSON.stringify({ page, categories: extra ? 'with extra' : 'performance only', error: error instanceof Error ? error.name : 'error' }));
    }
  }
}
for (const origin of [...new Set(pages.map((page) => new URL(page).origin))]) {
  try {
    console.log(JSON.stringify(await cruxAds(origin)));
  } catch (error) {
    console.log(JSON.stringify({ crux_ads_origin: origin, error: error instanceof Error ? error.name : 'error' }));
  }
}
const ok = results.filter((line) => line.status === 200);
const plain = ok.filter((line) => line.categories === 'PERFORMANCE');
const extra = ok.filter((line) => line.categories !== 'PERFORMANCE');
console.log(JSON.stringify({
  summary: true, requests: results.length, answered: ok.length,
  median_ms: { performance: median(plain.map((line) => line.ms)), with_categories: median(extra.map((line) => line.ms)) },
  median_bytes: { performance: median(plain.map((line) => line.bytes)), with_categories: median(extra.map((line) => line.bytes)) },
}));
