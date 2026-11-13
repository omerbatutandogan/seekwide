import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContext } from '../../../plugin/server/src/checks/engine.js';
import { SITE, makeCrawl, makeLink, makePage, makeRedirect } from '../../helpers/factories.js';
import { audit, checkById, findingsFor, makeRawLink, statFor } from './support.js';

/** @import { PageRecord } from '../../../plugin/server/src/types.js' */

const errorPage = (/** @type {string} */ path, /** @type {Partial<PageRecord>} */ extra = {}) =>
  makePage({ url: `${SITE}${path}`, status: 404, indexability: { indexable: false, reasons: ['status_404'] }, ...extra });

/** A target the crawler was refused on: no content, a status that says nothing about the site. */
const refusedPage = (/** @type {string} */ path, /** @type {number} */ status, /** @type {string} */ fetchError) =>
  makePage({
    url: `${SITE}${path}`,
    status,
    is_html: false,
    content_type: null,
    fetch_error: fetchError,
    indexability: { indexable: false, reasons: ['fetch_error'] },
  });

/** A redirect whose chain ended without a usable response. */
const unfinishedRedirect = (/** @type {string} */ path, /** @type {Partial<PageRecord>} */ extra) =>
  makeRedirect(`${SITE}${path}`, `${SITE}${path}-end`, { final_status: 0, ...extra });

const OFF_SITE = 'https://elsewhere.test/page';

// ───────────── links.internal.broken ─────────────

test('links.internal.broken fails on error statuses, failed fetches and redirects that end in an error', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/gone`, href: '/gone', line: 12 }),
      makeLink({ url: `${SITE}/boom`, href: '/boom' }),
      makeLink({ url: `${SITE}/down`, href: '/down' }),
      makeLink({ url: `${SITE}/old`, href: '/old' }),
      makeLink({ url: `${SITE}/fine`, href: '/fine' }),
    ],
  });
  const pages = [
    home,
    errorPage('/gone'),
    makePage({ url: `${SITE}/boom`, status: 500, indexability: { indexable: false, reasons: ['status_500'] } }),
    makePage({ url: `${SITE}/down`, status: 0, is_html: false, fetch_error: 'timeout', indexability: { indexable: false, reasons: ['fetch_error'] } }),
    makeRedirect(`${SITE}/old`, `${SITE}/gone`, { final_status: 404 }),
    makePage({ url: `${SITE}/fine` }),
  ];

  const { result } = audit(pages);
  const stat = statFor(result, 'links.internal.broken');
  assert.equal(stat.applicable, 5);
  assert.equal(stat.failed, 4);
  assert.equal(stat.passed, 1);

  const bySelector = Object.fromEntries(findingsFor(result, 'links.internal.broken').map((f) => [f.selector, f]));
  assert.deepEqual(Object.keys(bySelector).sort(), ['a[href="/boom"]', 'a[href="/down"]', 'a[href="/gone"]', 'a[href="/old"]']);

  const gone = bySelector['a[href="/gone"]'];
  assert.equal(gone.url, `${SITE}/`);
  assert.equal(gone.line, 12);
  assert.equal(gone.severity, 'high');
  assert.equal(gone.confidence, 'confirmed');
  assert.deepEqual(gone.evidence.observed, { target_url: `${SITE}/gone`, status: 404, final_status: 404, fetch_error: null });
  assert.equal(gone.evidence.expected, 'A target that answers with a status below 400');
  assert.equal(gone.evidence.detail, `${SITE}/gone answered 404.`);

  assert.match(bySelector['a[href="/down"]'].evidence.detail ?? '', /could not be fetched \(timeout\)/);
  assert.match(bySelector['a[href="/old"]'].evidence.detail ?? '', /redirects to .*\/gone, which answered 404/);
  assert.equal(bySelector['a[href="/boom"]'].evidence.detail, `${SITE}/boom answered 500.`);
});

test('links.internal.broken fails from status 400 up and passes 399 and below', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/bad-request`, href: '/bad-request' }),
      makeLink({ url: `${SITE}/not-modified`, href: '/not-modified' }),
      makeLink({ url: `${SITE}/no-content`, href: '/no-content' }),
    ],
  });
  const pages = [
    home,
    makePage({ url: `${SITE}/bad-request`, status: 400, indexability: { indexable: false, reasons: ['status_400'] } }),
    makePage({ url: `${SITE}/not-modified`, status: 304, is_html: false, indexability: { indexable: false, reasons: ['status_304'] } }),
    makePage({ url: `${SITE}/no-content`, status: 204, is_html: false, indexability: { indexable: false, reasons: ['status_204'] } }),
  ];

  const { result } = audit(pages);
  assert.equal(statFor(result, 'links.internal.broken').applicable, 3);
  assert.deepEqual(findingsFor(result, 'links.internal.broken').map((f) => f.selector), ['a[href="/bad-request"]']);
});

