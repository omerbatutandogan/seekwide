import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checks as mediaChecks } from '../../plugin/server/src/checks/media/index.js';
import { LIMITS } from '../../plugin/server/src/config.js';
import { IMAGE_FILES_FAILED, IMAGE_FILES_NOT_ASKED, IMAGE_FILES_REFUSED, SITE_IMAGES_SKIPPED, collectImageFiles, imageFilesNotes } from '../../plugin/server/src/tools/audit-media.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { makeCrawl, makeImage, makeLink, makePage } from '../helpers/factories.js';
import { jobFor, makeDeps, toolNamed } from './fakes.js';

/** @param {string} url */
const shown = (url) => makeImage({ src: url, url, alt: null });

const crawl = makeCrawl({
  id: 'c-media',
  pages: [
    makePage({ url: 'https://example.test/', images: [shown('https://example.test/a.jpg'), shown('https://cdn.test/b.jpg')] }),
    makePage({ url: 'https://example.test/about', images: [shown('https://example.test/a.jpg')] }),
  ],
});

/** @param {Parameters<typeof makeDeps>[0]} [seed] @param {import('../../plugin/server/src/types.js').CrawlResult} [result] */
function setup(seed = {}, result = crawl) {
  const fake = makeDeps({ jobs: [jobFor(result)], results: [result], ...seed });
  fake.deps.checks = [...fake.deps.checks, ...mediaChecks];
  return { fake, tool: toolNamed(createTools(fake.deps), 'audit_run') };
}

describe('audit_run with the media module', () => {
  it('checks the chosen image files at the crawl\'s pace, scores the module and records what it checked', async () => {
    const { fake, tool } = setup();
    const result = await tool.handler({ job_id: 'c-media', modules: ['media'] });
    assert.deepEqual(fake.calls.checkImageFiles, [[['https://example.test/a.jpg', 'https://cdn.test/b.jpg'], {
      maxImages: LIMITS.maxImageChecks, concurrency: LIMITS.imageCheckConcurrency, perHostDelayMs: 1000, onlyOrigin: null, fetchOptions: {},
    }]]);
    assert.equal(fake.calls.checkExternalLinks, undefined, 'the media module sends no external link check');
    assert.equal(fake.calls.measureVitals, undefined);
    const run = fake.runs[0];
    assert.deepEqual(run.image_files, { images: 2, selected: 2, outcomes: { ok: 2 }, local: false });
    assert.deepEqual(Object.keys(result.modules), ['media']);
    assert.equal(result.modules.media.coverage, 1);
    assert.ok(result.top.some((/** @type {any} */ group) => group.check_id === 'media.image.alt_missing'));
    assert.deepEqual(result.notes.filter((/** @type {string} */ note) => note.includes('image')), ['The pages show 2 distinct images; all 2 were chosen to check, and 2 answered.']);
  });

  it('checks nothing for the other modules, and skips the file checks with the reason when told not to check files', async () => {
    const other = setup();
    await other.tool.handler({ job_id: 'c-media', modules: ['seo'], check_core_web_vitals: false });
    assert.equal(other.fake.calls.checkImageFiles, undefined);
    assert.equal(other.fake.runs[0].image_files, null);

    const off = setup();
    const result = await off.tool.handler({ job_id: 'c-media', modules: ['media'], check_image_files: false });
    assert.equal(off.fake.calls.checkImageFiles, undefined);
    const skipped = result.skipped_checks.map((/** @type {any} */ check) => [check.id, check.reason]);
    assert.deepEqual(skipped.map((/** @type {string[]} */ entry) => entry[0]), ['media.image.broken', 'media.image.large_file', 'media.image.legacy_format', 'media.image.robots_blocked']);
    assert.ok(skipped.every((/** @type {string[]} */ entry) => entry[1] === IMAGE_FILES_NOT_ASKED));
    assert.ok(result.notes.includes(IMAGE_FILES_NOT_ASKED));
  });

  it('a local crawl reaches only its own origin, with loopback allowed for exactly that origin', async () => {
    const local = makeCrawl({
      id: 'c-local',
      site_origin: 'http://localhost:3000',
      site_host: 'localhost:3000',
      start_url: 'http://localhost:3000/',
      options: { max_pages: 25, rate_per_sec: 2, include_subdomains: false, local: true },
      pages: [makePage({ url: 'http://localhost:3000/', images: [shown('http://localhost:3000/a.jpg'), shown('https://cdn.test/b.jpg')] })],
    });
    const { fake, tool } = setup({}, local);
    const result = await tool.handler({ job_id: 'c-local', modules: ['media'] });
    assert.deepEqual(fake.calls.checkImageFiles, [[['http://localhost:3000/a.jpg'], {
      maxImages: LIMITS.maxImageChecks, concurrency: LIMITS.imageCheckConcurrency, perHostDelayMs: 500,
      onlyOrigin: 'http://localhost:3000', fetchOptions: { allowLoopback: 'http://localhost:3000' },
    }]]);
    assert.ok(result.notes.some((/** @type {string} */ note) => note.startsWith('This is a site on this machine, so only images on its own address were checked')));
  });

  it('an error in the file check never fails the audit: the checks that need it are skipped with the reason', async () => {
    const { fake, tool } = setup();
    fake.deps.checkImageFiles = async () => {
      throw new Error('boom');
    };
    const result = await tool.handler({ job_id: 'c-media', modules: ['media'] });
    assert.ok(result.skipped_checks.every((/** @type {any} */ check) => check.reason === IMAGE_FILES_FAILED));
    assert.equal(result.skipped_checks.length, 4);
    assert.equal(fake.runs[0].image_files, null);
  });
});

