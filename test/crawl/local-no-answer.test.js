// A crawl of a server on this machine where nothing answers (a dev server that
// has not started, or another port) used to end as blocked with
// "robots.txt could not be read". It ends as failed, with a message that says
// what to check. A public site keeps the old behaviour.

import assert from 'node:assert/strict';
import net from 'node:net';
import { after, test } from 'node:test';

import { fakeFetch } from '../net/fake-fetch.js';
import { crawl, removeTempDirs } from './harness.js';

after(removeTempDirs);

const LOCAL = /^Nothing answered at http:\/\/127\.0\.0\.1:\d+ \(.+\)\. Check that the dev server is running and that the port is right\.$/;

/** A port on 127.0.0.1 that nothing listens on. @returns {Promise<number>} */
async function closedPort() {
  return new Promise((resolve) => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const address = /** @type {net.AddressInfo} */ (server.address());
      server.close(() => resolve(address.port));
    });
  });
}

test('a local address where nothing listens fails the crawl, saying to check the dev server and the port', async () => {
  const port = await closedPort();
  const { job, result } = await crawl({ url: `http://127.0.0.1:${port}/`, allowLoopback: true });
  assert.equal(job?.status, 'failed');
  assert.match(String(job?.error), LOCAL);
  assert.match(String(job?.error), /ECONNREFUSED/);
  assert.equal(result, null);
});

test('a local server that does not answer in time fails the same way; one that answers with an error is still blocked', async () => {
  const origin = 'http://127.0.0.1:4100';
  const silent = fakeFetch({ [`${origin}/robots.txt`]: { status: 0, error: { code: 'timeout', message: 'No complete response within 15000 ms' } } });
  const timedOut = await crawl({ url: `${origin}/`, allowLoopback: true }, { fetch: silent.fetch });
  assert.equal(timedOut.job?.status, 'failed');
  assert.match(String(timedOut.job?.error), LOCAL);
  assert.deepEqual(silent.calls.map((call) => call.url), [`${origin}/robots.txt`], 'nothing else is requested');

  const erroring = fakeFetch({ [`${origin}/robots.txt`]: { status: 503, text: 'starting' } });
  const blocked = await crawl({ url: `${origin}/`, allowLoopback: true }, { fetch: erroring.fetch });
  assert.equal(blocked.job?.status, 'blocked');
  assert.deepEqual(blocked.result?.blocked, { reason: 'robots_unreachable', url: `${origin}/robots.txt`, status: 503 });
});

test('a local page that does not answer after robots.txt did names the dev server too', async () => {
  const origin = 'http://127.0.0.1:4101';
  const { fetch } = fakeFetch({ [`${origin}/`]: { status: 0, error: { code: 'connection_error', message: 'socket hang up' } } });
  const { job } = await crawl({ url: `${origin}/`, allowLoopback: true }, { fetch });
  assert.equal(job?.status, 'failed');
  assert.equal(job?.error, `Could not fetch ${origin}/: socket hang up (connection_error). Check that the dev server is running and that the port is right.`);
});

test('a public site whose robots.txt does not answer keeps its result: blocked, robots.txt could not be read', async () => {
  for (const code of /** @type {const} */ (['connection_error', 'timeout'])) {
    const { fetch } = fakeFetch({ 'https://site.test/robots.txt': { status: 0, error: { code, message: 'no answer' } } });
    const { job, result } = await crawl({ url: 'https://site.test/' }, { fetch });
    assert.equal(job?.status, 'blocked', code);
    assert.deepEqual(result?.blocked, { reason: 'robots_unreachable', url: 'https://site.test/robots.txt', status: 0 });
  }
});
