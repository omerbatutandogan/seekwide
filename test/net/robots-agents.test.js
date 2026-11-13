import assert from 'node:assert/strict';
import { test } from 'node:test';

import { loadRobots } from '../../plugin/server/src/net/robots.js';
import { fakeFetch } from './fake-fetch.js';

const IMAGE = ['Googlebot-Image', 'Googlebot'];
const ORIGIN = 'https://cdn.test';

/** @param {string} text */
async function robots(text) {
  const { fetch } = fakeFetch({ [`${ORIGIN}/robots.txt`]: { text } });
  return loadRobots(ORIGIN, { fetch });
}

test('a crawler with several tokens follows the group of its most specific token, else the next, else *', async () => {
  const own = await robots('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /private/\n\nUser-agent: Googlebot-Image\nDisallow: /photos/\n');
  assert.equal(own.allowsAgents(`${ORIGIN}/photos/a.jpg`, IMAGE), false);
  assert.equal(own.allowsAgents(`${ORIGIN}/private/a.jpg`, IMAGE), true, 'only the googlebot-image group applies');
  assert.equal(own.allowsAgents(`${ORIGIN}/private/a.jpg`, ['Googlebot']), false);

  const fallback = await robots('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /private/\n');
  assert.equal(fallback.allowsAgents(`${ORIGIN}/private/a.jpg`, IMAGE), false, 'without its own group Googlebot-Image follows the googlebot group');
  assert.equal(fallback.allowsAgents(`${ORIGIN}/photos/a.jpg`, IMAGE), true, 'and not the * group');

  const star = await robots('User-agent: *\nDisallow: /wp-content/\n');
  assert.equal(star.allowsAgents(`${ORIGIN}/wp-content/a.jpg`, IMAGE), false);
  assert.equal(star.allowsAgents(`${ORIGIN}/a.jpg`, IMAGE), true);
  assert.equal(star.allowsAgents('https://other.test/wp-content/a.jpg', IMAGE), true, 'another origin is not governed by this file');
});

test('a group that names the crawler and has no rule allows it everything, as RFC 9309 says (review finding 8)', async () => {
  const empty = await robots('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot-Image\n');
  assert.equal(empty.allowsAgents(`${ORIGIN}/a.jpg`, IMAGE), true);
  assert.equal(empty.allowsAgents(`${ORIGIN}/a.jpg`, ['Googlebot']), false);
  // Consecutive user-agent lines form one group, blank lines or not: Googlebot-Image shares the rules of *.
  const shared = await robots('User-agent: Googlebot-Image\n\nUser-agent: *\nDisallow: /\n');
  assert.equal(shared.allowsAgents(`${ORIGIN}/a.jpg`, IMAGE), false);
});

test('the crawler\'s own answer is unchanged by the other agents\' groups', async () => {
  const file = await robots('User-agent: Googlebot-Image\nDisallow: /\n\nUser-agent: *\nAllow: /\n');
  assert.equal(file.isAllowed(`${ORIGIN}/a.jpg`), true);
  assert.equal(file.allowsAgents(`${ORIGIN}/a.jpg`, IMAGE), false);
});

test('a missing robots.txt allows every agent, and one that cannot be read allows none on its origin', async () => {
  const missing = await loadRobots(ORIGIN, { fetch: fakeFetch({ [`${ORIGIN}/robots.txt`]: { status: 404 } }).fetch });
  assert.equal(missing.allowsAgents(`${ORIGIN}/a.jpg`, IMAGE), true);
  const down = await loadRobots(ORIGIN, { fetch: fakeFetch({ [`${ORIGIN}/robots.txt`]: { status: 503 } }).fetch });
  assert.equal(down.allowsAgents(`${ORIGIN}/a.jpg`, IMAGE), false);
  assert.equal(down.allowsAgents('https://other.test/a.jpg', IMAGE), true);
});
