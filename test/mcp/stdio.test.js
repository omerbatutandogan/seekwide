import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { ToolError, createStdioServer } from '../../server/src/mcp/stdio.js';

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'test-client', version: '1.0.0' },
};
const SERVER_INFO = { 'io.modelcontextprotocol/serverInfo': { name: 'test-server', version: '9.9.9' } };

/** @type {import('../../server/src/mcp/stdio.js').ToolDef[]} */
const TOOLS = [
  {
    name: 'echo',
    title: 'Echo',
    description: 'Echo the text back.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 10 } }, required: ['text'], additionalProperties: false },
    handler: async (args) => ({ echoed: args.text }),
  },
  {
    name: 'refuse',
    title: 'Refuse',
    description: 'Always throws a ToolError.',
    inputSchema: { type: 'object', additionalProperties: false },
    handler: async () => {
      throw new ToolError('The crawl is still running. Call crawl_status with wait_seconds until it finishes.');
    },
  },
  {
    name: 'crash',
    title: 'Crash',
    description: 'Always throws an unexpected error.',
    inputSchema: { type: 'object', additionalProperties: false },
    handler: async () => {
      throw new Error('secret internal detail /etc/passwd');
    },
  },
];

/**
 * @param {import('../../server/src/mcp/stdio.js').ToolDef[]} [tools]
 */
function harness(tools = TOOLS) {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = createStdioServer({ name: 'test-server', version: '9.9.9', instructions: 'Use the tools.', tools, input, output });
  server.start();
  /** @type {string[]} */
  const raw = [];
  /** @type {unknown[]} */
  const queue = [];
  /** @type {(() => void)[]} */
  let waiters = [];
  let buffer = '';
  output.setEncoding('utf8');
  output.on('data', (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      raw.push(line);
      queue.push(JSON.parse(line));
      newline = buffer.indexOf('\n');
    }
    for (const wake of waiters) wake();
    waiters = [];
  });
  /** @returns {Promise<any>} */
  async function next() {
    while (queue.length === 0) {
      await new Promise((resolve) => {
        waiters.push(() => resolve(undefined));
      });
    }
    return queue.shift();
  }
  /** @param {unknown} message */
  const send = (message) => input.write(`${JSON.stringify(message)}\n`);
  /** @param {unknown} message */
  const request = async (message) => {
    send(message);
    return next();
  };
  return { input, output, server, raw, queue, next, send, request };
}

/**
 * @param {number|string} id
 * @param {string} name
 * @param {object} args
 */
const call = (id, name, args) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { _meta: META, name, arguments: args } });

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('legacy lifecycle (initialize handshake)', () => {
  it('answers initialize with the requested supported version, capabilities, serverInfo and instructions', async () => {
    const h = harness();
    const response = await h.request({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'c', version: '1' } },
    });
    assert.deepEqual(response, {
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-11-25',
        capabilities: { tools: {} },
        serverInfo: { name: 'test-server', version: '9.9.9' },
        instructions: 'Use the tools.',
      },
    });
    h.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const list = await h.request({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal(list.id, 2);
    assert.equal(list.result.resultType, undefined, 'legacy results carry no resultType');
    assert.deepEqual(list.result.tools.map((/** @type {any} */ t) => t.name), ['echo', 'refuse', 'crash']);
    assert.deepEqual(list.result.tools[0], {
      name: 'echo',
      title: 'Echo',
      description: 'Echo the text back.',
      inputSchema: TOOLS[0].inputSchema,
    });
    const result = await h.request({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } });
    assert.deepEqual(result, { jsonrpc: '2.0', id: 3, result: { content: [{ type: 'text', text: '{"echoed":"hi"}' }] } });
  });

  it('echoes an older supported version and leaves out tool titles before 2025-06-18', async () => {
    const h = harness();
    const response = await h.request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
    assert.equal(response.result.protocolVersion, '2024-11-05');
    const list = await h.request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    assert.equal(list.result.tools[0].title, undefined);
  });

  it('answers an unsupported version with the newest legacy version it supports', async () => {
    const h = harness();
    const response = await h.request({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '1999-01-01', capabilities: {} } });
    assert.equal(response.id, 'init');
    assert.equal(response.result.protocolVersion, '2025-11-25');
  });

  it('rejects initialize without a protocolVersion', async () => {
    const h = harness();
    const response = await h.request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    assert.equal(response.error.code, -32602);
  });

  it('rejects a request sent before initialize that carries no per-request _meta', async () => {
    const h = harness();
    const response = await h.request({ jsonrpc: '2.0', id: 7, method: 'tools/list' });
    assert.equal(response.id, 7);
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /initialize/);
    assert.match(response.error.message, /_meta/);
  });

  it('answers ping before and after initialize', async () => {
    const h = harness();
    assert.deepEqual(await h.request({ jsonrpc: '2.0', id: 1, method: 'ping' }), { jsonrpc: '2.0', id: 1, result: {} });
    await h.request({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } });
    assert.deepEqual(await h.request({ jsonrpc: '2.0', id: 3, method: 'ping' }), { jsonrpc: '2.0', id: 3, result: {} });
  });
});

