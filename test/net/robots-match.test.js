// robots.txt rules evaluated in linear time, with the same answers as robots-parser.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import robotsParser from 'robots-parser';

import { compileRule, compiledGroup, decidingRule, ruleMatches } from '../../server/src/net/robots-match.js';
import { loadRobots } from '../../server/src/net/robots.js';
import { fakeFetch } from './fake-fetch.js';

const ORIGIN = 'https://site.test';

/** CPU time of this process in milliseconds; a busy machine does not change it. */
const cpuMs = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

/** A small deterministic generator, so a failure can be replayed. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test('the linear matcher gives robots-parser\'s answer for random patterns and paths', () => {
  const next = random(20261112);
  /** @param {string} alphabet @param {number} max */
  const word = (alphabet, max) => Array.from({ length: Math.floor(next() * max) }, () => alphabet[Math.floor(next() * alphabet.length)]).join('');
  for (let round = 0; round < 3000; round += 1) {
    const lines = Array.from({ length: 1 + Math.floor(next() * 4) }, () => `${next() < 0.5 ? 'Allow' : 'Disallow'}: /${word('ab*$/', 7)}`);
    const text = `User-agent: *\n${lines.join('\n')}\n`;
    const parser = /** @type {any} */ (robotsParser)(`${ORIGIN}/robots.txt`, text);
    const group = compiledGroup(parser, 'Seekwide');
    assert.ok(group !== null);
    for (let probe = 0; probe < 5; probe += 1) {
      const url = `${ORIGIN}/${word('ab$/', 9)}`;
      const expected = parser.isAllowed(url, 'Seekwide') !== false;
      const path = new URL(url).pathname;
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
  // One check of a 2000-character path took about 3.6 s with robots-parser's matcher.
  const rule = `Disallow: /*${'a*'.repeat(16)}b`;
  const text = `User-agent: *\n${`${rule}\n`.repeat(Math.floor((500 * 1024) / (rule.length + 1)) - 1)}`;
  const { fetch } = fakeFetch({ [`${ORIGIN}/robots.txt`]: { status: 200, text } });
  const robots = await loadRobots(ORIGIN, { fetch });
  const started = cpuMs();
  for (let i = 0; i < 20; i += 1) assert.equal(robots.isAllowed(`${ORIGIN}/${'a'.repeat(2000)}${i}`), true);
  assert.ok(cpuMs() - started < 3000, `took ${cpuMs() - started} ms`);
  assert.equal(robots.isAllowed(`${ORIGIN}/${'a'.repeat(30)}b`), false);
});

test('rules are read from robots-parser only in the shape the pinned version uses', () => {
  assert.equal(compiledGroup({}, 'Seekwide'), null);
  assert.equal(compiledGroup({ _rules: { '*': [{ pattern: 1, allow: true }] } }, 'Seekwide'), null);
  assert.deepEqual(compiledGroup({ _rules: Object.assign(Object.create(null), { seekwide: [] }) }, 'Seekwide/1.0'), []);
});
