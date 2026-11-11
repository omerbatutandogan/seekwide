import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseLinkHeaders, parseXRobots, selectHeaders } from '../../server/src/extract/headers.js';
import { extractPage } from '../../server/src/extract/page.js';
import { PAGE_URL, makeFetch, makeInput } from './fetch-result.js';

/**
 * @param {string} name
 * @param {string[]} lines
 * @param {Record<string, string>} [extra]
 */
function withHeaderLines(name, lines, extra = {}) {
  return makeFetch({
    headers: { 'content-type': 'text/html', [name]: lines.join(', '), ...extra },
    headerLines: { [name]: lines },
  });
}

test('X-Robots-Tag: plain directives apply to every crawler', () => {
  assert.deepEqual(parseXRobots(['noindex']), ['noindex']);
  assert.deepEqual(parseXRobots(['NoIndex, NoFollow']), ['noindex', 'nofollow']);
  assert.deepEqual(parseXRobots(['none']), ['none']);
  assert.deepEqual(parseXRobots([]), []);
});

test('X-Robots-Tag: a googlebot prefix is kept, other agents are ignored', () => {
  assert.deepEqual(parseXRobots(['googlebot: noindex']), ['noindex']);
  assert.deepEqual(parseXRobots(['GoogleBot: noindex, nofollow']), ['noindex', 'nofollow']);
  assert.deepEqual(parseXRobots(['otherbot: noindex']), []);
  assert.deepEqual(parseXRobots(['otherbot: noindex, nofollow']), []);
});

test('X-Robots-Tag: value directives are not user agents', () => {
  assert.deepEqual(parseXRobots(['unavailable_after: 25 Jun 2030 15:00:00 PST']), ['unavailable_after: 25 jun 2030 15:00:00 pst']);
  assert.deepEqual(
    parseXRobots(['max-snippet: 20, max-image-preview: large, max-video-preview: -1']),
    ['max-snippet: 20', 'max-image-preview: large', 'max-video-preview: -1'],
  );
  // RFC 850 dates carry a comma; it stays one directive.
  assert.deepEqual(
    parseXRobots(['googlebot: unavailable_after: Wednesday, 03-Nov-2027 15:00:00 PST, noindex']),
    ['unavailable_after: wednesday, 03-nov-2027 15:00:00 pst', 'noindex'],
  );
});

test('X-Robots-Tag: two header lines with different agents are read separately', () => {
  assert.deepEqual(parseXRobots(['otherbot: noindex', 'googlebot: nofollow']), ['nofollow']);
  assert.deepEqual(parseXRobots(['googlebot: noarchive', 'noindex']), ['noarchive', 'noindex']);
  const record = extractPage(makeInput(withHeaderLines('x-robots-tag', ['otherbot: noindex', 'googlebot: nofollow'])));
  assert.deepEqual(record.x_robots, ['nofollow']);
  assert.equal(record.indexability.reasons.includes('noindex_header'), false);
});

test('X-Robots-Tag falls back to the joined header when headerLines is missing', () => {
  const result = makeFetch({ headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' } });
  // @ts-expect-error simulating a result without headerLines
  delete result.headerLines;
  assert.deepEqual(extractPage(makeInput(result)).x_robots, ['noindex']);
});

test('Link header: a canonical is recorded with source header and in_head true', () => {
  const { canonicals } = parseLinkHeaders(['<https://example.test/canon>; rel="canonical"'], PAGE_URL);
  assert.deepEqual(canonicals, [
    { href: 'https://example.test/canon', url: 'https://example.test/canon', source: 'header', in_head: true, line: null },
  ]);
  assert.deepEqual(parseLinkHeaders(['<https://example.test/style.css>; rel=preload; as=style'], PAGE_URL).canonicals, []);
});

test('Link header: several links in one line, relative URLs and hreflang alternates', () => {
  const line = '<https://example.test/de>; rel="alternate"; hreflang="de", </canon?a=1,2>; rel=canonical, <https://cdn.test/x.js>; rel=preload';
  const { canonicals, hreflang } = parseLinkHeaders([line], PAGE_URL);
  assert.deepEqual(canonicals.map((c) => c.url), ['https://example.test/canon?a=1,2']);
  assert.deepEqual(hreflang, [{ hreflang: 'de', href: 'https://example.test/de', url: 'https://example.test/de', source: 'header' }]);
});

test('Link header canonicals from several header lines are merged after HTML canonicals', () => {
  const result = makeFetch({
    html: '<html><head><link rel="canonical" href="/page"></head><body></body></html>',
    headers: { 'content-type': 'text/html', link: '<https://example.test/a>; rel="canonical", <https://example.test/b>; rel="canonical"' },
    headerLines: { link: ['<https://example.test/a>; rel="canonical"', '<https://example.test/b>; rel="canonical"'] },
  });
  const record = extractPage(makeInput(result));
  assert.deepEqual(record.canonicals.map((c) => [c.source, c.url]), [
    ['html', 'https://example.test/page'],
    ['header', 'https://example.test/a'],
    ['header', 'https://example.test/b'],
  ]);
});

test('selectHeaders keeps only the listed headers and clips their values', () => {
  const kept = selectHeaders({ 'content-type': 'text/html', 'set-cookie': 'secret=1', link: `<${'x'.repeat(400)}>` });
  assert.deepEqual(Object.keys(kept), ['content-type', 'link']);
  assert.equal(kept.link.length, 300);
  assert.deepEqual(selectHeaders(undefined), {});
});

test('X-Robots-Tag keeps at most 50 tokens', () => {
  const many = Array.from({ length: 60 }, (_, i) => `t${i}`);
  const tokens = parseXRobots([many.slice(0, 30).join(', '), many.slice(30).join(', ')]);
  assert.equal(tokens.length, 50);
  assert.equal(tokens[49], 't49');
  assert.equal(parseXRobots([many.slice(0, 5).join(', ')]).length, 5);
});