describe('modern revision (per-request _meta)', () => {
  it('serves tools/list without a handshake, with resultType, caching hints and serverInfo', async () => {
    const h = harness();
    const response = await h.request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: META } });
    assert.equal(response.result.resultType, 'complete');
    assert.equal(response.result.cacheScope, 'public');
    assert.ok(Number.isInteger(response.result.ttlMs) && response.result.ttlMs >= 0);
    assert.deepEqual(response.result._meta, SERVER_INFO);
    assert.equal(response.result.tools[1].title, 'Refuse');
  });

  it('answers server/discover with versions, capabilities and instructions', async () => {
    const h = harness();
    const response = await h.request({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: { _meta: META } });
    assert.deepEqual(response.result.supportedVersions, ['2026-07-28']);
    assert.deepEqual(response.result.capabilities, { tools: {} });
    assert.equal(response.result.instructions, 'Use the tools.');
    assert.equal(response.result.resultType, 'complete');
    assert.equal(response.result.cacheScope, 'public');
    assert.deepEqual(response.result._meta, SERVER_INFO);
  });

  it('rejects an unsupported version with UnsupportedProtocolVersionError', async () => {
    const h = harness();
    const meta = { ...META, 'io.modelcontextprotocol/protocolVersion': '1900-01-01' };
    const response = await h.request({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: meta } });
    assert.deepEqual(response, {
      jsonrpc: '2.0',
      id: 1,
      error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2026-07-28'], requested: '1900-01-01' } },
    });
  });

  it('rejects a request whose _meta lacks client capabilities', async () => {
    const h = harness();
    const response = await h.request({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } });
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /clientCapabilities/);
  });

  it('serves a modern request even after a legacy initialize on the same stream', async () => {
    const h = harness();
    await h.request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {} } });
    const response = await h.request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: META } });
    assert.equal(response.result.resultType, 'complete');
  });

  it('answers ping with an empty complete result', async () => {
    const h = harness();
    const response = await h.request({ jsonrpc: '2.0', id: 1, method: 'ping', params: { _meta: META } });
    assert.deepEqual(response.result, { resultType: 'complete', _meta: SERVER_INFO });
  });
});

