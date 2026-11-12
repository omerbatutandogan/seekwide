#!/usr/bin/env node
// A static file server for the eval scaffolds. The eval sandbox does not let
// a command Claude runs listen on a port, so a scaffold starts this server
// outside the sandbox and Claude's dev command only prints its address.
//
// Usage: node serve-static.mjs <dir> <port|0> <port-file> <seconds>
//   Serves <dir> on 127.0.0.1 (port 0 picks a free one), writes the port to
//   <port-file> once it listens, and exits by itself after <seconds>.
//   `{origin}` in a text file is replaced with the server's address, as the
//   test server of the repository does.

import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [dir, portArg, portFile, secondsArg] = process.argv.slice(2);
if (!dir || portArg === undefined || !portFile || !secondsArg) {
  console.error('Usage: node serve-static.mjs <dir> <port|0> <port-file> <seconds>');
  process.exit(2);
}
const root = path.resolve(dir);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** The file a request path names, or null when it is outside the folder or missing. */
async function fileFor(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const target = path.resolve(root, `.${decoded.endsWith('/') ? `${decoded}index.html` : decoded}`);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) return null;
  const info = await stat(target).catch(() => null);
  if (info?.isDirectory()) return null;
  return info?.isFile() ? target : null;
}

const server = createServer(async (req, res) => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  let pathname;
  try {
    pathname = new URL(req.url ?? '/', origin).pathname;
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }
  const file = req.method === 'GET' || req.method === 'HEAD' ? await fileFor(pathname) : null;
  if (file === null) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : '<!doctype html><title>Not found</title><h1>Not found</h1>');
    return;
  }
  const type = TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  let body = await readFile(file);
  if (type.includes('charset')) body = Buffer.from(body.toString('utf8').replaceAll('{origin}', origin));
  res.writeHead(200, { 'content-type': type, 'content-length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
});

server.listen(Number(portArg), '127.0.0.1', async () => {
  await writeFile(portFile, String(server.address().port));
});
server.on('error', (error) => {
  console.error(`serve-static: ${error.message}`);
  process.exit(1);
});
setTimeout(() => process.exit(0), Number(secondsArg) * 1000).unref();
