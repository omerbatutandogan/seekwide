import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makePage, makeRedirect } from '../../helpers/factories.js';
import { audit } from './helpers.js';

/** @import { CanonicalRef } from '../../../server/src/types.js' */

/**
 * @param {string} href
 * @param {Partial<CanonicalRef>} [overrides]
 * @returns {CanonicalRef}
 */
function canonical(href, overrides = {}) {
  const resolved = href.trim() === '' ? null : new URL(href, SITE);
  const url = resolved && (resolved.protocol === 'http:' || resolved.protocol === 'https:') ? resolved.href : null;
  return { href, url, source: 'html', in_head: true, line: 7, ...overrides };
}

const NOINDEX = { indexable: false, reasons: ['noindex_meta'] };
const ELSEWHERE = { indexable: false, reasons: ['canonical_elsewhere'] };

test('seo.canonical.missing fails indexable pages without an effective canonical', () => {
  const pages = [
    makePage({ url: `${SITE}/ok` }),
    makePage({ url: `${SITE}/header`, canonicals: [canonical(`${SITE}/header`, { source: 'header', line: null })] }),
    makePage({ url: `${SITE}/none`, canonicals: [] }),
    makePage({ url: `${SITE}/body-only`, canonicals: [canonical(`${SITE}/body-only`, { in_head: false })] }),
    makePage({ url: `${SITE}/hidden`, canonicals: [], indexability: NOINDEX }),
  ];
  const { units, failed, findings } = audit('seo.canonical.missing', { pages });
  assert.deepEqual(units, [`${SITE}/body-only`, `${SITE}/header`, `${SITE}/none`, `${SITE}/ok`]);
  assert.deepEqual(failed, [`${SITE}/body-only`, `${SITE}/none`]);
  assert.equal(findings[0].selector, 'link[rel=canonical]');
});

test('seo.canonical.multiple fails conflicting canonicals but not a header and link that agree', () => {
  const pages = [
    makePage({
      url: `${SITE}/conflict`,
      canonicals: [canonical(`${SITE}/a`), canonical(`${SITE}/b`, { line: 9 })],
      indexability: ELSEWHERE,
    }),
    makePage({
      url: `${SITE}/agree`,
      canonicals: [canonical(`${SITE}/agree`, { source: 'header', line: null }), canonical(`${SITE}/agree`)],
    }),
    makePage({ url: `${SITE}/ignored-body`, canonicals: [canonical(`${SITE}/ignored-body`), canonical(`${SITE}/x`, { in_head: false })] }),
    makePage({ url: `${SITE}/none`, canonicals: [] }),
  ];
  const { units, failed, findings } = audit('seo.canonical.multiple', { pages });
  assert.deepEqual(units, [`${SITE}/agree`, `${SITE}/conflict`, `${SITE}/ignored-body`]);
  assert.deepEqual(failed, [`${SITE}/conflict`]);
  assert.equal(findings[0].line, 9);
  assert.deepEqual(findings[0].evidence.observed, [`${SITE}/a`, `${SITE}/b`]);
});

test('seo.canonical.outside_head fails a canonical link in the body and ignores header-only pages', () => {
  const pages = [
    makePage({ url: `${SITE}/body`, canonicals: [canonical(`${SITE}/body`, { in_head: false, line: 80 })] }),
    makePage({ url: `${SITE}/head` }),
    makePage({ url: `${SITE}/header-only`, canonicals: [canonical(`${SITE}/header-only`, { source: 'header', line: null })] }),
  ];
  const { units, failed, findings } = audit('seo.canonical.outside_head', { pages });
  assert.deepEqual(units, [`${SITE}/body`, `${SITE}/head`]);
  assert.deepEqual(failed, [`${SITE}/body`]);
  assert.equal(findings[0].line, 80);
});

test('seo.canonical.streamed_in_body fails a streamed canonical; outside_head and missing leave that page alone', () => {
  const pages = [
    makePage({ url: `${SITE}/streamed`, canonicals: [canonical(`${SITE}/streamed`, { in_head: false, streamed: true, line: 7 })] }),
    makePage({ url: `${SITE}/both`, canonicals: [canonical(`${SITE}/both`, { source: 'header', line: null }), canonical(`${SITE}/both`, { in_head: false, streamed: true })] }),
    makePage({ url: `${SITE}/body`, canonicals: [canonical(`${SITE}/body`, { in_head: false })] }),
    makePage({ url: `${SITE}/head` }),
    makePage({ url: `${SITE}/header-only`, canonicals: [canonical(`${SITE}/header-only`, { source: 'header', line: null })] }),
  ];
  const streamed = audit('seo.canonical.streamed_in_body', { pages });
  assert.deepEqual(streamed.units, [`${SITE}/body`, `${SITE}/both`, `${SITE}/head`, `${SITE}/streamed`]);
  assert.deepEqual(streamed.failed, [`${SITE}/both`, `${SITE}/streamed`]);
  const finding = streamed.findings.find((f) => f.url === `${SITE}/streamed`);
  assert.equal(finding?.line, 7);
  assert.equal(finding?.confidence, 'likely');
  const outside = audit('seo.canonical.outside_head', { pages });
  assert.deepEqual(outside.units, [`${SITE}/body`, `${SITE}/head`]);
  assert.deepEqual(outside.failed, [`${SITE}/body`]);
  const missing = audit('seo.canonical.missing', { pages });
  assert.deepEqual(missing.units, [`${SITE}/body`, `${SITE}/both`, `${SITE}/head`, `${SITE}/header-only`]);
  assert.deepEqual(missing.failed, [`${SITE}/body`]);
});

