// What the report and audit_run say about a crawl that read nothing, a site
// behind a login, a start page that holds almost nothing, and a sitemap the
// site refused (validation of 2026-11-12, confusion items 2 to 4 and 8). The
// crawls model real cases: a start page that answered a bot challenge, a
// store whose home page redirects to its password page, and a site whose
// served HTML is an empty JavaScript shell.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildReport } from '../../plugin/server/src/report/model.js';
import { runNotes, startPage } from '../../plugin/server/src/tools/audit-summary.js';
import { makeCrawl, makePage, makeRedirect } from '../helpers/factories.js';
import { makeCheckStat, makeRun } from '../helpers/run-factory.js';

const NO_EXTRAS = /** @type {const} */ ([{ requested: false, checked: false, found: 0 }, { requested: false, checked: false, vitals: null }, []]);

test('a crawl blocked before any page was read opens with that fact and claims no checks that had nothing to look at', () => {
  const checks = [
    ...Array.from({ length: 56 }, (_, i) => makeCheckStat({ id: `seo.check_${i}`, applicable: 0, passed: 0, failed: 0 })),
    makeCheckStat({ id: 'seo.robots.unreachable', applicable: 1, passed: 1, failed: 0 }),
  ];
  const run = makeRun({
    findings: [],
    checks,
    crawl: { ...makeRun().crawl, pages_crawled: 1, html_pages: 0, indexable_pages: 0, blocked: { reason: 'bot_challenge', url: 'https://www.example.test/', status: 403 } },
  });
  const report = buildReport(run);
  const [first] = report.summary.paragraphs;
  assert.match(first, /^The crawl stopped early at https:\/\/www\.example\.test\/ \(HTTP 403\): the site answered with a bot challenge and the crawler did not try to get past it\./);
  assert.match(first, /No page of .+ could be read/);
  const all = report.summary.paragraphs.join(' ');
  assert.doesNotMatch(all, /ran \d+ of/);
  assert.doesNotMatch(all, /found no problems/);
  assert.deepEqual(report.figures.at(-1), { label: 'Checks with anything to check', value: '1 of 57' });
});

test('a start URL that redirects to a password or login page, and a start page with no links and almost no words, each get a note', () => {
  // A store closed behind its password page.
  const closed = makeCrawl({
    start_url: 'https://shop.example.test/',
    pages: [
      makeRedirect('https://shop.example.test/', 'https://shop.example.test/password', { status: 302, redirect_chain: [{ url: 'https://shop.example.test/', status: 302, location: 'https://shop.example.test/password' }] }),
      makePage({ url: 'https://shop.example.test/password', word_count: 38, links: [] }),
    ],
  });
  assert.deepEqual(startPage(closed), { start_gate: 'https://shop.example.test/password', start_shell_words: 38 });
  assert.match(runNotes(closed, ...NO_EXTRAS).join(' '), /redirects to https:\/\/shop\.example\.test\/password, a login or password page/);
  for (const path of ['/account/login', '/users/sign_in', '/wp-login.php?redirect_to=x', '/signin', '/login.php', '/Account/Login.aspx', '/signin.html']) {
    const url = `https://example.test${path}`;
    const crawl = makeCrawl({ start_url: 'https://example.test/', pages: [makeRedirect('https://example.test/', url), makePage({ url, word_count: 400 })] });
    assert.equal(startPage(crawl).start_gate, url, path);
  }
  // A redirect to a page that is not a login page, and a page with links, are neither.
  const moved = makeCrawl({ start_url: 'https://example.test/', pages: [makeRedirect('https://example.test/', 'https://example.test/en/'), makePage({ url: 'https://example.test/en/', word_count: 400 })] });
  assert.deepEqual(startPage(moved), {});

  // A site whose served HTML is an empty shell built by JavaScript.
  const shell = makeCrawl({ start_url: 'https://example.test/', pages: [makePage({ url: 'https://example.test/', titles: [], word_count: 3, links: [] })] });
  assert.deepEqual(startPage(shell), { start_shell_words: 3 });
  const report = buildReport(makeRun({ crawl: { ...makeRun().crawl, start_shell_words: 3, start_gate: 'https://example.test/login' } }));
  const text = report.summary.paragraphs.join(' ');
  assert.match(text, /The start page as served has 3 words and no links: either it is nearly empty, or JavaScript builds it in the browser/);
  assert.match(text, /The start URL redirects to https:\/\/example\.test\/login, a login or password page/);
});

test('a sitemap the site refused (403) is not a broken sitemap: not a unit, a note, and a skip reason that says so', async () => {
  const { audit } = await import('../checks/seo/helpers.js');
  const sitemap = { loaded: true, files: [{ url: 'https://example.test/sitemap/0', status: 403, type: /** @type {const} */ ('unreachable'), count: 0, error: null }], urls: [], truncated: false };
  assert.equal(audit('seo.sitemap.file_error', { sitemap }).stat.applicable, 0);
  const orphan = audit('seo.sitemap.url_not_ok', { sitemap });
  assert.equal(orphan.stat.status, 'skipped');
  assert.match(orphan.stat.skip_reason ?? '', /The site refused the crawler's request for its sitemap \(HTTP 403\)/);
  assert.match(runNotes(makeCrawl({ sitemap }), ...NO_EXTRAS).join(' '), /A sitemap file refused the crawler \(HTTP 403\), so it was not read or checked/);
  // A sitemap that answers 404 or 500 is still broken.
  const broken = { ...sitemap, files: [{ ...sitemap.files[0], status: 500 }] };
  assert.equal(audit('seo.sitemap.file_error', { sitemap: broken }).stat.failed, 1);
});
