import assert from 'node:assert/strict';
import dns from 'node:dns';
import http from 'node:http';
import { after, before, mock, test } from 'node:test';
import zlib from 'node:zlib';

import { USER_AGENT } from '../../plugin/server/src/config.js';
import { pinnedLookup, safeFetch } from '../../plugin/server/src/net/safe-fetch.js';
import { startServer } from '../helpers/http-server.js';

/** @type {Awaited<ReturnType<typeof startServer>>} */
let server;
const LOOP = { allowLoopback: true };

before(async () => {
  server = await startServer({
    '/': { body: '<!doctype html><title>Home</title>' },
    '/r1': { status: 301, redirect: '/r2' },
    '/r2': { status: 302, redirect: '/r3' },
    '/r3': { status: 307, redirect: '/' },
    '/see-other': { status: 303, redirect: '{origin}/' },
    '/perm': { status: 308, redirect: '/' },
    '/loop-a': { redirect: '/loop-b' },
    '/loop-b': { redirect: '/loop-a' },
    '/no-location': { status: 301, body: 'moved somewhere' },
    '/to-private': { redirect: 'http://10.0.0.1/' },
    '/to-metadata': { redirect: 'http://169.254.169.254/latest/meta-data/' },
    '/to-mapped': { redirect: 'http://[::ffff:10.0.0.1]/' },
    '/to-unspecified': { redirect: 'http://0.0.0.0/' },
    '/to-ftp': { redirect: 'ftp://example.com/file' },
    '/gzip': { headers: { 'content-encoding': 'gzip' }, body: zlib.gzipSync('gzip body') },
    '/deflate': { headers: { 'content-encoding': 'deflate' }, body: zlib.deflateSync('zlib deflate body') },
    '/deflate-raw': { headers: { 'content-encoding': 'deflate' }, body: zlib.deflateRawSync('raw deflate body') },
    '/br': { headers: { 'content-encoding': 'br' }, body: zlib.brotliCompressSync('brotli body') },
    '/bad-gzip': { headers: { 'content-encoding': 'gzip' }, body: Buffer.from('this is not gzip data at all') },
    '/bomb': { headers: { 'content-encoding': 'gzip' }, body: zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024)) },
    '/big': { body: 'x'.repeat(10_000) },
    '/exact': { body: 'x'.repeat(100) },
    '/multi': { headers: { 'set-cookie': ['a=1', 'b=2'], 'x-robots-tag': ['noindex', 'googlebot: nofollow'] }, body: 'ok' },
    '/to-credentials': (_req, res, { origin }) => { res.writeHead(302, { location: origin.replace('http://', 'http://user:secret@') + '/echo' }); res.end(); },
    '/echo': (req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.headers));
    },
    '/echo-post': (req, res) => {
      /** @type {Buffer[]} */
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString('utf8') }));
      });
    },
    '/post-moved': { status: 307, redirect: '/echo-post' },
    '/hang': () => {},
    '/slow-body': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.write('start');
    },
    '/cut': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': '1000' });
      res.write('only part of it');
      setTimeout(() => res.socket?.destroy(), 20);
    },
  });
});

after(() => server.close());

test('a loopback IP literal is refused by default and nothing is sent', async () => {
  const before = server.requests.length;
  const result = await safeFetch(`${server.origin}/`);
  assert.equal(result.error?.code, 'blocked_address');
  assert.equal(result.status, 0);
  assert.equal(result.body, null);
  assert.equal(server.requests.length, before);
});

test('a loopback IP literal is allowed with allowLoopback', async () => {
  const result = await safeFetch(`${server.origin}/`, LOOP);
  assert.equal(result.error, null);
  assert.equal(result.status, 200);
  assert.equal(result.body?.toString(), '<!doctype html><title>Home</title>');
  assert.equal(result.finalUrl, `${server.origin}/`);
  assert.deepEqual(result.redirectChain, []);
});

test('a host name that resolves to loopback is refused by default and allowed with allowLoopback', async () => {
  const url = `http://localhost:${server.port}/`;
  const refused = await safeFetch(url);
  assert.equal(refused.error?.code, 'blocked_address');
  const allowed = await safeFetch(url, LOOP);
  assert.equal(allowed.error, null);
  assert.equal(allowed.status, 200);
});

