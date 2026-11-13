import assert from 'node:assert/strict';
import { test } from 'node:test';

import { foreignScriptOf, scriptsOfLanguage, siteScripts } from '../../../plugin/server/src/checks/security/content.js';
import { SITE, makePage, makeSecurity } from '../../helpers/factories.js';
import { audit, findingsFor, statFor } from './support.js';

const SPAM = 'security.content.spam_terms';
const SCRIPT = 'security.content.foreign_script';

/**
 * @param {string} path
 * @param {Partial<import('../../../plugin/server/src/types.js').PageSecurity>} security
 * @param {Partial<import('../../../plugin/server/src/types.js').PageRecord>} [overrides]
 */
const page = (path, security, overrides = {}) => makePage({ url: `${SITE}${path}`, security: makeSecurity(security), ...overrides });

test(`${SPAM} fails a page with two or more terms of a kind the start page is not about`, () => {
  const result = audit([
    page('/', {}),
    page('/post', { spam_terms: { pharma: { count: 3, terms: ['viagra', 'cialis'] }, gambling: { count: 1, terms: ['togel'] } } }),
    page('/once', { spam_terms: { pharma: { count: 1, terms: ['viagra'] } } }),
  ]);
  const stat = statFor(result, SPAM);
  assert.deepEqual([stat.applicable, stat.failed], [3, 1]);
  const [finding] = findingsFor(result, SPAM);
  assert.equal(finding.url, `${SITE}/post`);
  assert.deepEqual(finding.evidence.observed, { pharma: { matches: 3, terms: ['viagra', 'cialis'] } });
  assert.match(finding.evidence.detail ?? '', /pharmaceutical spam terms \("viagra", "cialis"\)/);
});

test(`${SPAM} passes pages of a kind the start page's title, description or headings name`, () => {
  const result = audit([
    page('/', { topic_terms: { gambling: { count: 2, terms: ['casino'] } }, spam_terms: { gambling: { count: 5, terms: ['online casino'] } } }),
    page('/bonus', { spam_terms: { gambling: { count: 9, terms: ['free spins'] } } }),
  ]);
  assert.deepEqual(findingsFor(result, SPAM), []);
  assert.equal(statFor(result, SPAM).applicable, 2);
});

test(`${SPAM} reports spam on the start page itself when its title and headings are about something else`, () => {
  const result = audit([page('/', { spam_terms: { counterfeit: { count: 2, terms: ['replica watches'] } } })]);
  assert.deepEqual(findingsFor(result, SPAM).map((finding) => finding.url), [`${SITE}/`]);
});

test(`${SPAM} has no unit when the start page could not be read`, () => {
  const result = audit([
    page('/', {}, { status: 503, is_html: true }),
    page('/post', { spam_terms: { pharma: { count: 3, terms: ['viagra'] } } }),
  ]);
  assert.equal(statFor(result, SPAM).applicable, 0);
});

test(`${SCRIPT} fails a page mostly in a writing system the start page hardly uses, when its lang names another`, () => {
  const result = audit([
    page('/', { scripts: { latin: 3000, cjk: 40 } }),
    page('/sale', { scripts: { latin: 300, cjk: 160 } }, { html_lang: 'en' }),
    page('/ja/', { scripts: { latin: 200, cjk: 900 } }, { html_lang: 'ja' }),
    page('/ru', { scripts: { cyrillic: 500 } }, { html_lang: null, headers: { 'content-language': 'ru-RU' } }),
    page('/quote', { scripts: { latin: 2000, cjk: 120 } }, { html_lang: 'en' }),
  ]);
  const stat = statFor(result, SCRIPT);
  assert.deepEqual([stat.applicable, stat.failed], [4, 1]);
  const [finding] = findingsFor(result, SCRIPT);
  assert.equal(finding.url, `${SITE}/sale`);
  assert.equal(finding.selector, 'html');
  assert.deepEqual(finding.evidence.observed, { script: 'cjk', letters: 160, share: 0.35, declared: ['en'] });
  assert.match(finding.evidence.detail ?? '', /the language the page declares \("en"\) is written in another script/);
  assert.match(finding.evidence.detail ?? '', /160 letters \(35% of the page's text\) are in Chinese or Japanese characters/);
});

test(`${SCRIPT} never reports Latin text, a system the site uses, or a page without a declared language that is too short`, () => {
  const result = audit([
    page('/', { scripts: { cyrillic: 2000, latin: 300 } }, { html_lang: 'ru' }),
    page('/en', { scripts: { latin: 3000 } }, { html_lang: 'ru' }),
    page('/ua', { scripts: { cyrillic: 900 } }, { html_lang: 'ru' }),
    page('/short', { scripts: { arabic: 90 } }, { html_lang: null }),
  ]);
  assert.deepEqual(findingsFor(result, SCRIPT), []);
  assert.equal(statFor(result, SCRIPT).applicable, 3);
  const undeclared = audit([page('/', { scripts: { latin: 900 } }), page('/ar', { scripts: { arabic: 400 } }, { html_lang: null })]);
  assert.match(findingsFor(undeclared, SCRIPT)[0].evidence.detail ?? '', /does not declare a language/);
  const header = audit([page('/', { scripts: { latin: 900 } }), page('/ru', { scripts: { cyrillic: 400 } }, { html_lang: null, headers: { 'content-language': 'en' } })]);
  assert.match(findingsFor(header, SCRIPT)[0].evidence.detail ?? '', /the language the page declares \("en"\)/, 'a Content-Language header is a declaration');
});

test(`${SCRIPT} has no unit when the start page has too few letters to tell the site's writing systems`, () => {
  const result = audit([page('/', { scripts: { latin: 150 } }), page('/ja', { scripts: { cjk: 900 } }, { html_lang: 'en' })]);
  assert.equal(statFor(result, SCRIPT).applicable, 0);
});

test('languages map to their writing systems, script subtags first', () => {
  assert.deepEqual(scriptsOfLanguage('ja-JP'), ['cjk']);
  assert.deepEqual(scriptsOfLanguage('ZH_hant'), ['cjk']);
  assert.deepEqual(scriptsOfLanguage('sr-Latn'), ['latin']);
  assert.deepEqual(scriptsOfLanguage('sr'), ['cyrillic', 'latin']);
  assert.deepEqual(scriptsOfLanguage('uz-Cyrl-UZ'), ['cyrillic']);
  assert.deepEqual(scriptsOfLanguage('tr'), ['latin']);
  assert.deepEqual(scriptsOfLanguage(' he '), ['hebrew']);
});

test('the site systems and the foreign system follow the documented shares', () => {
  assert.equal(siteScripts({ latin: 199 }), null);
  assert.deepEqual([...(siteScripts({ latin: 950, greek: 50 }) ?? [])].sort(), ['greek', 'latin']);
  assert.deepEqual([...(siteScripts({ latin: 951, greek: 49 }) ?? [])], ['latin']);
  const site = new Set(['latin']);
  assert.equal(foreignScriptOf({ latin: 233, thai: 100 }, site)?.script, 'thai');
  assert.equal(foreignScriptOf({ latin: 234, thai: 100 }, site), null, 'below 30%');
  assert.equal(foreignScriptOf({ thai: 99 }, site), null, 'below 100 letters');
  assert.equal(foreignScriptOf({ other: 900 }, site), null, 'systems the check does not tell apart');
  assert.equal(foreignScriptOf({ hangul: 300, cjk: 400 }, site)?.script, 'cjk', 'the largest one');
});
