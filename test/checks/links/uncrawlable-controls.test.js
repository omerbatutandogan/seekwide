// links.anchor.uncrawlable: a javascript: control that opens no page is not a
// link to fix (validation of 2026-11-12, fix 4). The hrefs model what real
// sites sent: a print button (`javascript:print();`), a back button
// (`javascript:history.back();`), menu toggles and share buttons
// (`javascript:;`). Whatever may open a page stays a finding, and so do
// data: URLs and scripts behind an onclick handler.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hiddenDestination, leadsNowhere } from '../../../plugin/server/src/checks/links/anchor.js';
import { extractHtml } from '../../../plugin/server/src/extract/html.js';
import { SITE, makePage } from '../../helpers/factories.js';
import { audit, findingsFor, makeRawLink, statFor } from './support.js';

test('script links that only print, go back, close or do nothing, without onclick, are not units', () => {
  const page = makePage({
    url: `${SITE}/`,
    links: [
      makeRawLink({ href: 'javascript:print();', text: 'Print' }),
      makeRawLink({ href: 'javascript:history.back();', text: 'Back' }),
      makeRawLink({ href: 'javascript:;', text: '' }),
      makeRawLink({ href: 'javascript:void(0)', text: 'Menu' }),
      makeRawLink({ href: 'JAVASCRIPT: void 0 ;', text: 'Menu' }),
      makeRawLink({ href: 'javascript:void%280%29', text: 'Encoded' }),
      makeRawLink({ href: 'javascript:window.close(); return false;', text: 'Close' }),
    ],
  });
  const { result } = audit([page]);
  assert.equal(statFor(result, 'links.anchor.uncrawlable').applicable, 0);
});

test('a script link that may open a page fails, as do data: URLs and scripts that do nothing behind an onclick handler', () => {
  const page = makePage({
    url: `${SITE}/`,
    links: [
      makeRawLink({ href: "javascript:location='/post/1'", line: 3 }),
      makeRawLink({ href: "javascript:window.location.href='/products'" }),
      makeRawLink({ href: "javascript:goTo('products')" }),
      makeRawLink({ href: 'javascript:print();openPage()' }),
      makeRawLink({ href: 'vbscript:msgbox("x")' }),
      makeRawLink({ href: 'data:text/html,<h1>x</h1>' }),
      makeRawLink({ href: 'javascript:void(0)', has_onclick: true, line: 9 }),
    ],
  });
  const { result } = audit([page]);
  const stat = statFor(result, 'links.anchor.uncrawlable');
  assert.equal(stat.applicable, 7);
  assert.equal(stat.failed, 7);
  const onclick = findingsFor(result, 'links.anchor.uncrawlable').find((finding) => finding.line === 9);
  assert.equal(onclick?.evidence.detail, 'The href is a javascript: URL that does nothing itself, and the link relies on an onclick handler.');
});

test('the rule reads the script the way a browser does and refuses to guess on a long one', () => {
  assert.equal(leadsNowhere('java\nscript:\tvoid(0)'), true);
  assert.equal(leadsNowhere(`javascript:${'void(0);'.repeat(80)}`), false, 'longer than the code that is read');
  assert.equal(leadsNowhere('javascript:void(0'), false);
  assert.equal(hiddenDestination({ href: '/about', has_onclick: true }), null);
  assert.equal(hiddenDestination({ href: 'mailto:a@example.test', has_onclick: false }), null);
});

test('a script link that does nothing fails when another handler does what the link does (review of 2026-11-12)', () => {
  const html = `<a href="javascript:void(0)" onmousedown="go()">a</a><a href="javascript:;" ng-click="go()">b</a><a href="javascript:void(0)" data-href="/products">c</a>
<a href="javascript:void(0)" @click.prevent="go">d</a><a onmousedown="go()">e</a><a href="javascript:void(0)" class="toggle">f</a>`;
  const { links } = extractHtml(`<html><head><title>T</title></head><body>${html}</body></html>`, { responseUrl: `${SITE}/`, siteHost: new URL(SITE).host, includeSubdomains: false });
  assert.deepEqual(links.map((link) => hiddenDestination(link)), ['onclick', 'onclick', 'onclick', 'onclick', 'onclick', undefined]);
  const withHandler = { ...links[0], href: '' };
  assert.equal(hiddenDestination(withHandler), 'onclick', 'an element with no href and another handler fails like one with onclick');
  const { result } = audit([makePage({ url: `${SITE}/`, links })]);
  const details = findingsFor(result, 'links.anchor.uncrawlable').map((finding) => finding.evidence.detail ?? '');
  assert.equal(details.length, 5);
  assert.ok(details.some((detail) => /does nothing itself, and the link relies on a script handler/.test(detail)));
  assert.ok(details.includes('The link has no href and opens its page through a script handler.'));
});
