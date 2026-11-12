import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE } from '../../helpers/factories.js';
import { audit, findingsFor, mediaPage, statFor } from './support.js';

/** @import { JsonLdBlock, VideoRecord } from '../../../server/src/types.js' */

const CAPTIONS = 'media.video.captions_missing';
const INCOMPLETE = 'media.video.structured_data_incomplete';

/** @param {Partial<VideoRecord>} [overrides] @returns {VideoRecord} */
const video = (overrides = {}) => ({
  url: `${SITE}/v.mp4`, muted: false, autoplay: false, controls: true, aria_hidden: false, hidden: false, tracks: [], line: 20, ...overrides,
});
/** @param {JsonLdBlock['videos']} videos @returns {JsonLdBlock} */
const block = (videos) => ({ valid: true, types: ['VideoObject'], error: null, line: 3, videos });
const COMPLETE = { name: true, thumbnail_url: true, upload_date: true };

test(`${CAPTIONS} fails a page with a video that has sound and no captions track, and passes one with captions`, () => {
  const result = audit([
    mediaPage('/', { videos: [video({ tracks: ['subtitles'] })] }),
    mediaPage('/captioned', { videos: [video({ tracks: ['subtitles', 'captions'] })] }),
  ]);
  const stat = statFor(result, CAPTIONS);
  assert.deepEqual([stat.applicable, stat.failed], [2, 1]);
  const [finding] = findingsFor(result, CAPTIONS);
  assert.deepEqual([finding.url, finding.selector, finding.line, finding.confidence, finding.severity], [`${SITE}/`, 'video', 20, 'likely', 'info']);
  assert.deepEqual(finding.evidence.observed, { without_captions: 1, videos: 1, examples: [{ src: `${SITE}/v.mp4`, tracks: ['subtitles'] }] });
  assert.match(finding.evidence.detail ?? '', /subtitles, which carry dialogue only/);
});

test(`${CAPTIONS} leaves out muted, background, hidden and aria-hidden videos`, () => {
  const result = audit([mediaPage('/', {
    videos: [
      video({ muted: true }),
      video({ autoplay: true, controls: false }),
      video({ hidden: true }),
      video({ aria_hidden: true }),
    ],
  })]);
  assert.equal(statFor(result, CAPTIONS).applicable, 0);
  const autoplayWithControls = audit([mediaPage('/', { videos: [video({ autoplay: true, controls: true })] })]);
  assert.equal(statFor(autoplayWithControls, CAPTIONS).failed, 1, 'a video that autoplays with controls can be unmuted');
});

test(`${INCOMPLETE} fails each VideoObject without name, thumbnailUrl or uploadDate, with a selector per block and object`, () => {
  const result = audit([
    mediaPage('/', { jsonld: [block([]), block([COMPLETE, { name: true, thumbnail_url: false, upload_date: false }])] }),
    mediaPage('/invalid', { jsonld: [{ valid: false, types: [], error: 'x', line: 1, videos: [] }] }),
  ]);
  const stat = statFor(result, INCOMPLETE);
  assert.deepEqual([stat.applicable, stat.failed], [2, 1]);
  const [finding] = findingsFor(result, INCOMPLETE);
  assert.deepEqual([finding.selector, finding.line], ['jsonld[2] VideoObject[2]', 3]);
  assert.deepEqual(finding.evidence.observed, { missing: ['thumbnailUrl', 'uploadDate'] });
});
