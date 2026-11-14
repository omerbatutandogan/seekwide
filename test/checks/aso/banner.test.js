import assert from 'node:assert/strict';
import { test } from 'node:test';

import { namesApp } from '../../../plugin/server/src/checks/aso/banner.js';
import { SITE, makePage } from '../../helpers/factories.js';
import { audit, counts, findingsFor } from './support.js';

/** @param {string} path @param {{content: string, in_head: boolean, line: number|null}[]} banners @param {boolean} [streamed] */
const page = (path, banners, streamed = false) => makePage({
  url: `${SITE}${path}`, social: { outside_head: [], streamed, head_end: { bytes: 1, by: 'head' }, app_banners: banners, rel_me: [] },
});

test('an app-id must be the numeric Apple ID, among the comma-separated parameters', () => {
  for (const content of ['app-id=123456789', ' app-argument=https://x.test/a, APP-ID = 42 ']) assert.ok(namesApp({ content, in_head: true, line: 1 }), content);
  for (const content of ['', 'app-id=', 'app-id=myAppStoreID', 'app-id=id123', 'appid=123', 'app-argument=https://x.test/?app-id=1']) {
    assert.ok(!namesApp({ content, in_head: true, line: 1 }), content);
  }
});

test('aso.banner.app_id_invalid fails a page whose Smart App Banner names no app, on the line of that tag', () => {
  const result = audit({ pages: [
    page('/ok', [{ content: 'app-id=284882215', in_head: true, line: 4 }]),
    page('/bad', [{ content: 'app-id=284882215', in_head: true, line: 4 }, { content: 'app-id=YOUR_APP_ID', in_head: true, line: 5 }]),
    page('/none', []),
    makePage({ url: `${SITE}/old`, social: undefined }),
  ] });
  assert.deepEqual(counts(result, 'aso.banner.app_id_invalid'), [2, 1], 'pages without the tag, or made before 0.1.9, are not units');
  const [finding] = findingsFor(result, 'aso.banner.app_id_invalid');
  assert.deepEqual([finding.url, finding.selector, finding.line, finding.weight], [`${SITE}/bad`, 'meta[name="apple-itunes-app"]', 5, 3]);
  assert.deepEqual(finding.evidence.observed, { content: 'app-id=YOUR_APP_ID' });
});

test('aso.banner.outside_head fails a page with no Smart App Banner tag in the head, says when it was streamed, and is likely', () => {
  const result = audit({ pages: [
    page('/head', [{ content: 'app-id=1', in_head: true, line: 3 }, { content: 'app-id=1', in_head: false, line: 30 }]),
    page('/body', [{ content: 'app-id=1', in_head: false, line: 30 }]),
    page('/streamed', [{ content: 'app-id=1', in_head: false, line: 9 }], true),
  ] });
  assert.deepEqual(counts(result, 'aso.banner.outside_head'), [3, 2]);
  const [body, streamed] = findingsFor(result, 'aso.banner.outside_head');
  assert.deepEqual([body.line, body.confidence, body.weight], [30, 'likely', 1]);
  assert.match(streamed.evidence.detail ?? '', /streaming metadata/);
});
