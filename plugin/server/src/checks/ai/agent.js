// Whether agents that act for a user can work the site's pages (ai module):
// they read the accessibility tree, so every button needs a name, and a form
// that offers itself to them as a WebMCP tool needs both of the attributes
// that describe it. Pure.

/** @import { CheckDef, CheckResult, FormsRecord, PageRecord } from '../../types.js' */

import { AI, DOCS } from './helpers.js';

/** The date the rules of this file were read against their sources. */
export const AGENT_VERIFIED = '2026-11-24';
const MAX_EXAMPLES = 5;

/**
 * The indexable html pages whose forms record was read whole, with it.
 * @param {PageRecord[]} pages
 * @returns {{page: PageRecord, forms: FormsRecord}[]}
 */
const readPages = (pages) => pages.flatMap((page) => (page.status === 200 && page.is_html && page.forms !== undefined && page.forms.failed !== true
  ? [{ page, forms: page.forms }] : []));

/** @type {CheckDef} */
const buttonUnnamed = {
  ...AI,
  last_verified: AGENT_VERIFIED,
  id: 'ai.agent.button_unnamed',
  title: 'A button has no name an agent can read',
  description:
    'Checks each indexable html page for visible buttons (a <button>, or an input of type button or image) with no accessible name: no text, no image text, no aria-label, aria-labelledby or title, and for an input no value or alt. Chrome says agents rely on the accessibility tree as their primary data model and that its audits verify that every interactive element has a programmatic name; OpenAI says ChatGPT Atlas uses ARIA labels and roles to interpret a page. A name set by a script after the page loads is not seen.',
  severity: 'low',
  weight: 1,
  impact: 2,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: ['agent_pages'],
  doc_ref: DOCS.CHROME_AGENT_READY,
  recommendation: 'Give each button a visible text, or an aria-label when it shows only an icon (an image button needs alt text). Screen reader users get the same name.',
  run(ctx) {
    return readPages(ctx.indexablePages).flatMap(({ page, forms }) => {
      const buttons = forms.buttons;
      if (buttons === undefined || buttons.visible === 0) return [];
      if (buttons.unnamed === 0) return [/** @type {CheckResult} */ ({ status: 'pass', url: page.url })];
      return [/** @type {CheckResult} */ ({
        status: 'fail', url: page.url, line: buttons.examples[0]?.line ?? null,
        evidence: {
          observed: { buttons: buttons.visible, unnamed: buttons.unnamed, examples: buttons.examples.slice(0, MAX_EXAMPLES) },
          expected: 'Every visible button has an accessible name',
          detail: 'Chrome: "Agents rely on the accessibility tree, derived from DOM for assistive technology (AT), as their primary data model."',
        },
      })];
    });
  },
};

/** @type {CheckDef} */
const webmcpIncomplete = {
  ...AI,
  last_verified: AGENT_VERIFIED,
  id: 'ai.agent.webmcp_incomplete',
  title: 'A form declares a WebMCP tool with only one of its two attributes',
  description:
    'Checks each form on an html page that has a WebMCP toolname or tooldescription attribute for the other one, the first two conditions of Lighthouse\'s experimental WebMCP schema validity audit. WebMCP is a proposed standard, in an origin trial in Chrome, that lets a page describe its forms as tools for AI agents; information only. Lighthouse\'s third condition, a required field without a name, does not say what makes a field required and is not checked.',
  severity: 'info',
  weight: 0,
  impact: 1,
  effort: 1,
  confidence: 'likely',
  scope: 'page',
  requires: ['agent_pages'],
  doc_ref: DOCS.LIGHTHOUSE_WEBMCP,
  recommendation: 'Give the form both toolname (a short identifier) and tooldescription (what the tool does), or remove both if the form is not meant to be a tool.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const { page, forms } of readPages(ctx.htmlPages)) {
      forms.forms.forEach((form, index) => {
        const name = form.tool_name ?? null;
        const description = form.tool_description ?? null;
        if (name === null && description === null) return;
        const selector = `form[${index + 1}]`;
        if (name !== null && description !== null) {
          results.push({ status: 'pass', url: page.url, selector, line: form.line });
          return;
        }
        results.push({
          status: 'fail', url: page.url, selector, line: form.line,
          evidence: {
            observed: { toolname: name, tooldescription: description },
            expected: 'Both toolname and tooldescription',
            detail: 'Lighthouse fails a form that has a tooldescription but no toolname, or a toolname but no tooldescription.',
          },
        });
      });
    }
    return results;
  },
};

export const agentChecks = [buttonUnnamed, webmcpIncomplete];
