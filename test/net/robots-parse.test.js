// Reading robots.txt into groups: robots-parser 3.0.1's reading (used up to
// version 0.1.0), except that a record outside the protocol no longer ends the
// run of User-agent lines that starts a group (RFC 9309 2.2.4).

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { agentToken, groupFor, parseRobotsTxt } from '../../plugin/server/src/net/robots-parse.js';
import { loadRobots } from '../../plugin/server/src/net/robots.js';
import { fakeFetch } from './fake-fetch.js';

const ORIGIN = 'https://example.test';

/** @param {string} text */
async function robotsOf(text) {
  const { fetch } = fakeFetch({ [`${ORIGIN}/robots.txt`]: { status: 200, text } });
  return loadRobots(ORIGIN, { fetch });
}

test('a Sitemap or unknown record between User-agent lines does not end the group (RFC 9309 2.2.4)', async () => {
  for (const between of ['Sitemap: https://example.test/sitemap.xml', 'Noindex: /z', 'Host: example.test']) {
    const robots = await robotsOf(`User-agent: seekwide\n${between}\nUser-agent: other\nDisallow: /x\n`);
    assert.equal(robots.isAllowed(`${ORIGIN}/x`), false, between);
    assert.equal(robots.isAllowed(`${ORIGIN}/y`), true, between);
    assert.equal(robots.allowsAgents(`${ORIGIN}/x`, ['other']), false, between);
  }
  const sitemaps = await robotsOf('User-agent: seekwide\nSitemap: https://example.test/s.xml\nUser-agent: other\nDisallow: /x\n');
  assert.deepEqual(sitemaps.summary.sitemaps, ['https://example.test/s.xml']);
});

test('a rule or a Crawl-delay still ends the run, so the next User-agent starts a new group', async () => {
  const robots = await robotsOf('User-agent: seekwide\nDisallow: /a\nUser-agent: other\nDisallow: /x\n');
  assert.equal(robots.isAllowed(`${ORIGIN}/a`), false);
  assert.equal(robots.isAllowed(`${ORIGIN}/x`), true);
  const delayed = parseRobotsTxt('User-agent: seekwide\nCrawl-delay: 4\nUser-agent: other\nDisallow: /x\n');
  assert.deepEqual(delayed.groups.get('seekwide'), { rules: [], crawlDelay: 4 });
  assert.deepEqual(delayed.groups.get('other'), { rules: [{ pattern: '/x', allow: false }] });
});

test('lines are read as robots-parser 3.0.1 read them', () => {
  const text = [
    '# a comment',
    'garbage without a colon',
    ': no name',
    'USER-AGENT: SeekWide/0.1 # version and comment',
    '',
    'user-agent:',
    'Disallow: /private # trailing comment',
    'Allow:',
    'Disallow: /ü',
    'Disallow: /%7euser',
    'Crawl-delay: not a number',
    'Crawl-delay:',
    'Sitemap:',
    'sitemap: /relative.xml',
  ].join('\r\n');
  const parsed = parseRobotsTxt(text);
  assert.deepEqual([...parsed.groups.keys()], ['seekwide']);
  assert.deepEqual(parsed.groups.get('seekwide'), {
    rules: [{ pattern: '/private', allow: false }, { pattern: '/%C3%BC', allow: false }, { pattern: '/%7Euser', allow: false }],
    crawlDelay: 0,
  });
  assert.deepEqual(parsed.sitemaps, ['/relative.xml']);
  assert.deepEqual([...parsed.named], ['seekwide']);
  // Bare CR ends a line too.
  assert.deepEqual(parseRobotsTxt('User-agent: *\rDisallow: /x').groups.get('*')?.rules, [{ pattern: '/x', allow: false }]);
});

test('groups of one agent are merged, and an agent without a group follows *', () => {
  const parsed = parseRobotsTxt('User-agent: seekwide\nDisallow: /one\nUser-agent: *\nDisallow: /star\nCrawl-delay: 2\nUser-agent: seekwide\nDisallow: /two\n');
  assert.deepEqual(groupFor(parsed, ['Seekwide'])?.rules.map((rule) => rule.pattern), ['/one', '/two']);
  assert.equal(groupFor(parsed, ['Seekwide'])?.crawlDelay, undefined);
  assert.equal(groupFor(parsed, ['Googlebot-Image', 'Googlebot'])?.crawlDelay, 2);
  assert.equal(groupFor(parseRobotsTxt('User-agent: other\nDisallow: /\n'), ['seekwide']), null);
});

test('a token named only in a group without rules: the crawler falls back to *, another crawler is allowed', async () => {
  const robots = await robotsOf('User-agent: googlebot\n\nUser-agent: *\nDisallow: /\n\nUser-agent: seekwide\n');
  // An empty line does not end a run either: googlebot and * share the Disallow.
  assert.equal(robots.allowsAgents(`${ORIGIN}/x`, ['Googlebot']), false);
  assert.equal(robots.isAllowed(`${ORIGIN}/x`), false);
  assert.equal(robots.allowsAgents(`${ORIGIN}/x`, ['seekwide']), true);
});

test('agentToken lower-cases, drops the version and trims', () => {
  assert.equal(agentToken(' Googlebot-Image/2.1 '), 'googlebot-image');
  assert.equal(agentToken('*'), '*');
});

test('a file with CR line ends names its agents like any other (0.1.0 read their names only at LF)', async () => {
  for (const end of ['\n', '\r\n', '\r']) {
    const robots = await robotsOf(['User-agent: *', 'Disallow: /', 'User-agent: Googlebot-Image'].join(end));
    assert.equal(robots.allowsAgents(`${ORIGIN}/a.png`, ['Googlebot-Image', 'Googlebot']), true, JSON.stringify(end));
    assert.equal(robots.isAllowed(`${ORIGIN}/a.png`), false, JSON.stringify(end));
  }
});
