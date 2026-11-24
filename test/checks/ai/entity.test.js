import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContext, runChecks } from '../../../plugin/server/src/checks/engine.js';
import { checks } from '../../../plugin/server/src/checks/ai/index.js';
import { SITE, makeCrawl, makePage } from '../../helpers/factories.js';

/** @import { ProfileEntity, PageRecord } from '../../../plugin/server/src/types.js' */

const NOW = '2026-11-24T00:00:00.000Z';

/**
 * An entity as a record of rule set 0.2.2 or later has it.
 * @param {Partial<ProfileEntity>} [fields]
 * @returns {ProfileEntity}
 */
const entity = (fields = {}) => ({ type: 'Organization', same_as: 0, id: null, name: 'Example', url: `${SITE}/`, logo: `${SITE}/logo.png`, ...fields });

/**
 * A page with one JSON-LD block holding the entities.
 * @param {string} path
 * @param {ProfileEntity[]} profiles
 * @param {Partial<PageRecord>} [overrides]
 */
const page = (path, profiles, overrides = {}) => makePage({
  url: `${SITE}${path}`, jsonld: [{ valid: true, types: profiles.map((item) => item.type), error: null, line: 1, videos: [], profiles }], ...overrides,
});

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

test('the entity checks are information and change no count', () => {
  for (const id of ['ai.entity.missing', 'ai.entity.url_offsite', 'ai.entity.inconsistent']) {
    const check = checks.find((item) => item.id === id);
    assert.ok(check, id);
    assert.equal(check.severity, 'info');
    assert.equal(check.weight, 0);
  }
});

test('ai.entity.missing: no page has an Organization, a business or a Person; one on the about page is enough', () => {
  const none = audit([page('/', []), page('/about', [])]);
  assert.deepEqual(stat(none, 'ai.entity.missing'), [1, 1]);
  assert.equal(findings(none, 'ai.entity.missing')[0].url, `${SITE}/`);
  assert.deepEqual(stat(audit([page('/', []), page('/about', [entity()])]), 'ai.entity.missing'), [1, 0]);
  assert.deepEqual(stat(audit([page('/', [entity({ type: 'Person' })])]), 'ai.entity.missing'), [1, 0]);
  assert.deepEqual(stat(audit([page('/', [], { status: 404 })]), 'ai.entity.missing'), [0, 0], 'no readable start page, no unit');
});

test('ai.entity.url_offsite: the start page\'s Organization names another site; a sister host and a relative url pass', () => {
  const result = audit([page('/', [
    entity({ url: 'https://other.test/' }),
    entity({ url: '/' }),
    entity({ url: 'https://shop.example.test/' }),
    entity({ type: 'Person', url: 'https://linkedin.com/in/someone' }),
    entity({ url: null }),
    entity({ url: 'mailto:hi@example.test' }),
  ])]);
  assert.deepEqual(stat(result, 'ai.entity.url_offsite'), [4, 2], 'a Person and an entity without url are not units');
  assert.deepEqual(findings(result, 'ai.entity.url_offsite').map((finding) => finding.evidence.observed?.url), ['https://other.test/', 'mailto:hi@example.test']);
  assert.deepEqual(stat(audit([page('/about', [entity({ url: 'https://other.test/' })]), page('/', [])]), 'ai.entity.url_offsite'), [0, 0], 'only the start page is read');
});

test('ai.entity.inconsistent: one entity named or drawn differently on two pages', () => {
  const same = audit([page('/', [entity()]), page('/about', [entity({ name: '  example ', url: 'http://example.test/' })]), page('/blog', [entity({ logo: null })])]);
  assert.deepEqual(stat(same, 'ai.entity.inconsistent'), [1, 0], 'case, spaces, the scheme and a missing logo are not differences');

  const differ = audit([
    page('/', [entity()]),
    page('/about', [entity({ name: 'Example Ltd' })]),
    page('/contact', [entity({ logo: '/new-logo.svg' })]),
    page('/team', [entity({ type: 'Person', name: 'Ada', url: '/team/ada' })]),
  ]);
  assert.deepEqual(stat(differ, 'ai.entity.inconsistent'), [1, 1], 'an entity on one page only is not a unit');
  const [finding] = findings(differ, 'ai.entity.inconsistent');
  assert.equal(finding.selector, '//example.test/');
  assert.deepEqual(finding.evidence.observed, {
    type: 'Organization', pages: 3,
    names: [{ value: 'Example', page: `${SITE}/` }, { value: 'Example Ltd', page: `${SITE}/about` }],
    logos: [{ value: `${SITE}/logo.png`, page: `${SITE}/` }, { value: `${SITE}/new-logo.svg`, page: `${SITE}/contact` }],
  });
  assert.deepEqual(finding.related_urls, [`${SITE}/`, `${SITE}/about`, `${SITE}/contact`]);
});

test('ai.entity.inconsistent: without a url an entity is known by its @id on the site; another site\'s entities are not compared', () => {
  const result = audit([
    page('/', [entity({ url: null, id: `${SITE}/#org` }), entity({ url: 'https://partner.test/', name: 'Partner' })]),
    page('/about', [entity({ url: null, id: '/#org', name: 'Other' }), entity({ url: 'https://partner.test/', name: 'Partner Inc' })]),
  ]);
  assert.deepEqual(stat(result, 'ai.entity.inconsistent'), [1, 1]);
  assert.equal(findings(result, 'ai.entity.inconsistent')[0].selector, '//example.test/#org');
});

test('the entity checks are skipped for a crawl whose records do not name the entities', () => {
  const old = makePage({ jsonld: [{ valid: true, types: ['Organization'], error: null, line: 1, profiles: [{ type: 'Organization', same_as: 0 }] }] });
  for (const id of ['ai.entity.missing', 'ai.entity.url_offsite', 'ai.entity.inconsistent']) assert.equal(stat(audit([old]), id), 'skipped', id);
  const older = makePage({ jsonld: [{ valid: true, types: ['Organization'], error: null, line: 1 }] });
  assert.equal(stat(audit([older]), 'ai.entity.missing'), 'skipped', 'before rule set 0.1.9');
  assert.deepEqual(stat(audit([makePage({ jsonld: [] })]), 'ai.entity.missing'), [1, 1], 'a page without JSON-LD says nothing about the record\'s age');
});