describe('tools/call', () => {
  it('returns the handler value as one compact JSON text block', async () => {
    const h = harness();
    const response = await h.request(call(5, 'echo', { text: 'hello' }));
    assert.deepEqual(response, {
      jsonrpc: '2.0',
      id: 5,
      result: { resultType: 'complete', content: [{ type: 'text', text: '{"echoed":"hello"}' }], _meta: SERVER_INFO },
    });
  });

  it('turns a ToolError into isError with its message', async () => {
    const h = harness();
    const response = await h.request(call(1, 'refuse', {}));
    assert.equal(response.result.isError, true);
    assert.deepEqual(response.result.content, [
      { type: 'text', text: 'The crawl is still running. Call crawl_status with wait_seconds until it finishes.' },
    ]);
  });

  it('turns any other exception into a generic message without detail or stack', async () => {
    const h = harness();
    const response = await h.request(call(1, 'crash', {}));
    assert.equal(response.result.isError, true);
    const text = response.result.content[0].text;
    assert.match(text, /internal error/);
    assert.doesNotMatch(text, /secret|passwd|at |stdio\.test/);
  });

  it('reports invalid arguments as a tool execution error naming each problem', async () => {
    const h = harness();
    const response = await h.request(call(1, 'echo', { text: 'far too long text', extra: 1 }));
    assert.equal(response.result.isError, true);
    assert.equal(
      response.result.content[0].text,
      'Invalid arguments for echo: text must be at most 10 characters (got 17); extra is not an accepted argument. Fix the arguments and call echo again.',
    );
    const missing = await h.request(call(2, 'echo', {}));
    assert.match(missing.result.content[0].text, /text is required/);
  });

  it('treats missing arguments as an empty object', async () => {
    const h = harness();
    const response = await h.request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { _meta: META, name: 'refuse' } });
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /still running/);
  });

  it('answers an unknown tool with -32602', async () => {
    const h = harness();
    const response = await h.request(call(1, 'nope', {}));
    assert.equal(response.error.code, -32602);
    assert.match(response.error.message, /Unknown tool: nope/);
  });

  it('answers arguments that are not an object, or a missing name, with -32602', async () => {
    const h = harness();
    const bad = await h.request({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { _meta: META, name: 'echo', arguments: [1] } });
    assert.equal(bad.error.code, -32602);
    const noName = await h.request({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { _meta: META } });
    assert.equal(noName.error.code, -32602);
  });
});

