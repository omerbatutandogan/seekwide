// A tiny programmable HTTP server for tests. It listens on 127.0.0.1 only.

import http from 'node:http';

/**
 * @typedef {Object} Route
 * @property {number} [status]                    Defaults to 200 (or 302 when `redirect` is set).
 * @property {Record<string, string|string[]>} [headers]
 * @property {string|Buffer} [body]
 * @property {string} [redirect]                  Value for the Location header.
 */

/**
 * @typedef {Route | ((req: http.IncomingMessage, res: http.ServerResponse, ctx: {origin: string}) => void)} RouteHandler
 */

/**
 * Start a server whose answers are defined by `routes`.
 *
 * Keys are matched against the request target (path plus query) first and the
 * path alone second. `{origin}` inside a string body or header value is
 * replaced with the server's origin, so fixtures can contain absolute URLs.
 * Unknown paths answer 404 with a small HTML page.
 *
 * @param {Record<string, RouteHandler>} routes
 * @returns {Promise<{origin: string, port: number, requests: {method: string, url: string, headers: http.IncomingHttpHeaders}[], close: () => Promise<void>}>}
 */
export async function startServer(routes) {
  /** @type {{method: string, url: string, headers: http.IncomingHttpHeaders}[]} */
  const requests = [];
  let origin = '';

  /** @param {string} value */
  const fill = (value) => value.replaceAll('{origin}', origin);

  const server = http.createServer((req, res) => {
    const target = req.url ?? '/';
    requests.push({ method: req.method ?? 'GET', url: target, headers: req.headers });

    const pathOnly = target.split('?')[0];
    const route = routes[target] ?? routes[pathOnly];

    if (route === undefined) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html lang="en"><head><title>Not found</title></head><body><h1>Not found</h1></body></html>');
      return;
    }
    if (typeof route === 'function') {
      route(req, res, { origin });
      return;
    }

    /** @type {Record<string, string|string[]>} */
    const headers = {};
    for (const [name, value] of Object.entries(route.headers ?? {})) {
      headers[name.toLowerCase()] = Array.isArray(value) ? value.map(fill) : fill(value);
    }
    if (route.redirect !== undefined) headers.location = fill(route.redirect);
    if (route.body !== undefined && headers['content-type'] === undefined) {
      headers['content-type'] = 'text/html; charset=utf-8';
    }

    const status = route.status ?? (route.redirect !== undefined ? 302 : 200);
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || route.body === undefined) {
      res.end();
      return;
    }
    res.end(typeof route.body === 'string' ? fill(route.body) : route.body);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('test server did not get a port');
  origin = `http://127.0.0.1:${address.port}`;

  return {
    origin,
    port: address.port,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