test('seo.canonical.invalid fails canonicals without a usable URL', () => {
  const pages = [
    makePage({ url: `${SITE}/empty`, canonicals: [canonical('')] }),
    makePage({ url: `${SITE}/js`, canonicals: [canonical('javascript:void(0)')] }),
    makePage({ url: `${SITE}/ok` }),
    makePage({ url: `${SITE}/none`, canonicals: [] }),
  ];
  const { units, failed } = audit('seo.canonical.invalid', { pages });
  assert.deepEqual(units, [`${SITE}/empty`, `${SITE}/js`, `${SITE}/ok`]);
  assert.deepEqual(failed, [`${SITE}/empty`, `${SITE}/js`]);
});

test('seo.canonical.relative fails hrefs that do not start with http:// or https://', () => {
  const pages = [
    makePage({ url: `${SITE}/rel`, canonicals: [canonical('/rel')] }),
    makePage({ url: `${SITE}/proto`, canonicals: [canonical('//example.test/proto')] }),
    makePage({ url: `${SITE}/abs`, canonicals: [canonical('HTTPS://example.test/abs')] }),
    makePage({ url: `${SITE}/none`, canonicals: [] }),
  ];
  const { units, failed, findings } = audit('seo.canonical.relative', { pages });
  assert.deepEqual(units, [`${SITE}/abs`, `${SITE}/proto`, `${SITE}/rel`]);
  assert.deepEqual(failed, [`${SITE}/proto`, `${SITE}/rel`]);
  assert.deepEqual(findings[1].evidence.observed, ['<link> href: /rel']);
});

test('seo.canonical.target_not_ok fails canonicals pointing at error, redirect, non-HTML or noindex targets', () => {
  const to = (/** @type {string} */ from, /** @type {string} */ target) =>
    makePage({ url: `${SITE}/${from}`, canonicals: [canonical(`${SITE}/${target}`)], indexability: ELSEWHERE });
  const pages = [
    to('p1', 'good'),
    to('p2', 'gone'),
    to('p3', 'moved'),
    to('p4', 'file'),
    to('p5', 'hidden'),
    to('p6', 'not-crawled'),
    makePage({ url: `${SITE}/self` }),
    makePage({ url: `${SITE}/good` }),
    makePage({ url: `${SITE}/gone`, status: 404, indexability: { indexable: false, reasons: ['status_404'] } }),
    makeRedirect(`${SITE}/moved`, `${SITE}/good`),
    makePage({ url: `${SITE}/file`, is_html: false, indexability: { indexable: false, reasons: ['not_html'] } }),
    makePage({ url: `${SITE}/hidden`, indexability: NOINDEX }),
  ];
  const { units, failed, findings } = audit('seo.canonical.target_not_ok', { pages });
  assert.deepEqual(units, [`${SITE}/p1`, `${SITE}/p2`, `${SITE}/p3`, `${SITE}/p4`, `${SITE}/p5`]);
  assert.deepEqual(failed, [`${SITE}/p2`, `${SITE}/p3`, `${SITE}/p4`, `${SITE}/p5`]);
  assert.match(findings.find((f) => f.url === `${SITE}/p5`)?.evidence.detail ?? '', /noindex/);
  assert.equal(findings[0].line, 7);
});

test('seo.canonical.target_not_ok has no unit when the crawler was refused on the target', () => {
  const page = makePage({ url: `${SITE}/p`, canonicals: [canonical(`${SITE}/wall`)], indexability: ELSEWHERE });
  const wall = makePage({
    url: `${SITE}/wall`,
    status: 503,
    is_html: false,
    fetch_error: 'bot_challenge',
    indexability: { indexable: false, reasons: ['fetch_error'] },
  });
  assert.equal(audit('seo.canonical.target_not_ok', { pages: [page, wall] }).stat.applicable, 0);

  const chained = makePage({ url: `${SITE}/q`, canonicals: [canonical(`${SITE}/hop`)], indexability: ELSEWHERE });
  const hop = makeRedirect(`${SITE}/hop`, `${SITE}/admin`, { final_status: 0, fetch_error: 'robots_disallowed' });
  const { units, failed } = audit('seo.canonical.target_not_ok', { pages: [chained, hop] });
  assert.deepEqual([units, failed], [[`${SITE}/q`], [`${SITE}/q`]]);
});

test('seo.canonical.target_not_ok has no unit when the canonicals conflict', () => {
  const page = makePage({ url: `${SITE}/p`, canonicals: [canonical(`${SITE}/gone`), canonical(`${SITE}/other`)] });
  const gone = makePage({ url: `${SITE}/gone`, status: 404, indexability: { indexable: false, reasons: ['status_404'] } });
  assert.equal(audit('seo.canonical.target_not_ok', { pages: [page, gone] }).stat.applicable, 0);
});

test('seo.canonical.cross_host fails canonicals on another host and accepts www variants', () => {
  const pages = [
    makePage({ url: `${SITE}/other`, canonicals: [canonical('https://another.test/other')], indexability: ELSEWHERE }),
    makePage({ url: `${SITE}/www`, canonicals: [canonical('https://www.example.test/www')], indexability: ELSEWHERE }),
    makePage({ url: `${SITE}/self` }),
    makePage({ url: `${SITE}/none`, canonicals: [] }),
  ];
  const { units, failed, findings } = audit('seo.canonical.cross_host', { pages });
  assert.deepEqual(units, [`${SITE}/other`, `${SITE}/self`, `${SITE}/www`]);
  assert.deepEqual(failed, [`${SITE}/other`]);
  assert.deepEqual(findings[0].evidence.observed, ['https://another.test/other']);
});
