import assert from 'node:assert/strict';
import { test } from 'node:test';

import { distinctInternalTargets, hrefSelector, linkSelector } from '../../../plugin/server/src/checks/links/helpers.js';
import { SITE, makeLink, makePage } from '../../helpers/factories.js';

test('hrefSelector wraps the raw href and leaves ordinary characters alone', () => {
  assert.equal(hrefSelector('/products?id=1&x=y#top'), 'a[href="/products?id=1&x=y#top"]');
  assert.equal(hrefSelector(''), 'a[href=""]');
  assert.equal(linkSelector(makeLink({ url: `${SITE}/a`, href: '/a' })), 'a[href="/a"]');
});

test('hrefSelector escapes backslashes and double quotes so the href cannot end the selector', () => {
  assert.equal(hrefSelector('/say"hi"'), 'a[href="/say\\"hi\\""]');
  assert.equal(hrefSelector('/a\\b'), 'a[href="/a\\\\b"]');
  assert.equal(hrefSelector('"\\"'), 'a[href="\\"\\\\\\""]');
  // Single quotes and brackets need no escape inside a double-quoted attribute value.
  assert.equal(hrefSelector("/it's[1]"), "a[href=\"/it's[1]\"]");
});

test('hrefSelector clips a long href before escaping it, so an escape is never cut in half', () => {
  const href = `/${'"'.repeat(400)}`;
  const selector = hrefSelector(href);
  // 299 kept characters: "/" plus 298 quotes, each escaped, then the ellipsis.
  assert.equal(selector, `a[href="/${'\\"'.repeat(298)}…"]`);
  assert.equal(hrefSelector(href), selector);
});

test('distinctInternalTargets groups links by normalized URL in order of first appearance', () => {
  const page = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/b`, href: '/b' }),
      makeLink({ url: 'https://other.test/', href: 'https://other.test/' }),
      makeLink({ url: `${SITE}/a`, href: '/a' }),
      makeLink({ url: `${SITE}/b`, href: '/b#x' }),
      { ...makeLink({ url: `${SITE}/c` }), url: null, href: 'mailto:a@example.test', internal: true },
    ],
  });

  const targets = distinctInternalTargets(page);
  assert.deepEqual(targets.map((t) => t.url), [`${SITE}/b`, `${SITE}/a`]);
  assert.deepEqual(targets[0].links.map((l) => l.href), ['/b', '/b#x']);
});