test('links.internal.broken does not count targets the crawler was refused on or that redirect off the site', () => {
  const links = ['/challenge', '/limited', '/go', '/guarded', '/blocked', '/fine', '/gone'].map((href) =>
    makeLink({ url: `${SITE}${href}`, href }),
  );
  const pages = [
    makePage({ url: `${SITE}/`, links }),
    refusedPage('/challenge', 503, 'bot_challenge'),
    refusedPage('/limited', 429, 'rate_limited'),
    makeRedirect(`${SITE}/go`, OFF_SITE, { final_external: true, final_status: 0 }),
    unfinishedRedirect('/guarded', { fetch_error: 'bot_challenge' }),
    unfinishedRedirect('/blocked', { fetch_error: 'robots_disallowed' }),
    makePage({ url: `${SITE}/fine` }),
    errorPage('/gone'),
  ];

  const { result } = audit(pages);
  const stat = statFor(result, 'links.internal.broken');
  // Only /fine and /gone are units.
  assert.equal(stat.applicable, 2);
  assert.equal(stat.failed, 1);
  assert.deepEqual(findingsFor(result, 'links.internal.broken').map((f) => f.selector), ['a[href="/gone"]']);
});

test('links.internal.broken still fails a real 503 and a redirect chain that failed on the site itself', () => {
  const links = ['/down', '/loop', '/many', '/invalid'].map((href) => makeLink({ url: `${SITE}${href}`, href }));
  const pages = [
    makePage({ url: `${SITE}/`, links }),
    // The same 503 as a bot challenge, but with no refusal recorded: the site really answered 503.
    makePage({ url: `${SITE}/down`, status: 503, indexability: { indexable: false, reasons: ['status_503'] } }),
    unfinishedRedirect('/loop', { fetch_error: 'redirect_loop' }),
    unfinishedRedirect('/many', { fetch_error: 'too_many_redirects' }),
    unfinishedRedirect('/invalid', { fetch_error: 'invalid_url' }),
  ];

  const { result } = audit(pages);
  const stat = statFor(result, 'links.internal.broken');
  assert.equal(stat.applicable, 4);
  assert.equal(stat.failed, 4);
});

