// The report's AI visibility layer and section from imported AI reports:
// Search Console's impressions in its generative AI features, and Bing's
// citations of the site in AI answers. Supplied by the user, not measured.

/** @import { AiImport } from '../imports/ai-record.js' */

/** Pages listed per source. */
const LISTED = 10;

export const AI_SUPPLIED = 'Imported from exports the user downloaded from Search Console and Bing Webmaster Tools. The figures are what the exports state; Seekwide did not measure them.';

const NAMES = /** @type {const} */ ({
  google_search_console_ai: { name: 'Google Search Console', report: 'Performance on Search Generative AI Features', metric: 'Impressions' },
  bing_ai_performance: { name: 'Bing Webmaster Tools', report: 'AI Performance, overview', metric: 'Citations' },
  bing_ai_pages: { name: 'Bing Webmaster Tools', report: 'AI Performance, pages', metric: 'Citations' },
});

/**
 * @typedef {Object} AiVisibilityView
 * @property {string} supplied
 * @property {{name: string, report: string, file: string, imported: string, period: string, figures: {label: string, value: string}[],
 *   metric: string, pages: {url: string, value: string}[], notes: string[]}[]} sources
 */

const count = (/** @type {number} */ value) => value.toLocaleString('en-US');

/**
 * @param {AiImport} data
 * @returns {{label: string, value: string}[]}
 */
function figures(data) {
  const totals = /** @type {Record<string, number>} */ (data.totals);
  if (data.source === 'google_search_console_ai') {
    return [{ label: 'Impressions in AI Overviews and AI Mode', value: count(totals.impressions) }, { label: 'Pages with impressions', value: count(data.pages.filter((page) => /** @type {any} */ (page).impressions > 0).length) }];
  }
  if (data.source === 'bing_ai_performance') {
    return [{ label: 'Citations in AI answers', value: count(totals.citations) }, { label: 'Days with a citation', value: `${count(totals.days_cited)} of ${count(data.dates.length)}` }, { label: 'Most pages cited on one day', value: count(totals.peak_cited_pages) }];
  }
  return [{ label: 'Citations in AI answers', value: count(totals.citations) }, { label: 'Pages cited', value: count(totals.pages_cited) }];
}

/**
 * The AI visibility section, or null without imported AI reports.
 * @param {AiImport[]} imports
 * @returns {AiVisibilityView|null}
 */
export function viewAiVisibility(imports) {
  if (imports.length === 0) return null;
  return {
    supplied: AI_SUPPLIED,
    sources: imports.map((data) => {
      const names = NAMES[data.source];
      /** @type {string[]} */
      const notes = [];
      if (data.source === 'google_search_console_ai') notes.push('Impressions only: the report has no clicks and no position.');
      if (data.source === 'bing_ai_pages' && data.period === null) notes.push('The export does not say which dates it covers.');
      return {
        name: names.name,
        report: names.report,
        file: data.file.path,
        imported: data.imported_at.slice(0, 10),
        period: data.period === null ? 'Not stated.' : `${data.period.start} to ${data.period.end}${data.period.from === 'user' ? ' (as stated when it was imported)' : ''}.`,
        figures: figures(data),
        metric: names.metric,
        pages: data.pages.slice(0, LISTED).map((page) => ({ url: page.url, value: count(/** @type {any} */ (page).impressions ?? /** @type {any} */ (page).citations) })),
        notes,
      };
    }),
  };
}

/**
 * The AI visibility layer of imported AI reports.
 * @param {AiVisibilityView} view
 * @returns {{name: string, measured: boolean, status: string, text: string, detail: string|null}}
 */
export function aiVisibilityLayer(view) {
  const parts = view.sources.map((source) => `${source.name} (${source.report}): ${source.figures[0].label.toLowerCase()} ${source.figures[0].value}, ${source.period}`);
  return {
    name: 'AI visibility',
    measured: true,
    status: 'Imported',
    text: `Whether AI search and assistants show or cite the site. ${parts.join(' ')} Not covered: other AI products and what the answers say.`,
    detail: AI_SUPPLIED,
  };
}
