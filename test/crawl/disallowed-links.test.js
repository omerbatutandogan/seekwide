// CrawlResult.disallowed_links (validation of 2026-11-12, fix 3, and its
// review): only the targets of nofollow links are asked about, each once, and
// at most MAX_DISALLOWED_ASKED of them, because a large robots.txt of wildcard
// rules makes each question cost.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_DISALLOWED_ASKED, createRecords } from '../../server/src/crawl/records.js';
import { createFrontier } from '../../server/src/crawl/frontier.js';
import { makeLink, makePage } from '../helpers/factories.js';

const SITE = 'https://example.test';

/** Records of `pages` with a robots.txt that disallows /private/ and counts its questions. @param {import('../../server/src/types.js').PageRecord[]} pages */
function recordsOf(pages) {
  let asked = 0;
  const robots = { isAllowed: (/** @type {string} */ url) => { asked += 1; return !url.includes('/private/'); } };
  const records = createRecords({
    maxPages: 1000, maxStoredChars: 1e9, frontier: createFrontier(), crawlable: () => false,
    knownRobots: (origin) => (origin === SITE ? /** @type {any} */ (robots) : undefined),
  });
  records.add(pages);
  return { records, asked: () => asked };
}

test('only nofollow targets are asked about, once each however many pages link them', () => {
  const links = [
    makeLink({ url: `${SITE}/private/a`, rel: ['nofollow'] }),
    makeLink({ url: `${SITE}/private/b` }),
    makeLink({ url: `${SITE}/public`, rel: ['nofollow'] }),
  ];
  const pages = Array.from({ length: 30 }, (_, i) => makePage({ url: `${SITE}/p${i}`, links }));
  const { records, asked } = recordsOf(pages);
  assert.deepEqual(records.disallowedLinks(), [`${SITE}/private/a`]);
  assert.equal(asked(), 2);
});

test('at most MAX_DISALLOWED_ASKED targets are asked about', () => {
  const links = Array.from({ length: MAX_DISALLOWED_ASKED + 500 }, (_, i) => makeLink({ url: `${SITE}/private/${i}`, rel: ['nofollow'] }));
  const { records, asked } = recordsOf([makePage({ url: `${SITE}/`, links })]);
  assert.equal(records.disallowedLinks().length, 2000, 'the list itself is capped at 2000');
  assert.ok(asked() <= MAX_DISALLOWED_ASKED);
});