test('links.internal.broken passes working targets and leaves out anything that is not a unit', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/fine`, href: '/fine' }),
      makeLink({ url: `${SITE}/not-crawled`, href: '/not-crawled' }),
      makeLink({ url: 'https://other.test/x', href: 'https://other.test/x' }),
      makeRawLink({ href: 'mailto:hi@example.test' }),
      makeLink({ url: `${SITE}/moved`, href: '/moved' }),
    ],
  });
  // A broken link on a page that is not an html page (404) is not a unit.
  const broken = errorPage('/error-page', { links: [makeLink({ url: `${SITE}/gone`, href: '/gone' })] });
  const pages = [
    home,
    makePage({ url: `${SITE}/fine` }),
    makeRedirect(`${SITE}/moved`, `${SITE}/fine`),
    errorPage('/gone'),
    broken,
  ];

  const { result } = audit(pages);
  const stat = statFor(result, 'links.internal.broken');
  assert.equal(stat.applicable, 2);
  assert.equal(stat.failed, 0);
  assert.equal(findingsFor(result, 'links.internal.broken').length, 0);
});

test('internal link units are distinct targets, ordered by first appearance, and include a self-link', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/`, href: '/' }),
      makeLink({ url: `${SITE}/b`, href: '/b', line: 4 }),
      makeLink({ url: `${SITE}/a`, href: '/a' }),
      makeLink({ url: `${SITE}/b`, href: '/b#details', line: 9 }),
    ],
  });
  const ctx = buildContext(makeCrawl({ pages: [home, makePage({ url: `${SITE}/a` }), makePage({ url: `${SITE}/b` })] }));

  const results = checkById('links.internal.broken').run(ctx);
  assert.deepEqual(results.map((r) => r.selector), ['a[href="/"]', 'a[href="/b"]', 'a[href="/a"]']);
  assert.ok(results.every((r) => r.url === `${SITE}/` && r.status === 'pass'));
});

test('links.internal.broken reports the selector and line of the first link to a broken target', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [makeLink({ url: `${SITE}/gone`, href: '/gone', line: 3 }), makeLink({ url: `${SITE}/gone`, href: '/gone#x', line: 8 })],
  });
  const { result } = audit([home, errorPage('/gone')]);
  const findings = findingsFor(result, 'links.internal.broken');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].selector, 'a[href="/gone"]');
  assert.equal(findings[0].line, 3);
});

test('links.internal.broken escapes backslashes and quotes in the selector', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [makeLink({ url: `${SITE}/gone`, href: '/gone"?a=\\b', line: 2 })],
  });
  const { result } = audit([home, errorPage('/gone')]);
  const [finding] = findingsFor(result, 'links.internal.broken');
  assert.equal(finding.selector, 'a[href="/gone\\"?a=\\\\b"]');
});

// ───────────── links.internal.redirect ─────────────

