// Response headers built to break or slow the crawler.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseLinkHeaders } from '../../server/src/extract/headers.js';
import { mdText } from '../../server/src/report/escape.js';
import { safeFetch } from '../../server/src/net/safe-fetch.js';
import { startServer } from '../helpers/http-server.js';

/** CPU time of this process in milliseconds; a busy machine does not change it. */
const cpuMs = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

test('a header named __proto__ or constructor is read like any other header', async () => {
  const server = await startServer({
    '/': (req, res) => {
      res.setHeader('__proto__', 'x');
      res.setHeader('constructor', 'y');
      res.setHeader('content-type', 'text/html');
      res.end('<title>T</title>');
    },
  });
  try {
    const result = await safeFetch(`${server.origin}/`, { allowLoopback: true });
    assert.equal(result.error, null);
    assert.equal(result.status, 200);
    assert.deepEqual(result.headerLines.constructor, ['y']);
    assert.equal(Object.getPrototypeOf(result.headers), Object.prototype);
  } finally {
    await server.close();
  }
});

test('a Link header of many "<" is parsed in linear time, an ordinary one as before', () => {
  // 16,000 "<" took up to half a second with the old pattern; 160,000 would have taken 40 s.
  const started = cpuMs();
  parseLinkHeaders([`${'<'.repeat(160_000)}x`], 'https://example.test/');
  assert.ok(cpuMs() - started < 2000, `took ${cpuMs() - started} ms`);
  const parsed = parseLinkHeaders(['<https://example.test/a>; rel="canonical"'], 'https://example.test/');
  assert.equal(parsed.canonicals[0].url, 'https://example.test/a');
});

test('page text in the Markdown report cannot become an e-mail link', () => {
  assert.equal(mdText('write to bob@evil.test'), 'write to bob\\@evil.test');
  assert.equal(mdText('plain words'), 'plain words');
});