test('a redirect from an allowed loopback server to a private address is refused', async () => {
  for (const [path, target] of [
    ['/to-private', 'http://10.0.0.1/'],
    ['/to-metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['/to-mapped', 'http://[::ffff:a00:1]/'],
    ['/to-unspecified', 'http://0.0.0.0/'],
  ]) {
    const result = await safeFetch(`${server.origin}${path}`, LOOP);
    assert.equal(result.error?.code, 'blocked_address', path);
    assert.equal(result.status, 0, path);
    assert.deepEqual(result.headers, {}, path);
    assert.equal(result.body, null, path);
    assert.equal(result.finalUrl, target, path);
    assert.deepEqual(result.redirectChain, [{ url: `${server.origin}${path}`, status: 302, location: target }]);
  }
});

test('pinnedLookup answers only with the checked addresses, whatever name is asked', () => {
  const lookup = pinnedLookup([{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]);
  /** @type {unknown[]} */
  let single = [];
  lookup('evil.example', {}, (/** @type {unknown[]} */ ...args) => { single = args; });
  assert.deepEqual(single, [null, '127.0.0.1', 4]);
  /** @type {unknown[]} */
  let all = [];
  lookup('evil.example', { all: true }, (/** @type {unknown[]} */ ...args) => { all = args; });
  assert.deepEqual(all, [null, [{ address: '127.0.0.1', family: 4 }, { address: '::1', family: 6 }]]);
});

test('only http and https are fetched, also after a redirect', async () => {
  for (const url of ['ftp://example.com/', 'file:///etc/passwd', 'data:text/plain,hi', 'javascript:alert(1)']) {
    const result = await safeFetch(url);
    assert.equal(result.error?.code, 'unsupported_protocol', url);
  }
  const redirected = await safeFetch(`${server.origin}/to-ftp`, LOOP);
  assert.equal(redirected.error?.code, 'unsupported_protocol');
  assert.equal(redirected.status, 0);
  assert.equal(redirected.redirectChain.length, 1);
});

test('an invalid URL is reported, not thrown', async () => {
  const result = await safeFetch('not a url');
  assert.equal(result.error?.code, 'invalid_url');
  assert.equal(result.url, 'not a url');
  assert.equal(result.status, 0);
});

test('invalid options throw TypeError', async () => {
  await assert.rejects(safeFetch(/** @type {any} */ (42)), TypeError);
  await assert.rejects(safeFetch('http://a.test/', /** @type {any} */ ({ method: 'PUT' })), TypeError);
  await assert.rejects(safeFetch('http://a.test/', /** @type {any} */ ({ body: 'only with POST' })), /body is only sent with POST/);
  await assert.rejects(safeFetch('http://a.test/', /** @type {any} */ ({ method: 'HEAD', body: 'x' })), TypeError);
  await assert.rejects(safeFetch('http://a.test/', /** @type {any} */ ({ method: 'POST', body: { a: 1 } })), /string or a Buffer/);
  await assert.rejects(safeFetch('http://a.test/', { timeoutMs: 0 }), TypeError);
  await assert.rejects(safeFetch('http://a.test/', { maxBytes: -1 }), TypeError);
  await assert.rejects(safeFetch('http://a.test/', { maxRedirects: 1.5 }), TypeError);
  await assert.rejects(safeFetch('http://a.test/', /** @type {any} */ ({ allowLoopback: 'yes' })), TypeError);
  await assert.rejects(safeFetch('http://a.test/', /** @type {any} */ ({ headers: { accept: 1 } })), TypeError);
  await assert.rejects(safeFetch('http://a.test/', { userAgent: ' ' }), TypeError);
});

test('sends the identifying user agent, accept and accept-encoding headers', async () => {
  const result = await safeFetch(`${server.origin}/echo`, LOOP);
  const sent = JSON.parse(String(result.body));
  assert.equal(sent['user-agent'], USER_AGENT);
  assert.equal(sent.accept, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5');
  assert.equal(sent['accept-encoding'], 'gzip, deflate, br');
});

test('extra headers are sent but cannot replace the user agent; userAgent can', async () => {
  const result = await safeFetch(`${server.origin}/echo`, { ...LOOP, headers: { Accept: 'text/plain', 'User-Agent': 'Mozilla/5.0' } });
  const sent = JSON.parse(String(result.body));
  assert.equal(sent.accept, 'text/plain');
  assert.equal(sent['user-agent'], USER_AGENT);
  const custom = await safeFetch(`${server.origin}/echo`, { ...LOOP, userAgent: 'seekwide-test/1' });
  assert.equal(JSON.parse(String(custom.body))['user-agent'], 'seekwide-test/1');
});

test('follows 301, 302, 307 and records every hop', async () => {
  const result = await safeFetch(`${server.origin}/r1`, LOOP);
  assert.equal(result.error, null);
  assert.equal(result.status, 200);
  assert.equal(result.finalUrl, `${server.origin}/`);
  assert.deepEqual(result.redirectChain, [
    { url: `${server.origin}/r1`, status: 301, location: `${server.origin}/r2` },
    { url: `${server.origin}/r2`, status: 302, location: `${server.origin}/r3` },
    { url: `${server.origin}/r3`, status: 307, location: `${server.origin}/` },
  ]);
});

test('follows 303 and 308', async () => {
  for (const path of ['/see-other', '/perm']) {
    const result = await safeFetch(`${server.origin}${path}`, LOOP);
    assert.equal(result.status, 200, path);
    assert.equal(result.redirectChain.length, 1, path);
  }
});

test('too many redirects is an error; exactly the limit is fine', async () => {
  const tooMany = await safeFetch(`${server.origin}/r1`, { ...LOOP, maxRedirects: 2 });
  assert.equal(tooMany.error?.code, 'too_many_redirects');
  assert.equal(tooMany.status, 307);
  const enough = await safeFetch(`${server.origin}/r1`, { ...LOOP, maxRedirects: 3 });
  assert.equal(enough.error, null);
});

test('a URL seen twice is a redirect loop', async () => {
  const result = await safeFetch(`${server.origin}/loop-a`, LOOP);
  assert.equal(result.error?.code, 'redirect_loop');
  assert.equal(result.status, 302, 'a loop keeps the last redirect status');
  assert.equal(result.redirectChain.length, 2);
});

test('with maxRedirects 0 a 3xx is the final response', async () => {
  const result = await safeFetch(`${server.origin}/r1`, { ...LOOP, maxRedirects: 0 });
  assert.equal(result.error, null);
  assert.equal(result.status, 301);
  assert.equal(result.headers.location, '/r2');
  assert.deepEqual(result.redirectChain, []);
});

test('a 3xx without Location is the final response', async () => {
  const result = await safeFetch(`${server.origin}/no-location`, LOOP);
  assert.equal(result.error, null);
  assert.equal(result.status, 301);
  assert.equal(result.body?.toString(), 'moved somewhere');
});

test('decompresses gzip, zlib deflate, raw deflate and brotli', async () => {
  for (const [path, text] of [['/gzip', 'gzip body'], ['/deflate', 'zlib deflate body'], ['/deflate-raw', 'raw deflate body'], ['/br', 'brotli body']]) {
    const result = await safeFetch(`${server.origin}${path}`, LOOP);
    assert.equal(result.error, null, path);
    assert.equal(result.body?.toString(), text, path);
    assert.equal(result.bytes, text.length, path);
  }
});

test('corrupt compressed data is a body_error', async () => {
  const result = await safeFetch(`${server.origin}/bad-gzip`, LOOP);
  assert.equal(result.error?.code, 'body_error');
  assert.equal(result.status, 0, 'a failed body is a failed request, not a 200');
  assert.equal(result.body, null);
});

test('a connection closed mid-body is a body_error', async () => {
  const result = await safeFetch(`${server.origin}/cut`, LOOP);
  assert.equal(result.error?.code, 'body_error');
  assert.equal(result.status, 0);
  assert.deepEqual(result.headers, {});
});

test('reads at most maxBytes of decompressed body and marks it truncated', async () => {
  const big = await safeFetch(`${server.origin}/big`, { ...LOOP, maxBytes: 100 });
  assert.equal(big.truncated, true);
  assert.equal(big.bytes, 100);
  assert.equal(big.body?.length, 100);
  const bomb = await safeFetch(`${server.origin}/bomb`, { ...LOOP, maxBytes: 1000 });
  assert.equal(bomb.error, null);
  assert.equal(bomb.truncated, true);
  assert.equal(bomb.bytes, 1000);
});

test('a body of exactly maxBytes is not truncated', async () => {
  const result = await safeFetch(`${server.origin}/exact`, { ...LOOP, maxBytes: 100 });
  assert.equal(result.truncated, false);
  assert.equal(result.bytes, 100);
});

test('keeps repeated headers joined in headers and separate in headerLines', async () => {
  const result = await safeFetch(`${server.origin}/multi`, LOOP);
  assert.equal(result.headers['x-robots-tag'], 'noindex, googlebot: nofollow');
  assert.deepEqual(result.headerLines['x-robots-tag'], ['noindex', 'googlebot: nofollow']);
  assert.deepEqual(result.headerLines['set-cookie'], ['a=1', 'b=2']);
  assert.equal(result.headers['content-type'], 'text/html; charset=utf-8');
});

test('HEAD returns no body', async () => {
  const result = await safeFetch(`${server.origin}/`, { ...LOOP, method: 'HEAD' });
  assert.equal(result.status, 200);
  assert.equal(result.body, null);
  assert.equal(result.bytes, 0);
  assert.equal(server.requests.at(-1)?.method, 'HEAD');
});

test('timeoutMs covers waiting for the response and reading the body', async () => {
  const hang = await safeFetch(`${server.origin}/hang`, { ...LOOP, timeoutMs: 150 });
  assert.equal(hang.error?.code, 'timeout');
  assert.equal(hang.status, 0);
  const slow = await safeFetch(`${server.origin}/slow-body`, { ...LOOP, timeoutMs: 150 });
  assert.equal(slow.error?.code, 'timeout');
  assert.equal(slow.status, 0, 'a body that times out is a failed request, not a 200');
  assert.equal(slow.body, null);
});

test('a refused connection is a connection_error', async () => {
  const closed = await startServer({});
  const url = `${closed.origin}/`;
  await closed.close();
  const result = await safeFetch(url, LOOP);
  assert.equal(result.error?.code, 'connection_error');
  assert.equal(result.status, 0);
});

test('a failed TLS handshake is a tls_error', async () => {
  const result = await safeFetch(`https://127.0.0.1:${server.port}/`, LOOP);
  assert.equal(result.error?.code, 'tls_error');
});

test('a redirect to a loopback host name is allowed only with allowLoopback', async () => {
  const target = await startServer({ '/': { body: 'target' } });
  const source = http.createServer((_req, res) => {
    res.writeHead(302, { location: `http://localhost:${target.port}/` });
    res.end();
  });
  await new Promise((resolve) => source.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = /** @type {import('node:net').AddressInfo} */ (source.address());
  try {
    const result = await safeFetch(`http://127.0.0.1:${address.port}/`, LOOP);
    assert.equal(result.error, null);
    assert.equal(result.body?.toString(), 'target');
  } finally {
    source.closeAllConnections();
    await new Promise((resolve) => source.close(() => resolve(undefined)));
    await target.close();
  }
});

test('credentials in the URL are removed: not sent, not reported', async () => {
  const withCreds = server.origin.replace('http://', 'http://user:secret@');
  const result = await safeFetch(`${withCreds}/echo`, LOOP);
  assert.equal(result.error, null);
  const sent = JSON.parse(String(result.body));
  assert.equal(sent.authorization, undefined);
  assert.equal(result.url, `${server.origin}/echo`);
  assert.equal(result.finalUrl, `${server.origin}/echo`);
});

test('credentials in a redirect Location are removed: not sent, not in the chain', async () => {
  const result = await safeFetch(`${server.origin}/to-credentials`, LOOP);
  assert.equal(result.error, null);
  assert.equal(JSON.parse(String(result.body)).authorization, undefined);
  assert.equal(result.finalUrl, `${server.origin}/echo`);
  assert.deepEqual(result.redirectChain, [{ url: `${server.origin}/to-credentials`, status: 302, location: `${server.origin}/echo` }]);
  assert.doesNotMatch(JSON.stringify(result.redirectChain), /secret/);
});

test('an Authorization header is never sent, even when passed in headers', async () => {
  const result = await safeFetch(`${server.origin}/echo`, { ...LOOP, headers: { Authorization: 'Basic dXNlcjpzZWNyZXQ=', accept: 'text/plain' } });
  const sent = JSON.parse(String(result.body));
  assert.equal(sent.authorization, undefined);
  assert.equal(sent.accept, 'text/plain');
});

test('allowLoopback as an origin allows loopback only for exactly that origin', async () => {
  const allowed = await safeFetch(`${server.origin}/`, { allowLoopback: server.origin });
  assert.equal(allowed.error, null);
  assert.equal(allowed.status, 200);
  const other = await startServer({ '/': { body: 'other port' } });
  try {
    const before = other.requests.length;
    const refused = await safeFetch(`${other.origin}/`, { allowLoopback: server.origin });
    assert.equal(refused.error?.code, 'blocked_address');
    assert.equal(refused.status, 0);
    assert.equal(other.requests.length, before);
    const byName = await safeFetch(`http://localhost:${server.port}/`, { allowLoopback: server.origin });
    assert.equal(byName.error?.code, 'blocked_address', 'another origin, even on the same port');
  } finally {
    await other.close();
  }
});

test('with an origin allowLoopback, a redirect to another local port is refused', async () => {
  const other = await startServer({ '/': { body: 'secret service' } });
  const source = await startServer({ '/': { redirect: `${other.origin}/` } });
  try {
    const result = await safeFetch(`${source.origin}/`, { allowLoopback: source.origin });
    assert.equal(result.error?.code, 'blocked_address');
    assert.equal(other.requests.length, 0);
    const permissive = await safeFetch(`${source.origin}/`, { allowLoopback: true });
    assert.equal(permissive.body?.toString(), 'secret service');
  } finally {
    await source.close();
    await other.close();
  }
});

test('allowLoopback must be a boolean or an http(s) origin', async () => {
  await assert.rejects(safeFetch('http://a.test/', /** @type {any} */ ({ allowLoopback: 'not an origin' })), TypeError);
  await assert.rejects(safeFetch('http://a.test/', /** @type {any} */ ({ allowLoopback: 'ftp://x.test' })), TypeError);
});

test('a name that does not exist is dns_error; any other lookup failure is dns_temporary', async () => {
  /** @param {string} code */
  const failWith = (code) => {
    mock.restoreAll();
    mock.method(dns.promises, 'lookup', async () => {
      throw Object.assign(new Error(`lookup ${code}`), { code });
    });
  };
  for (const [code, expected] of [['ENOTFOUND', 'dns_error'], ['ENODATA', 'dns_error'], ['EAI_AGAIN', 'dns_temporary'], ['ESERVFAIL', 'dns_temporary'], ['EAI_FAIL', 'dns_temporary']]) {
    failWith(code);
    const result = await safeFetch('http://name.test/');
    assert.equal(result.error?.code, expected, code);
    assert.equal(result.status, 0, code);
  }
  mock.restoreAll();
});

test('a lookup that does not finish in time is dns_temporary', async () => {
  mock.method(dns.promises, 'lookup', () => new Promise(() => {}));
  try {
    const result = await safeFetch('http://slow-dns.test/', { timeoutMs: 50 });
    assert.equal(result.error?.code, 'dns_temporary');
    assert.equal(result.status, 0);
  } finally {
    mock.restoreAll();
  }
});

test('a host name whose DNS answer is private is refused', async () => {
  mock.method(dns.promises, 'lookup', async () => [{ address: '10.1.2.3', family: 4 }]);
  try {
    const result = await safeFetch('http://intranet.test/');
    assert.equal(result.error?.code, 'blocked_address');
  } finally {
    mock.restoreAll();
  }
});

test('POST sends the body with its length, and the headers the caller gave', async () => {
  const body = JSON.stringify({ origin: 'https://example.com', note: 'çalışır' });
  const result = await safeFetch(`${server.origin}/echo-post`, { ...LOOP, method: 'POST', body, headers: { 'content-type': 'application/json', 'content-length': '1' } });
  assert.equal(result.error, null);
  assert.equal(result.status, 200);
  const seen = JSON.parse(String(result.body));
  assert.equal(seen.method, 'POST');
  assert.equal(seen.body, body);
  assert.equal(seen.headers['content-length'], String(Buffer.byteLength(body)), 'the length is the real one, whatever the caller passed');
  assert.equal(seen.headers['content-type'], 'application/json');
  assert.equal(seen.headers['user-agent'], USER_AGENT);
});

test('POST accepts a Buffer and, without a body, sends an empty one', async () => {
  const withBuffer = await safeFetch(`${server.origin}/echo-post`, { ...LOOP, method: 'POST', body: Buffer.from('raw bytes') });
  assert.equal(JSON.parse(String(withBuffer.body)).body, 'raw bytes');
  const empty = await safeFetch(`${server.origin}/echo-post`, { ...LOOP, method: 'POST' });
  const seen = JSON.parse(String(empty.body));
  assert.equal(seen.body, '');
  assert.equal(seen.headers['content-length'], '0');
});

test('a POST is never redirected: the 3xx is its final response and the body goes nowhere else', async () => {
  const before = server.requests.length;
  const result = await safeFetch(`${server.origin}/post-moved`, { ...LOOP, method: 'POST', body: 'secret body', maxRedirects: 5 });
  assert.equal(result.error, null);
  assert.equal(result.status, 307);
  assert.equal(result.finalUrl, `${server.origin}/post-moved`);
  assert.deepEqual(result.redirectChain, []);
  assert.deepEqual(server.requests.slice(before).map((request) => `${request.method} ${request.url}`), ['POST /post-moved']);
});

test('a GET sends no content-length, even when the caller passes one', async () => {
  const result = await safeFetch(`${server.origin}/echo`, { ...LOOP, headers: { 'content-length': '5' } });
  assert.equal(JSON.parse(String(result.body))['content-length'], undefined);
});