test('links.internal.redirect fails when a target redirects to a page that works', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/old`, href: '/old', line: 6 }),
      makeLink({ url: `${SITE}/new`, href: '/new' }),
      makeLink({ url: `${SITE}/lost`, href: '/lost' }),
      makeLink({ url: `${SITE}/loop`, href: '/loop' }),
    ],
  });
  const pages = [
    home,
    makePage({ url: `${SITE}/new` }),
    makeRedirect(`${SITE}/old`, `${SITE}/new`),
    // Redirects that end in an error are broken links, not redirect findings.
    makeRedirect(`${SITE}/lost`, `${SITE}/gone`, { final_status: 404 }),
    makeRedirect(`${SITE}/loop`, `${SITE}/loop`, { final_status: 0, fetch_error: 'redirect_loop' }),
  ];

  const { result } = audit(pages);
  const stat = statFor(result, 'links.internal.redirect');
  assert.equal(stat.applicable, 4);
  assert.equal(stat.failed, 1);

  const [finding] = findingsFor(result, 'links.internal.redirect');
  assert.equal(finding.url, `${SITE}/`);
  assert.equal(finding.selector, 'a[href="/old"]');
  assert.equal(finding.line, 6);
  assert.equal(finding.severity, 'low');
  assert.deepEqual(finding.evidence.observed, {
    target_url: `${SITE}/old`,
    status: 301,
    final_url: `${SITE}/new`,
    final_status: 200,
    final_external: false,
    fetch_error: null,
    hops: 1,
  });
  assert.equal(finding.evidence.expected, `A link to ${SITE}/new`);
  assert.equal(finding.evidence.detail, `${SITE}/old answers 301 and redirects to ${SITE}/new.`);

  // The same data still produces broken-link findings for the two that end in errors.
  assert.deepEqual(
    findingsFor(result, 'links.internal.broken').map((f) => f.selector),
    ['a[href="/loop"]', 'a[href="/lost"]'],
  );
});

test('links.internal.redirect covers every final status from 200 to 399, including a chain cut short', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [makeLink({ url: `${SITE}/cut`, href: '/cut' }), makeLink({ url: `${SITE}/empty`, href: '/empty' })],
  });
  const pages = [
    home,
    makeRedirect(`${SITE}/cut`, `${SITE}/next`, { final_status: 399 }),
    makeRedirect(`${SITE}/empty`, `${SITE}/nothing`, { final_status: 204 }),
  ];

  const { result } = audit(pages);
  assert.equal(findingsFor(result, 'links.internal.redirect').length, 2);
  assert.equal(findingsFor(result, 'links.internal.broken').length, 0);
});

test('links.internal.redirect fails when the redirect leaves the site or ends where the crawler was refused', () => {
  const links = ['/go', '/guarded', '/limited-end', '/blocked'].map((href) => makeLink({ url: `${SITE}${href}`, href }));
  const pages = [
    makePage({ url: `${SITE}/`, links }),
    makeRedirect(`${SITE}/go`, OFF_SITE, { final_external: true, final_status: 0 }),
    unfinishedRedirect('/guarded', { fetch_error: 'bot_challenge' }),
    unfinishedRedirect('/limited-end', { fetch_error: 'rate_limited' }),
    unfinishedRedirect('/blocked', { fetch_error: 'robots_disallowed' }),
  ];

  const { result } = audit(pages);
  const stat = statFor(result, 'links.internal.redirect');
  assert.equal(stat.applicable, 4);
  assert.equal(stat.failed, 4);

  const bySelector = Object.fromEntries(findingsFor(result, 'links.internal.redirect').map((f) => [f.selector, f]));
  assert.equal(bySelector['a[href="/go"]'].evidence.detail, `${SITE}/go answers 301 and redirects to ${OFF_SITE}, which is on another site.`);
  assert.deepEqual(bySelector['a[href="/go"]'].evidence.observed, {
    target_url: `${SITE}/go`,
    status: 301,
    final_url: OFF_SITE,
    final_status: 0,
    final_external: true,
    fetch_error: null,
    hops: 1,
  });
  assert.match(bySelector['a[href="/guarded"]'].evidence.detail ?? '', /which the audit could not read \(the site challenged the crawler\)\.$/);
  assert.match(bySelector['a[href="/limited-end"]'].evidence.detail ?? '', /\(the site rate-limited the crawler\)/);
  assert.match(bySelector['a[href="/blocked"]'].evidence.detail ?? '', /\(robots\.txt does not allow the crawler to request the URL, or could not be read\)/);

  // Redirects the crawler never saw to the end are not broken links either.
  assert.equal(statFor(result, 'links.internal.broken').applicable, 0);
});

test('links.internal.redirect passes a target that is not a redirect, even when the crawler was refused on it', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [makeLink({ url: `${SITE}/challenge`, href: '/challenge' }), makeLink({ url: `${SITE}/new`, href: '/new' })],
  });
  const { result } = audit([home, refusedPage('/challenge', 503, 'bot_challenge'), makePage({ url: `${SITE}/new` })]);
  const stat = statFor(result, 'links.internal.redirect');
  assert.equal(stat.applicable, 2);
  assert.equal(stat.failed, 0);
});

test('links.internal.redirect passes direct links and skips targets that were not crawled', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [makeLink({ url: `${SITE}/new`, href: '/new' }), makeLink({ url: `${SITE}/unknown`, href: '/unknown' })],
  });
  const { result } = audit([home, makePage({ url: `${SITE}/new` })]);
  const stat = statFor(result, 'links.internal.redirect');
  assert.equal(stat.applicable, 1);
  assert.equal(stat.failed, 0);
});

// ───────────── links.internal.nofollow ─────────────

test('links.internal.nofollow fails only when every link to a page on the page has nofollow', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/a`, href: '/a', line: 5 }),
      makeLink({ url: `${SITE}/a`, href: '/a#footer', rel: ['noopener', 'nofollow'], line: 40 }),
      makeLink({ url: `${SITE}/b`, href: '/b', rel: ['noopener'] }),
      makeLink({ url: `${SITE}/not-crawled`, href: '/not-crawled', rel: ['noopener', 'nofollow'], line: 12 }),
      makeLink({ url: 'https://other.test/x', href: 'https://other.test/x', rel: ['nofollow'] }),
    ],
  });
  const other = errorPage('/e', { links: [makeLink({ url: `${SITE}/a`, href: '/a', rel: ['nofollow'] })] });

  const { result } = audit([home, makePage({ url: `${SITE}/a` }), makePage({ url: `${SITE}/b` }), other]);
  const stat = statFor(result, 'links.internal.nofollow');
  // /a, /b and /not-crawled: no record is needed, external links and non-html pages are not units.
  assert.equal(stat.applicable, 3);
  assert.equal(stat.failed, 1, '/a is also linked without nofollow');
  assert.equal(stat.passed, 2);

  const [finding] = findingsFor(result, 'links.internal.nofollow');
  assert.equal(finding.selector, 'a[href="/not-crawled"]');
  assert.equal(finding.line, 12);
  assert.deepEqual(finding.evidence.observed, {
    target_url: `${SITE}/not-crawled`,
    rel: ['noopener', 'nofollow'],
    nofollow_links: 1,
    links_to_target: 1,
  });
  assert.equal(finding.evidence.detail, `The only link to ${SITE}/not-crawled on this page has rel="nofollow".`);
});

