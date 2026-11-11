import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContext, runChecks } from '../../../server/src/checks/engine.js';
import { checks } from '../../../server/src/checks/links/index.js';
import { prepareChecks } from '../../../server/src/checks/validate.js';
import { SITE, makeCrawl, makeLink, makePage, makeRedirect } from '../../helpers/factories.js';
import { NOW, outboundResult } from './support.js';

const EXPECTED_IDS = [
  'links.anchor.empty',
  'links.anchor.generic',
  'links.anchor.uncrawlable',
  'links.depth.deep',
  'links.internal.broken',
  'links.internal.insecure',
  'links.internal.nofollow',
  'links.internal.redirect',
  'links.orphan.sitemap_only',
  'links.outbound.broken',
];

test('the links module exports exactly the ten checks in the spec', () => {
  assert.deepEqual([...checks.map((check) => check.id)].sort(), EXPECTED_IDS);
});

test('every links definition passes prepareChecks', () => {
  const prepared = prepareChecks(checks);
  assert.deepEqual(prepared.map((check) => check.id), EXPECTED_IDS);
  assert.ok(prepared.every((check) => check.module === 'links' && check.engine === 'code'));
});

test('severity, weight, confidence, scope and requirements match the spec table', () => {
  /** @type {Record<string, [string, number, string, string, string[]]>} */
  const spec = {
    'links.internal.broken': ['high', 4, 'confirmed', 'page', []],
    'links.internal.redirect': ['low', 2, 'confirmed', 'page', []],
    'links.internal.nofollow': ['low', 1, 'confirmed', 'page', []],
    'links.internal.insecure': ['low', 1, 'confirmed', 'page', []],
    'links.anchor.uncrawlable': ['medium', 2, 'confirmed', 'page', []],
    'links.anchor.empty': ['medium', 2, 'confirmed', 'page', []],
    'links.anchor.generic': ['info', 0, 'likely', 'page', []],
    'links.orphan.sitemap_only': ['medium', 2, 'likely', 'site', ['full_crawl', 'sitemap']],
    'links.depth.deep': ['info', 0, 'likely', 'page', []],
    'links.outbound.broken': ['medium', 2, 'likely', 'page', ['outbound']],
  };
  assert.deepEqual(Object.keys(spec).sort(), EXPECTED_IDS);
  for (const check of checks) {
    const [severity, weight, confidence, scope, requires] = spec[check.id];
    assert.deepEqual(
      [check.severity, check.weight, check.confidence, check.scope, check.requires],
      [severity, weight, confidence, scope, requires],
      check.id,
    );
  }
});

test('each check points at the documentation page that was verified for it', () => {
  const links = 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable';
  const statusCodes = 'https://developers.google.com/crawling/docs/troubleshooting/http-status-codes';
  /** @type {Record<string, string>} */
  const expected = {
    'links.internal.broken': statusCodes,
    'links.internal.redirect': 'https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes',
    'links.internal.nofollow': 'https://developers.google.com/search/docs/crawling-indexing/qualify-outbound-links',
    'links.internal.insecure': 'https://web.dev/articles/enable-https',
    'links.anchor.uncrawlable': links,
    'links.anchor.empty': links,
    'links.anchor.generic': links,
    'links.orphan.sitemap_only': links,
    'links.depth.deep': 'https://developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure',
    'links.outbound.broken': statusCodes,
  };
  assert.deepEqual(Object.fromEntries(checks.map((check) => [check.id, check.doc_ref])), expected);
});

test('every definition carries a verified documentation reference and plain user-facing text', () => {
  for (const check of checks) {
    assert.equal(check.last_verified, '2026-11-11', check.id);
    assert.match(check.doc_ref, /^https:\/\/(developers\.google\.com|web\.dev)\//, check.id);
    assert.match(check.title, /^[A-Z][^.]*$/, check.id);
    assert.ok(check.recommendation.length > 20 && check.recommendation.endsWith('.'), check.id);
    assert.doesNotMatch(`${check.description} ${check.recommendation}`, /\b(rank|ranking|traffic)\b/i, check.id);
  }
});

test('a full run over a mixed crawl is deterministic and each finding names its check', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/old`, href: '/old', text: 'Click here' }),
      makeLink({ url: `${SITE}/gone`, href: '/gone', text: '', rel: ['nofollow'] }),
      makeLink({ url: 'https://dead.test/', href: 'https://dead.test/', internal: false }),
    ],
  });
  const pages = [
    home,
    makeRedirect(`${SITE}/old`, `${SITE}/new`),
    makePage({ url: `${SITE}/new`, depth: 6 }),
    makePage({ url: `${SITE}/gone`, status: 404, indexability: { indexable: false, reasons: ['status_404'] } }),
  ];
  const crawl = makeCrawl({ pages, sitemap: { files: [], urls: [`${SITE}/new`, `${SITE}/forgotten`], truncated: false } });
  const outbound = new Map([['https://dead.test/', outboundResult('https://dead.test/', 'broken', 404, 'not_found')]]);

  const run = () => runChecks(checks, buildContext(crawl, { outbound }), { modules: ['links'], detectedAt: NOW });
  const first = run();
  assert.deepEqual(first, run());

  const failing = [...new Set(first.findings.map((f) => f.check_id))].sort();
  assert.deepEqual(failing, [
    'links.anchor.empty',
    'links.anchor.generic',
    'links.depth.deep',
    'links.internal.broken',
    'links.internal.nofollow',
    'links.internal.redirect',
    'links.orphan.sitemap_only',
    'links.outbound.broken',
  ]);
  assert.ok(first.checks.every((stat) => stat.status === 'run'));
  assert.equal(first.modules.links.checks_run, 10);
});
