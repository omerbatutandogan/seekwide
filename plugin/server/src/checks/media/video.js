/** @import { CheckDef, CheckResult } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { DOCS, MAX_EXAMPLES, MEDIA, counted, isSpoken, mediaPages, pageResults } from './helpers.js';

const REQUIRED = /** @type {const} */ ([['name', 'name'], ['thumbnail_url', 'thumbnailUrl'], ['upload_date', 'uploadDate']]);

/** @type {CheckDef} */
const captionsMissing = {
  ...MEDIA,
  id: 'media.video.captions_missing',
  title: 'Video without captions',
  description:
    'Lists <video> elements that may have sound (not muted, and not autoplaying without controls, which is how background videos are made) and have no <track kind="captions">. Captions let people who cannot hear the audio follow the video. Whether a video has speech cannot be told from the page, and captions burned into the picture or loaded by the player\'s own script cannot be seen in the HTML, so this is informational. Google Search does not rank on captions; this is about accessibility.',
  severity: 'info',
  weight: 0,
  impact: 2,
  effort: 2,
  confidence: 'likely',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.H95,
  recommendation:
    'Add a WebVTT captions file to each video with <track kind="captions" src="…" srclang="…" label="…">, covering speech and other important sounds. A subtitles track holds dialogue only. If the captions are part of the picture, no change is needed.',
  run(ctx) {
    return pageResults(
      mediaPages(ctx),
      (page) => page.videos.filter(isSpoken),
      (video) => !video.tracks.includes('captions'),
      (failing, units) => ({
        line: failing[0].line,
        evidence: {
          observed: {
            without_captions: failing.length,
            videos: units.length,
            examples: failing.slice(0, MAX_EXAMPLES).map((video) => ({ src: video.url === null ? '(no src)' : clip(video.url), tracks: video.tracks.slice(0, MAX_EXAMPLES) })),
          },
          expected: 'A <track kind="captions"> on every video with sound',
          detail: `${failing.length} of ${counted(units.length, 'video', 'videos')} with sound ${failing.length === 1 ? 'has' : 'have'} no captions track${failing[0].tracks.includes('subtitles') ? '; the first has subtitles, which carry dialogue only' : ''}.`,
        },
      }),
      'video',
    );
  },
};

/** @type {CheckDef} */
const structuredDataIncomplete = {
  ...MEDIA,
  id: 'media.video.structured_data_incomplete',
  title: 'VideoObject is missing a required property',
  description:
    'Reads every VideoObject in the JSON-LD of each page, wherever it sits in the block, and reports those without name, thumbnailUrl or uploadDate. Google requires the three and says that without them it may not be able to read anything about the video.',
  severity: 'medium',
  weight: 3,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.VIDEO_STRUCTURED_DATA,
  recommendation:
    'Add the missing properties to the VideoObject: name (the video\'s title), thumbnailUrl (an image Google can fetch) and uploadDate (ISO 8601 with a time zone), then test the page with the Rich Results Test.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of mediaPages(ctx)) {
      page.jsonld.forEach((block, blockIndex) => {
        if (!block.valid) return;
        (block.videos ?? []).forEach((video, videoIndex) => {
          const selector = `jsonld[${blockIndex + 1}] VideoObject[${videoIndex + 1}]`;
          const missing = REQUIRED.filter(([key]) => !video[key]).map(([, name]) => name);
          if (missing.length === 0) {
            results.push({ status: 'pass', url: page.url, selector });
            return;
          }
          results.push({
            status: 'fail',
            url: page.url,
            selector,
            line: block.line,
            evidence: {
              observed: { missing },
              expected: 'name, thumbnailUrl and uploadDate',
              detail: `A VideoObject in JSON-LD block ${blockIndex + 1} has no ${missing.join(', ')}.`,
            },
          });
        });
      });
    }
    return results;
  },
};

/** Checks of videos. */
export const videoChecks = [captionsMissing, structuredDataIncomplete];
