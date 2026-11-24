import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContext, runChecks } from '../../../plugin/server/src/checks/engine.js';
import { checks } from '../../../plugin/server/src/checks/ai/index.js';
import { emptyForms } from '../../../plugin/server/src/extract/forms.js';
import { SITE, makeCrawl, makePage } from '../../helpers/factories.js';

/** @import { FormRecord, FormsRecord, PageRecord } from '../../../plugin/server/src/types.js' */

const NOW = '2026-11-24T00:00:00.000Z';

/** @param {Partial<FormRecord>} [fields] @returns {FormRecord} */
const form = (fields = {}) => ({ line: 3, id: null, name: null, action: null, method: 'get', search: false, fields: 1, tool_name: null, tool_description: null, ...fields });

/** @param {string} path @param {Partial<FormsRecord>} forms @param {Partial<PageRecord>} [overrides] */
const page = (path, forms, overrides = {}) => makePage({ url: `${SITE}${path}`, forms: { ...emptyForms(), ...forms }, ...overrides });

/** @param {PageRecord[]} pages */
const audit = (pages) => runChecks(checks, buildContext(makeCrawl({ pages }), {}), { modules: ['ai'], detectedAt: NOW });

/** @param {ReturnType<typeof audit>} result @param {string} id */
const stat = (result, id) => {
  const found = result.checks.find((entry) => entry.id === id);
  if (!found) throw new Error(`no stat for ${id}`);
  return found.status === 'skipped' ? 'skipped' : [found.applicable, found.failed];
};
/** @param {ReturnType<typeof audit>} result @param {string} id */
const findings = (result, id) => result.findings.filter((finding) => finding.check_id === id);

test('ai.agent.button_unnamed: an indexable page with a visible button that has no name', () => {
  const unnamed = { visible: 3, unnamed: 2, examples: [{ tag: /** @type {const} */ ('button'), type: 'button', line: 12 }, { tag: /** @type {const} */ ('input'), type: 'image', line: 20 }] };
  const result = audit([
    page('/', { buttons: unnamed }),
    page('/ok', { buttons: { visible: 2, unnamed: 0, examples: [] } }),
    page('/none', {}),
    page('/failed', { failed: true, buttons: unnamed }),
    page('/noindex', { buttons: unnamed }, { indexability: { indexable: false, reasons: ['noindex_meta'] } }),
  ]);
  assert.deepEqual(stat(result, 'ai.agent.button_unnamed'), [2, 1], 'a page without buttons, a failed reading and a page that is not indexable are not units');
  const [finding] = findings(result, 'ai.agent.button_unnamed');
  assert.equal(finding.url, `${SITE}/`);
  assert.equal(finding.line, 12);
  assert.deepEqual(finding.evidence.observed, { buttons: 3, unnamed: 2, examples: unnamed.examples });
  assert.equal(finding.severity, 'low');
});

test('ai.agent.webmcp_incomplete: a form with one of toolname and tooldescription', () => {
  const result = audit([page('/', { forms: [form(), form({ tool_name: 'book', tool_description: 'Book a table' }), form({ tool_name: 'search' }), form({ tool_description: 'Sign up' })] })]);
  assert.deepEqual(stat(result, 'ai.agent.webmcp_incomplete'), [3, 2], 'a form without either is not a unit');
  assert.deepEqual(findings(result, 'ai.agent.webmcp_incomplete').map((finding) => [finding.selector, finding.evidence.observed]), [
    ['form[3]', { toolname: 'search', tooldescription: null }],
    ['form[4]', { toolname: null, tooldescription: 'Sign up' }],
  ]);
  assert.equal(findings(result, 'ai.agent.webmcp_incomplete')[0].severity, 'info');
});

test('the agent checks are skipped for a crawl made before rule set 0.2.2', () => {
  const old = makePage({ forms: { forms: [], controls: [], hidden_controls: 0, tcf_stub: false, first_action: null } });
  for (const id of ['ai.agent.button_unnamed', 'ai.agent.webmcp_incomplete']) assert.equal(stat(audit([old]), id), 'skipped', id);
});