test('links.internal.nofollow passes links with other rel values', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [makeLink({ url: `${SITE}/a`, href: '/a', rel: ['noopener', 'noreferrer', 'ugc'] })],
  });
  const { result } = audit([home, makePage({ url: `${SITE}/a` })]);
  const stat = statFor(result, 'links.internal.nofollow');
  assert.equal(stat.applicable, 1);
  assert.equal(stat.failed, 0);
});

// ───────────── links.internal.insecure ─────────────

test('links.internal.insecure fails on http:// internal links when the site is https', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: 'http://example.test/plain', href: 'http://example.test/plain', internal: true, line: 14 }),
      makeLink({ url: `${SITE}/secure`, href: '/secure' }),
      makeLink({ url: 'http://other.test/x', href: 'http://other.test/x' }),
      makeLink({ url: 'http://example.test:8080/app', href: 'http://example.test:8080/app', internal: true }),
    ],
  });

  const { result } = audit([home]);
  const stat = statFor(result, 'links.internal.insecure');
  assert.equal(stat.applicable, 3);
  assert.equal(stat.failed, 2);
  assert.equal(stat.passed, 1);

  const findings = findingsFor(result, 'links.internal.insecure');
  const plain = findings.find((f) => f.selector === 'a[href="http://example.test/plain"]');
  assert.ok(plain);
  assert.equal(plain.line, 14);
  assert.equal(plain.evidence.observed, 'http://example.test/plain');
  assert.equal(plain.evidence.expected, 'https://example.test/plain');
  const ported = findings.find((f) => f.selector === 'a[href="http://example.test:8080/app"]');
  assert.equal(ported?.evidence.expected, 'https://example.test:8080/app');
});

test('links.internal.insecure has no units on a site that is not https', () => {
  const origin = 'http://example.test';
  const home = makePage({
    url: `${origin}/`,
    links: [makeLink({ url: `${origin}/a`, href: '/a', internal: true })],
  });
  const { result } = audit([home], { crawl: { site_origin: origin, start_url: `${origin}/` } });
  const stat = statFor(result, 'links.internal.insecure');
  assert.equal(stat.status, 'run');
  assert.equal(stat.applicable, 0);
  assert.equal(findingsFor(result, 'links.internal.insecure').length, 0);
});