describe('JSON-RPC handling and framing', () => {
  it('answers an unknown method with -32601, before or after initialize', async () => {
    const h = harness();
    const before = await h.request({ jsonrpc: '2.0', id: 1, method: 'resources/list' });
    assert.deepEqual(before.error, { code: -32601, message: 'Method not found: resources/list' });
    const after = await h.request({ jsonrpc: '2.0', id: 2, method: 'prompts/list', params: { _meta: META } });
    assert.equal(after.error.code, -32601);
  });

  it('answers malformed JSON with -32700 and no id, then keeps working', async () => {
    const h = harness();
    h.input.write('{"jsonrpc": "2.0", "id": 1, "method": \n');
    const response = await h.next();
    assert.equal(response.error.code, -32700);
    assert.equal(Object.hasOwn(response, 'id'), false);
    assert.equal((await h.request({ jsonrpc: '2.0', id: 2, method: 'ping' })).id, 2);
  });

  it('answers structurally invalid requests with -32600', async () => {
    const h = harness();
    const noVersion = await h.request({ id: 1, method: 'ping' });
    assert.deepEqual(noVersion, { jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'Invalid Request: "jsonrpc" must be "2.0".' } });
    const nullId = await h.request({ jsonrpc: '2.0', id: null, method: 'ping' });
    assert.equal(nullId.error.code, -32600);
    assert.equal(Object.hasOwn(nullId, 'id'), false);
    const notObject = await h.request(42);
    assert.equal(notObject.error.code, -32600);
    const noMethod = await h.request({ jsonrpc: '2.0', id: 3 });
    assert.equal(noMethod.error.code, -32600);
    assert.equal(noMethod.id, 3);
  });

  it('sends nothing for notifications, known or unknown, or for client responses', async () => {
    const h = harness();
    h.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    h.send({ jsonrpc: '2.0', method: 'notifications/whatever', params: { x: 1 } });
    h.send({ jsonrpc: '2.0', method: 'tools/list' });
    h.send({ jsonrpc: '2.0', id: 99, result: {} });
    const response = await h.request({ jsonrpc: '2.0', id: 'after', method: 'ping' });
    assert.equal(response.id, 'after');
    await tick();
    assert.equal(h.queue.length, 0);
    assert.equal(h.raw.length, 1);
  });

  it('reassembles a message split across chunks, including a split UTF-8 character', async () => {
    const h = harness();
    const bytes = Buffer.from(`${JSON.stringify(call(1, 'echo', { text: 'çé😀' }))}\n`, 'utf8');
    const cut = bytes.indexOf(Buffer.from('😀')) + 2;
    h.input.write(bytes.subarray(0, 10));
    h.input.write(bytes.subarray(10, cut));
    await tick();
    assert.equal(h.queue.length, 0);
    h.input.write(bytes.subarray(cut));
    const response = await h.next();
    assert.equal(response.result.content[0].text, '{"echoed":"çé😀"}');
  });

  it('handles several messages in one chunk, with CRLF and blank lines', async () => {
    const h = harness();
    h.input.write(
      `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\r\n\n${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })}\n${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: META } })}\n`,
    );
    const ids = [(await h.next()).id, (await h.next()).id, (await h.next()).id].sort();
    assert.deepEqual(ids, [1, 2, 3]);
  });

  it('answers a batch with an array and an empty batch with -32600', async () => {
    const h = harness();
    h.input.write(`${JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'nope' }])}\n`);
    const batch = await h.next();
    assert.ok(Array.isArray(batch));
    assert.deepEqual(batch.map((/** @type {any} */ r) => r.id), [1, 2]);
    assert.equal(batch[1].error.code, -32601);
    h.input.write('[]\n');
    assert.equal((await h.next()).error.code, -32600);
  });

  it('sends no response for a request the client cancelled', async () => {
    /** @type {(value: unknown) => void} */
    let release = () => {};
    const slow = {
      name: 'slow',
      title: 'Slow',
      description: 'Waits.',
      inputSchema: { type: /** @type {const} */ ('object') },
      handler: () => new Promise((resolve) => { release = resolve; }),
    };
    const h = harness([slow]);
    h.send(call('s1', 'slow', {}));
    await tick();
    h.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 's1', reason: 'user' } });
    await tick();
    release({ done: true });
    const response = await h.request({ jsonrpc: '2.0', id: 'p', method: 'ping' });
    assert.equal(response.id, 'p');
    await tick();
    assert.equal(h.raw.length, 1);
  });

  it('writes only newline-terminated JSON-RPC messages to the output', async () => {
    const h = harness();
    await h.request(call(1, 'crash', {}));
    await h.request({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: META } });
    for (const line of h.raw) {
      assert.equal(line.includes('\n'), false);
      assert.equal(JSON.parse(line).jsonrpc, '2.0');
    }
  });

  it('finishes in-flight requests when the input ends, and close() resolves', async () => {
    /** @type {(value: unknown) => void} */
    let release = () => {};
    const slow = {
      name: 'slow',
      title: 'Slow',
      description: 'Waits.',
      inputSchema: { type: /** @type {const} */ ('object') },
      handler: () => new Promise((resolve) => { release = resolve; }),
    };
    const h = harness([slow]);
    h.send(call(1, 'slow', {}));
    await tick();
    h.input.end();
    const closed = h.server.close();
    release({ ok: true });
    await closed;
    assert.equal(h.queue.length, 1);
    assert.equal(/** @type {any} */ (h.queue[0]).result.content[0].text, '{"ok":true}');
  });
});

describe('createStdioServer configuration', () => {
  const base = { name: 'x', version: '1', input: new PassThrough(), output: new PassThrough() };
  const handler = async () => ({});

  it('rejects schemas outside the supported subset', () => {
    assert.throws(
      () => createStdioServer({ ...base, tools: [{ name: 'a', title: 'A', description: 'd', inputSchema: /** @type {any} */ ({ type: 'object', properties: { u: { type: 'string', format: 'uri' } } }), handler }] }),
      /unsupported keyword "format"/,
    );
    assert.throws(
      () => createStdioServer({ ...base, tools: [{ name: 'a', title: 'A', description: 'd', inputSchema: /** @type {any} */ ({ type: 'string' }), handler }] }),
      /type "object"/,
    );
  });

  it('rejects duplicate and invalid tool names', () => {
    const tool = { name: 'a', title: 'A', description: 'd', inputSchema: /** @type {const} */ ({ type: 'object' }), handler };
    assert.throws(() => createStdioServer({ ...base, tools: [tool, tool] }), /Duplicate/);
    assert.throws(() => createStdioServer({ ...base, tools: [{ ...tool, name: 'has space' }] }), /Invalid tool name/);
  });
});
