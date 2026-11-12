// robots.txt rules evaluated in linear time, with the same answers as the
// quadratic matcher of Google's robotstxt library, which robots-parser 3.0.1
// (used up to version 0.1.0) also implements.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compileGroup, compileRule, decidingRule, ruleMatches } from '../../server/src/net/robots-match.js';
import { groupFor, parseRobotsTxt } from '../../server/src/net/robots-parse.js';
import { loadRobots } from '../../server/src/net/robots.js';
import { fakeFetch } from './fake-fetch.js';

const ORIGIN = 'https://site.test';

/** CPU time of this process in milliseconds; a busy machine does not change it. */
const cpuMs = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

/**
 * Google's matcher: every length of the path the pattern can match so far is
 * kept while the pattern is read; `*` matches any run, a final `$` the end.
 * @param {string} pattern
 * @param {string} path
 */
function referenceMatches(pattern, path) {
  let lengths = [0];
  for (let p = 0; p < pattern.length; p += 1) {
    if (pattern[p] === '$' && p + 1 === pattern.length) return lengths[lengths.length - 1] === path.length;
    if (pattern[p] === '*') {
      lengths = Array.from({ length: path.length - lengths[0] + 1 }, (_, i) => lengths[0] + i);
    } else {
      lengths = lengths.filter((length) => length < path.length && path[length] === pattern[p]).map((length) => length + 1);
      if (lengths.length === 0) return false;
    }
  }
  return true;
}

/**
 * Whether the reference allows `path`: the longest matching pattern decides, allow on a tie.
 * @param {{pattern: string, allow: boolean}[]} rules
 * @param {string} path
 */
function referenceAllows(rules, path) {
  /** @type {{pattern: string, allow: boolean}|null} */
  let chosen = null;
  for (const rule of rules) {
    if (!referenceMatches(rule.pattern, path)) continue;
    if (chosen === null || rule.pattern.length > chosen.pattern.length || (rule.pattern.length === chosen.pattern.length && rule.allow && !chosen.allow)) chosen = rule;
  }
  return chosen === null || chosen.allow;
}

/** A small deterministic generator, so a failure can be replayed. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test('the linear matcher gives the reference matcher\'s answer for random patterns and paths', () => {
  const next = random(20261112);
  /** @param {string} alphabet @param {number} max */
  const word = (alphabet, max) => Array.from({ length: Math.floor(next() * max) }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
  for (let round = 0; round < 3000; round += 1) {
    const lines = Array.from({ length: 1 + Math.floor(next() * 4) }, () => `${next() < 0.5 ? 'Allow' : 'Disallow'}: /${word('ab*$/', 7)}`);
    const text = `User-agent: *\n${lines.join('\n')}\n`;
    const stored = groupFor(parseRobotsTxt(text), ['Seekwide']);
    assert.ok(stored !== null);
    const group = compileGroup(stored);
    for (let probe = 0; probe < 5; probe += 1) {
      const url = `${ORIGIN}/${word('ab$/', 9)}`;
      const path = new URL(url).pathname;
      const expected = referenceAllows(stored.rules, path);
      assert.equal(decidingRule(group, path)?.allow ?? true, expected, `${text}${url}`);
    }
  }
});

test('wildcards and the end anchor follow RFC 9309', () => {
  /** @param {string} pattern @param {string} path */
  const match = (pattern, path) => ruleMatches(compileRule({ pattern, allow: false }), path);
  assert.equal(match('/a*b', '/axxb/more'), true);
  assert.equal(match('/a*b$', '/axxb'), true);
  assert.equal(match('/a*b$', '/axxb/more'), false);
  assert.equal(match('/a$', '/a'), true);
  assert.equal(match('/a$', '/ab'), false);
  assert.equal(match('/a$b', '/a$b'), true, 'a $ that does not end the pattern is a literal');
  assert.equal(match('*.php$', '/x.php'), true);
  assert.equal(match('/ab*ba', '/aba'), false, 'pieces do not overlap');
});

test('a 500 KiB file of wildcard rules and a long URL are evaluated quickly', async () => {
  // One check of a 2000-character path took about 3.6 s with the quadratic matcher robots-parser used.
  const rule = `Disallow: /*${'a*'.repeat(16)}b`;
  const text = `User-agent: *\n${`${rule}\n`.repeat(Math.floor((500 * 1024) / (rule.length + 1)) - 1)}`;
  const { fetch } = fakeFetch({ [`${ORIGIN}/robots.txt`]: { status: 200, text } });
  const robots = await loadRobots(ORIGIN, { fetch });
  const started = cpuMs();
  for (let i = 0; i < 20; i += 1) assert.equal(robots.isAllowed(`${ORIGIN}/${'a'.repeat(2000)}${i}`), true);
  assert.ok(cpuMs() - started < 3000, `took ${cpuMs() - started} ms`);
  assert.equal(robots.isAllowed(`${ORIGIN}/${'a'.repeat(30)}b`), false);
});

test('no group compiles to no rule, and a group to its rules in order', () => {
  assert.deepEqual(compileGroup(null), []);
  assert.deepEqual(compileGroup({ rules: [{ pattern: '/a*b$', allow: false }, { pattern: '/c', allow: true }] }), [
    { length: 5, allow: false, pieces: ['/a', 'b'], anchored: true },
    { length: 2, allow: true, pieces: ['/c'], anchored: false },
  ]);
});
