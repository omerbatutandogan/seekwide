import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createFrontier, roundRobinByTemplate } from '../../plugin/server/src/crawl/frontier.js';

const S = 'https://site.test';

/** @param {ReturnType<typeof createFrontier>} frontier */
function drain(frontier) {
  const out = [];
  for (let entry = frontier.next(); entry !== null; entry = frontier.next()) out.push(entry);
  return out;
}

test('roundRobinByTemplate takes one URL per template group in turn, groups and URLs sorted', () => {
  const urls = [`${S}/blog/b`, `${S}/docs/x`, `${S}/blog/a`, `${S}/about`, `${S}/blog/c`, `${S}/docs/y`];
  assert.deepEqual(roundRobinByTemplate(urls), [
    `${S}/about`, `${S}/blog/a`, `${S}/docs/x`, `${S}/blog/b`, `${S}/docs/y`, `${S}/blog/c`,
  ]);
});

test('roundRobinByTemplate does not depend on input order', () => {
  const urls = [`${S}/a/1`, `${S}/b/1`, `${S}/a/2`, `${S}/c`, `${S}/b/2`];
  assert.deepEqual(roundRobinByTemplate(urls), roundRobinByTemplate([...urls].reverse()));
});

test('all URLs of a smaller depth come first', () => {
  const frontier = createFrontier();
  frontier.add(`${S}/deep`, 2);
  frontier.add(`${S}/b`, 1);
  frontier.add(`${S}/a`, 1);
  assert.deepEqual(drain(frontier), [
    { url: `${S}/a`, depth: 1 }, { url: `${S}/b`, depth: 1 }, { url: `${S}/deep`, depth: 2 },
  ]);
});

test('a URL is handed out only once, even when added again at another depth', () => {
  const frontier = createFrontier();
  assert.equal(frontier.add(`${S}/a`, 1), true);
  assert.equal(frontier.add(`${S}/a`, 1), false);
  assert.equal(frontier.add(`${S}/a`, 0), false);
  assert.deepEqual(drain(frontier).map((e) => e.url), [`${S}/a`]);
  assert.equal(frontier.add(`${S}/a`, 3), false);
  assert.equal(frontier.next(), null);
});

test('a URL marked seen is never queued', () => {
  const frontier = createFrontier();
  frontier.markSeen(`${S}/done`);
  assert.equal(frontier.add(`${S}/done`, 1), false);
  assert.equal(frontier.has(`${S}/done`), true);
  assert.equal(frontier.next(), null);
});

test('sitemap URLs come after every linked URL, only when nothing linked them, with depth null', () => {
  const frontier = createFrontier();
  frontier.addSitemap(`${S}/orphan`);
  frontier.addSitemap(`${S}/linked`);
  frontier.addSitemap(`${S}/orphan`);
  frontier.add(`${S}/linked`, 1);
  frontier.add(`${S}/z`, 2);
  assert.equal(frontier.size(), 3);
  assert.deepEqual(drain(frontier), [
    { url: `${S}/linked`, depth: 1 }, { url: `${S}/z`, depth: 2 }, { url: `${S}/orphan`, depth: null },
  ]);
  assert.equal(frontier.size(), 0);
});

test('URLs added while a depth is being drained are handed out by depth', () => {
  const frontier = createFrontier();
  frontier.add(`${S}/a`, 1);
  frontier.add(`${S}/b`, 1);
  assert.equal(frontier.next()?.url, `${S}/a`);
  frontier.add(`${S}/a-child`, 2);
  frontier.add(`${S}/late`, 1);
  assert.deepEqual(drain(frontier).map((e) => e.url), [`${S}/b`, `${S}/late`, `${S}/a-child`]);
});