describe('when the image files are requested (review findings 2 and 3)', () => {
  it('starts the image check only after the external link check is done, so no host gets two requests at once', async () => {
    const withLink = makeCrawl({
      id: 'c-both',
      pages: [makePage({ url: 'https://example.test/', links: [makeLink({ url: 'https://cdn.test/doc.pdf', internal: false })], images: [shown('https://cdn.test/a.png')] })],
    });
    const { fake, tool } = setup({}, withLink);
    /** @type {string[]} */
    const order = [];
    fake.deps.checkExternalLinks = async (urls) => {
      order.push('links start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('links end');
      return new Map(urls.map((url) => [url, { url, status: 200, outcome: 'ok', reason: null, final_url: url }]));
    };
    const images = fake.deps.checkImageFiles;
    fake.deps.checkImageFiles = async (urls, options) => {
      order.push('images start');
      return images(urls, options);
    };
    await tool.handler({ job_id: 'c-both', modules: ['links', 'media'] });
    assert.deepEqual(order, ['links start', 'links end', 'images start']);
  });

  it('requests nothing when the crawl was stopped by a bot challenge or rate limiting', async () => {
    for (const reason of ['bot_challenge', 'rate_limited']) {
      const blocked = makeCrawl({ ...crawl, id: `c-${reason}`, blocked: { reason, url: 'https://example.test/x', status: 429 } });
      const { fake, tool } = setup({}, blocked);
      const result = await tool.handler({ job_id: `c-${reason}`, modules: ['media'] });
      assert.equal(fake.calls.checkImageFiles, undefined, reason);
      assert.ok(result.notes.includes(IMAGE_FILES_REFUSED));
    }
  });

  it('requests no image on the site\'s own host when some pages were refused, and says so', async () => {
    const refused = makeCrawl({
      ...crawl,
      id: 'c-refused',
      pages: [...crawl.pages, makePage({ url: 'https://example.test/limited', status: 429, fetch_error: 'rate_limited', is_html: false })],
    });
    const { fake, tool } = setup({}, refused);
    const result = await tool.handler({ job_id: 'c-refused', modules: ['media'] });
    assert.deepEqual(fake.calls.checkImageFiles[0][0], ['https://cdn.test/b.jpg']);
    assert.ok(result.notes.includes(SITE_IMAGES_SKIPPED));
    assert.equal(fake.runs[0].image_files.site_skipped, true);
  });
});

describe('collectImageFiles and its notes', () => {
  it('asks for nothing when the module was not requested, and checks no file when the pages show none', async () => {
    const fake = makeDeps();
    assert.deepEqual(await collectImageFiles(fake.deps, crawl, { requested: false, check: true }), { files: null, summary: null, reason: undefined });
    const empty = await collectImageFiles(fake.deps, makeCrawl({ pages: [makePage()] }), { requested: true, check: true });
    assert.equal(fake.calls.checkImageFiles, undefined);
    assert.deepEqual(empty.summary, { images: 0, selected: 0, outcomes: {}, local: false });
    assert.deepEqual(imageFilesNotes(empty), []);
  });

  it('says how many images were chosen, how many answered, and why the others did not (review finding 7)', () => {
    const summary = { images: 120, selected: 50, outcomes: { ok: 39, broken: 1, unverifiable: 5, disallowed: 3, not_checked: 2 }, local: false };
    assert.deepEqual(imageFilesNotes({ files: new Map(), summary, reason: undefined }), [
      'The pages show 120 distinct images; 50 of them were chosen to check, page by page in crawl order, and 40 answered. Of the others, 5 could not be verified (refused, unreachable, or robots.txt could not be read), 3 were not requested because robots.txt does not allow it, 2 were not reached within 90 seconds.',
    ]);
    assert.deepEqual(imageFilesNotes({ files: new Map(), summary: { images: 10, selected: 10, outcomes: { disallowed: 10 }, local: false }, reason: undefined }), [
      'The pages show 10 distinct images; all 10 were chosen to check, and 0 answered. Of the others, 10 were not requested because robots.txt does not allow it.',
    ]);
    assert.deepEqual(imageFilesNotes({ files: new Map(), summary: { images: 341, selected: 1, outcomes: { ok: 1 }, local: false }, reason: undefined }), [
      'The pages show 341 distinct images; 1 of them was chosen to check, page by page in crawl order, and 1 answered.',
    ]);
    assert.deepEqual(imageFilesNotes({ files: new Map(), summary: { images: 1, selected: 1, outcomes: { ok: 1 }, local: false }, reason: undefined }), [
      'The pages show 1 distinct image; it was chosen to check, and 1 answered.',
    ]);
  });
});
