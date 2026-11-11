import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makeLink, makePage, makeRedirect } from '../../helpers/factories.js';
import { audit, findingsFor, outboundResult, statFor } from './support.js';

const ID = 'links.outbound.broken';
const DEAD = 'https://dead.test/page';

/** @param {[string, 'ok'|'broken'|'unverifiable', number, (string|null)?][]} entries */
const outboundMap = (entries) => new Map(entries.map(([url, outcome, status, reason]) => [url, outboundResult(url, outcome, status, reason)]));

test('links.outbound.broken reports the first linking page, its raw href and the other pages', () => {
  const pages = [
    makePage({ url: `${SITE}/`, links: [makeLink({ url: 'https://fine.test/', href: 'https://fine.test/', internal: false })] }),
    makePage({ url: `${SITE}/c`, links: [makeLink({ url: DEAD, href: `${DEAD}#c`, internal: false, line: 2 })] }),
    makePage({
      url: `${SITE}/a`,
      links: [
        makeLink({ url: DEAD, href: `${DEAD}#first`, internal: false, line: 7 }),
        makeLink({ url: DEAD, href: `${DEAD}#second`, internal: false, line: 9 }),
      ],
    }),
    makePage({ url: `${SITE}/b`, links: [makeLink({ url: DEAD, href: DEAD, internal: false })] }),
  ];
  const outbound = outboundMap([
    ['https://fine.test/', 'ok', 200],
    [DEAD, 'broken', 404, 'not_found'],
  ]);

  const { result } = audit(pages, { outbound });
  const stat = statFor(result, ID);
  assert.equal(stat.status, 'run');
  assert.equal(stat.applicable, 2);
  assert.equal(stat.passed, 1);
  assert.equal(stat.failed, 1);

  const [finding] = findingsFor(result, ID);
  assert.equal(finding.url, `${SITE}/a`);
  assert.equal(finding.selector, `a[href="${DEAD}#first"]`);
  assert.equal(finding.line, 7);
  assert.deepEqual(finding.related_urls, [`${SITE}/b`, `${SITE}/c`]);
  assert.equal(finding.severity, 'medium');
  assert.equal(finding.confidence, 'likely');
  assert.deepEqual(finding.evidence.observed, { target_url: DEAD, status: 404, reason: 'not_found' });
  assert.equal(finding.evidence.expected, 'A URL that answers with a status below 400');
  assert.equal(finding.evidence.detail, `${DEAD} answered 404 (not_found).`);
});

test('links.outbound.broken describes a domain that does not resolve', () => {
  const pages = [makePage({ url: `${SITE}/`, links: [makeLink({ url: 'https://nowhere.test/', href: 'https://nowhere.test/', internal: false })] })];
  const outbound = outboundMap([['https://nowhere.test/', 'broken', 0, 'dns_error']]);

  const { result } = audit(pages, { outbound });
  const [finding] = findingsFor(result, ID);
  assert.equal(finding.evidence.detail, 'https://nowhere.test/ could not be reached (dns_error).');
  assert.deepEqual(finding.related_urls, []);
});

test('links.outbound.broken leaves out unverifiable results and passes working ones', () => {
  const links = ['https://ok.test/', 'https://blocked.test/', 'https://slow.test/'].map((url) => makeLink({ url, href: url, internal: false }));
  const pages = [makePage({ url: `${SITE}/`, links })];
  const outbound = outboundMap([
    ['https://ok.test/', 'ok', 200],
    ['https://blocked.test/', 'unverifiable', 403, 'forbidden'],
    ['https://slow.test/', 'unverifiable', 0, 'timeout'],
  ]);

  const { result } = audit(pages, { outbound });
  const stat = statFor(result, ID);
  assert.equal(stat.applicable, 1);
  assert.equal(stat.passed, 1);
  assert.equal(stat.failed, 0);
  assert.equal(findingsFor(result, ID).length, 0);
});

test('links.outbound.broken ignores internal links and finds a broken URL on a page that is not html 200', () => {
  const errorPage = makePage({
    url: `${SITE}/error`,
    status: 404,
    indexability: { indexable: false, reasons: ['status_404'] },
    links: [makeLink({ url: DEAD, href: DEAD, internal: false })],
  });
  const home = makePage({ url: `${SITE}/`, links: [makeLink({ url: `${SITE}/about`, href: '/about' })] });
  const outbound = outboundMap([[DEAD, 'broken', 410, 'gone']]);

  const { result } = audit([home, errorPage], { outbound });
  assert.deepEqual(findingsFor(result, ID).map((f) => f.url), [`${SITE}/error`]);
});

test('links.outbound.broken still reports a broken URL that no crawled page links to', () => {
  const pages = [makePage({ url: `${SITE}/` })];
  const outbound = outboundMap([[DEAD, 'broken', 404, 'not_found']]);

  const { result } = audit(pages, { outbound });
  const [finding] = findingsFor(result, ID);
  assert.equal(finding.url, null);
  assert.equal(finding.selector, `a[href="${DEAD}"]`);
  assert.equal(finding.line, null);

  // The fallback selector is escaped like every other `a[href="…"]` selector.
  const odd = audit(pages, { outbound: outboundMap([['https://dead.test/a"b', 'broken', 404, null]]) });
  assert.equal(findingsFor(odd.result, ID)[0].selector, 'a[href="https://dead.test/a\\"b"]');
});

test('links.outbound.broken names the page whose internal link redirects to a broken external URL', () => {
  const pages = [
    makePage({ url: `${SITE}/a`, links: [makeLink({ url: `${SITE}/go`, href: '/go', line: 4 })] }),
    makePage({ url: `${SITE}/b`, links: [makeLink({ url: DEAD, href: DEAD, internal: false })] }),
    makeRedirect(`${SITE}/go`, DEAD, { final_external: true, final_status: 0 }),
  ];

  const { result } = audit(pages, { outbound: outboundMap([[DEAD, 'broken', 404, 'not_found']]) });
  const [finding] = findingsFor(result, ID);
  assert.equal(finding.url, `${SITE}/a`);
  assert.equal(finding.selector, 'a[href="/go"]');
  assert.equal(finding.line, 4);
  assert.deepEqual(finding.related_urls, [`${SITE}/b`]);
  assert.equal(finding.evidence.detail, `${DEAD} answered 404 (not_found). The link goes to ${SITE}/go, which redirects there.`);

  // The same redirect to a URL that works is a pass attributed to the same page.
  const ok = audit(pages, { outbound: outboundMap([[DEAD, 'ok', 200]]) });
  assert.equal(statFor(ok.result, ID).passed, 1);
  assert.equal(findingsFor(ok.result, ID).length, 0);
});

test('links.outbound.broken ignores an internal redirect that stays on the site', () => {
  const pages = [
    makePage({ url: `${SITE}/a`, links: [makeLink({ url: `${SITE}/old`, href: '/old' })] }),
    makeRedirect(`${SITE}/old`, `${SITE}/new`),
    makePage({ url: `${SITE}/new` }),
  ];
  const { result } = audit(pages, { outbound: outboundMap([[DEAD, 'broken', 404, 'not_found']]) });
  // The only outbound URL has no linking page, so it carries no page URL.
  assert.deepEqual(findingsFor(result, ID).map((f) => f.url), [null]);
});

test('links.outbound.broken is skipped when external links were not checked', () => {
  const { result } = audit([makePage({ url: `${SITE}/` })]);
  const stat = statFor(result, ID);
  assert.equal(stat.status, 'skipped');
  assert.match(stat.skip_reason ?? '', /external link checks/);
});
