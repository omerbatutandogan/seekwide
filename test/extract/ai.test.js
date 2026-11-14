import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractPage, unreadableRecord } from '../../plugin/server/src/extract/page.js';
import { parseBingRobots, parseXRobots } from '../../plugin/server/src/extract/headers.js';
import { PAGE_URL, makeFetch, makeInput } from './fetch-result.js';

/** @param {string} body @param {string} [head] @param {Partial<import('../../plugin/server/src/types.js').FetchResult>} [overrides] */
const extract = (body, head = '', overrides = {}) => extractPage(makeInput(makeFetch({ html: `<!doctype html><html><head><title>T</title>${head}</head><body>${body}</body></html>`, ...overrides })));

test('Bing\'s directives come from the robots and bingbot meta tags and the X-Robots-Tag lines for every crawler or for bingbot', () => {
  const record = extract('<p>Text</p>', '<meta name="Bingbot" content="ai-training:disallow, noarchive"><meta name="robots" content="max-snippet:20"><meta name="googlebot" content="nocache">', {
    headers: { 'content-type': 'text/html' },
    headerLines: { 'x-robots-tag': ['bingbot: ai-grounding:disallowextended', 'googlebot: noarchive', 'nosnippet'] },
  });
  assert.deepEqual(record.ai?.bingbot, ['ai-training:disallow', 'noarchive', 'max-snippet:20', 'ai-grounding:disallowextended', 'nosnippet']);
  // Bingbot lines stay out of x_robots, and ai-training: is a directive, not a user agent, for Bing and in the Google reading.
  assert.deepEqual(record.x_robots, ['noarchive', 'nosnippet']);
  assert.deepEqual(parseBingRobots(['ai-training:disallow']), ['ai-training:disallow']);
  assert.deepEqual(parseXRobots(['ai-training:disallow']), ['ai-training:disallow']);
});

test('data-nosnippet: the elements, the visible words inside them, and whether the first h1 is one of them', () => {
  const marked = extract('<div data-nosnippet><h1>Main title</h1><p>one two three four</p></div><p>five six</p><span data-nosnippet>seven</span><p data-nosnippet>eight</p><script>var hidden = "words";</script>');
  // Google honours data-nosnippet on span, div and section only: the <p> is not counted.
  assert.deepEqual([marked.ai?.nosnippet_elements, marked.ai?.nosnippet_words, marked.ai?.nosnippet_h1], [2, 7, true]);
  assert.equal(marked.word_count, 10);
  const plain = extract('<h1>Title</h1><p>Text</p>');
  assert.deepEqual([plain.ai?.nosnippet_elements, plain.ai?.nosnippet_words, plain.ai?.nosnippet_h1], [0, 0, false]);
  assert.equal(extract('<p>No heading</p>').ai?.nosnippet_h1, null);
  assert.equal(extract('<h1 data-nosnippet="">Title</h1>').ai?.nosnippet_h1, false, 'not an element Google honours it on');
  assert.equal(extract('<section data-nosnippet=""><h1>Title</h1></section>').ai?.nosnippet_h1, true);
});

test('scripts in the body and an empty application mount element', () => {
  const shell = extract('<div id="root"><!-- app --> </div><noscript>Enable JavaScript</noscript><script src="/a.js"></script><script>start()</script>', '<script src="/head.js"></script>');
  assert.deepEqual([shell.ai?.body_scripts, shell.ai?.empty_mount, shell.word_count], [2, 'root', 0]);
  const rendered = extract('<div id="__next"><main><h1>Rendered</h1></main></div><script src="/a.js"></script>');
  assert.deepEqual([rendered.ai?.body_scripts, rendered.ai?.empty_mount], [1, null]);
  assert.equal(extract('<div id="other"></div>').ai?.empty_mount, null);
});

test('a record that is not html has an empty AI record, apart from the header directives', () => {
  const record = extractPage(makeInput(makeFetch({ body: Buffer.from('%PDF'), headers: { 'content-type': 'application/pdf' }, headerLines: { 'x-robots-tag': ['noarchive'] } })));
  assert.deepEqual(record.ai, { bingbot: ['noarchive'], nosnippet_elements: 0, nosnippet_words: 0, nosnippet_h1: null, body_scripts: 0, empty_mount: null });
});

test('a refused page keeps the headers that name the CDN, and no content', () => {
  const record = unreadableRecord({ url: PAGE_URL, status: 403, fetchError: 'bot_challenge', depth: 0, discoveredVia: ['link'], headers: { 'cf-ray': '8a1b-FRA', server: 'cloudflare', 'set-cookie': 'x=1' } });
  assert.deepEqual(record.headers, { 'cf-ray': '8a1b-FRA', server: 'cloudflare' });
  assert.deepEqual([record.titles, record.word_count, record.indexability.reasons], [[], 0, ['fetch_error']]);
  assert.deepEqual(unreadableRecord({ url: PAGE_URL, status: 429, fetchError: 'rate_limited', depth: 0, discoveredVia: ['link'] }).headers, {});
});

test('unclearXRobots: the rules after Bing\'s AI directive given with no user agent, which Google documents nothing for', async () => {
  const { unclearXRobots } = await import('../../plugin/server/src/extract/headers.js');
  assert.deepEqual(unclearXRobots(['ai-training:disallow, noindex']), ['noindex']);
  assert.deepEqual(unclearXRobots(['max-snippet:20, ai-grounding:disallow, nosnippet']), ['nosnippet']);
  assert.deepEqual(unclearXRobots(['noindex, ai-training:disallow']), [], 'the rule comes first');
  assert.deepEqual(unclearXRobots(['bingbot: ai-training:disallow, noindex']), [], 'scoped to bingbot');
  assert.deepEqual(unclearXRobots(['noindex', 'ai-training:disallow, nofollow']), ['nofollow'], 'a noindex on another line is clear');
  assert.deepEqual(unclearXRobots(['ai-training:disallow, otherbot: noindex']), [], 'a user agent after it scopes the rest');
  assert.deepEqual(parseXRobots(['ai-training:disallow, noindex']), ['ai-training:disallow', 'noindex']);
});
