// Fixes of image markup: width and height for images that do not reserve
// their box, eager loading for the image the page marks as its main one, and
// the pixel size read from the first bytes of the project's own image file.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { buildContext, runChecks } from '../../plugin/server/src/checks/engine.js';
import { allChecks } from '../../plugin/server/src/checks/registry.js';
import { imageFileOf } from '../../plugin/server/src/repo/fix-image.js';
import { FIXABLE_CHECKS, imageFilesToRead, planFixes } from '../../plugin/server/src/repo/fixes.js';
import { readFileHead } from '../../plugin/server/src/repo/scan.js';
import { loadProjectSources } from '../../plugin/server/src/repo/sources.js';
import { verifyFixes } from '../../plugin/server/src/repo/verify.js';
import { compareRuns } from '../../plugin/server/src/store/compare.js';
import { imageSize } from '../../plugin/server/src/util/image-size.js';
import { makeCrawl, makeImage, makePage } from '../helpers/factories.js';
import { makeTree } from '../helpers/repo.js';
import { makeRun } from '../helpers/run-factory.js';

/** @import { Finding, ImageRecord, PageRecord } from '../../plugin/server/src/types.js' */

const SITE = 'https://example.test';
const AT = '2026-11-24T00:00:00.000Z';

/** The first bytes of a PNG file of the given size: the signature and the IHDR chunk. @param {number} width @param {number} height */
function png(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

/** @param {string} src @param {number} line @param {Partial<ImageRecord>} [overrides] */
const unsized = (src, line, overrides = {}) => makeImage({ src, url: new URL(src, SITE).href, width: null, height: null, line, ...overrides });
/** @param {string} src @param {string|null} alt @param {number} line */
const alted = (src, alt, line) => makeImage({ src, url: new URL(src, SITE).href, alt, line });
/** @param {string} path @param {ImageRecord[]} images */
const page = (path, images) => makePage({ url: `${SITE}${path}`, images });

/**
 * Run the checks on a crawl and give each finding the source file of its page, with its line as served.
 * @param {PageRecord[]} pages @param {Record<string, string>} files
 */
function audit(pages, files) {
  const crawl = makeCrawl({ pages });
  const { findings, checks } = runChecks(allChecks(), buildContext(crawl, {}), { detectedAt: AT });
  const withSource = findings.map((finding) => {
    const path = finding.url === null ? null : new URL(finding.url).pathname;
    return path !== null && Object.hasOwn(files, path) ? { ...finding, source: { file: files[path], line: finding.line, route: path } } : finding;
  });
  return { crawl, checks, findings: withSource, run: makeRun({ findings: withSource, site_origin: SITE, start_url: `${SITE}/`, checks }) };
}

describe('image files of the project', () => {
  const html = { isNext: false, files: new Set(['img/photo.png', 'index.html']) };
  const next = { isNext: true, files: new Set(['public/hero.png', 'app/page.jsx']) };

  it('maps an image URL of the audited origin to the file it is served from', () => {
    assert.equal(imageFileOf(`${SITE}/img/photo.png`, SITE, html), 'img/photo.png');
    assert.equal(imageFileOf(`${SITE}/img/photo.png?v=2`, SITE, html), 'img/photo.png');
    assert.equal(imageFileOf(`${SITE}/hero.png`, SITE, next), 'public/hero.png');
    assert.equal(imageFileOf(`${SITE}/_next/image?url=%2Fhero.png&w=640&q=75`, SITE, next), 'public/hero.png');
  });

  it('maps nothing else: another origin, an imported Next.js image, a file the listing lacks, a path that climbs', () => {
    for (const [url, project] of /** @type {const} */ ([
      ['https://cdn.example.net/img/photo.png', html], [`${SITE}/_next/static/media/hero.4f1c.png`, next], [`${SITE}/img/other.png`, html],
      [`${SITE}/img%2F..%2F..%2Fsecret.png`, html], [`${SITE}/_next/image?url=https%3A%2F%2Fcdn.example.net%2Fa.png`, next], [null, html],
    ])) assert.equal(imageFileOf(url, SITE, project), null, String(url));
  });

  it('reads only the first bytes of an image file, whatever its size', async () => {
    const big = Buffer.concat([png(1200, 800), Buffer.alloc(200_000)]);
    const tree = await makeTree({ 'img/photo.png': big });
    try {
      const head = await readFileHead(tree.dir, 'img/photo.png', 64 * 1024);
      assert.equal(head?.length, 64 * 1024);
      assert.deepEqual(imageSize(/** @type {Buffer} */ (head)), { format: 'png', width: 1200, height: 800 });
      assert.equal(await readFileHead(tree.dir, 'img/missing.png', 1024), null);
      await assert.rejects(readFileHead(tree.dir, 'img/photo.png', 0), TypeError);
    } finally {
      await tree.remove();
    }
  });
});

describe('planning image fixes in a plain HTML project', () => {
  /** @type {Awaited<ReturnType<typeof makeTree>>} */
  let tree;
  /** @type {Awaited<ReturnType<typeof loadProjectSources>>} */
  let sources;
  before(async () => {
    tree = await makeTree({ 'index.html': '<!doctype html><title>x</title>', 'img/photo.png': png(1200, 800), 'img/logo.png': png(64, 64) });
    sources = await loadProjectSources(tree.dir);
  });
  after(() => tree.remove());

  it('lists the images without a size, with their lines, their files and the size read from each file', () => {
    const audited = audit([page('/', [unsized('/img/photo.png', 14), unsized('https://cdn.example.net/a.jpg', 20), makeImage({ src: '/img/logo.png', line: 9 })])], { '/': 'index.html' });
    const toRead = imageFilesToRead({ run: audited.run, sources, crawl: audited.crawl });
    assert.deepEqual(toRead, ['img/photo.png']);
    const sizes = new Map([['img/photo.png', { format: /** @type {const} */ ('png'), width: 1200, height: 800 }]]);
    const fix = planFixes({ run: audited.run, sources, crawl: audited.crawl, siteUrl: null, imageSizes: sizes }).fixes.find((entry) => entry.check_id === 'media.image.dimensions_missing');
    assert.deepEqual([fix?.type, fix?.action, fix?.kind, fix?.file, fix?.line], ['image', 'add_size', 'html', 'index.html', 14]);
    assert.deepEqual(fix?.images, [
      { src: '/img/photo.png', line: 14, file: 'img/photo.png', size: { format: 'png', width: 1200, height: 800 } },
      { src: 'https://cdn.example.net/a.jpg', line: 20, file: null, size: null },
    ]);
    assert.match(fix?.how ?? '', /For one image the size is null.*never guess a size/);
    assert.match(fix?.how ?? '', /Look at the CSS for the image first/);
  });

  it('gives no lines when the served page is not the file itself', () => {
    const audited = audit([page('/', [unsized('/img/photo.png', 14)])], {});
    const moved = audited.findings.map((finding) => (finding.url === `${SITE}/` ? { ...finding, source: { file: 'index.html', line: 3, route: '/' } } : finding));
    const fix = planFixes({ run: makeRun({ findings: moved, site_origin: SITE }), sources, crawl: audited.crawl, siteUrl: null }).fixes.find((entry) => entry.type === 'image');
    assert.deepEqual(fix?.images?.map((image) => image.line), [null]);
  });

  it('loads the main image eagerly: the one marked fetchpriority="high" and loading="lazy" at once', () => {
    const audited = audit([page('/', [makeImage({ src: '/img/photo.png', line: 12, fetchpriority: 'high', loading: 'lazy' }), makeImage({ src: '/img/logo.png', line: 30, loading: 'lazy' })])], { '/': 'index.html' });
    const fix = planFixes({ run: audited.run, sources, crawl: audited.crawl, siteUrl: null }).fixes.find((entry) => entry.check_id === 'media.image.lazy_priority');
    assert.deepEqual([fix?.action, fix?.images?.map((image) => [image.src, image.line])], ['load_eagerly', [['/img/photo.png', 12]]]);
    assert.match(fix?.how ?? '', /Remove loading="lazy" from each one/);
  });

  it('alt text: names the project file of each image to look at, and the remote ones that are not to be downloaded', () => {
    const audited = audit([page('/', [alted('/img/photo.png', null, 14), alted('https://cdn.example.net/a.jpg', null, 20), alted('/img/logo.png', '', 9)])], { '/': 'index.html' });
    const fix = planFixes({ run: audited.run, sources, crawl: audited.crawl, siteUrl: null }).fixes.find((entry) => entry.check_id === 'media.image.alt_missing');
    assert.deepEqual([fix?.type, fix?.action, fix?.file, fix?.line], ['image', 'write_alt', 'index.html', 14]);
    // The decorative alt="" is not listed, and an alt fix carries no size.
    assert.deepEqual(fix?.images, [{ src: '/img/photo.png', line: 14, file: 'img/photo.png' }, { src: 'https://cdn.example.net/a.jpg', line: 20, file: null }]);
    assert.match(fix?.how ?? '', /look at the picture itself/);
    assert.match(fix?.how ?? '', /Never write it from the file name/);
    assert.match(fix?.how ?? '', /For one image file is null.*Do not download it/);
    assert.deepEqual(imageFilesToRead({ run: audited.run, sources, crawl: audited.crawl }), []);
  });

  it('alt text: a placeholder alt is listed with the alt the page has, as data', () => {
    const audited = audit([page('/', [alted('/img/photo.png', 'IMG_0423.png', 14), alted('/img/logo.png', 'Seekwide logo', 9)])], { '/': 'index.html' });
    const fix = planFixes({ run: audited.run, sources, crawl: audited.crawl, siteUrl: null }).fixes.find((entry) => entry.check_id === 'media.image.alt_placeholder');
    assert.deepEqual(fix?.images, [{ src: '/img/photo.png', line: 14, file: 'img/photo.png', alt: 'IMG_0423.png' }]);
    assert.doesNotMatch(fix?.how ?? '', /IMG_0423/);
  });

  it('refuses an image fix when the crawl is no longer stored, instead of trusting the stored run', () => {
    const audited = audit([page('/', [unsized('/img/photo.png', 14)])], { '/': 'index.html' });
    const refused = planFixes({ run: audited.run, sources, crawl: null, siteUrl: null }).notFixable.find((entry) => entry.check_id === 'media.image.dimensions_missing');
    assert.match(refused?.reason ?? '', /no longer stored/);
    assert.deepEqual(imageFilesToRead({ run: audited.run, sources, crawl: null }), []);
  });
});

describe('verifying image fixes', () => {
  /** @param {ReturnType<typeof audit>} base @param {PageRecord[]} pages */
  function reaudit(base, pages) {
    const after = audit(pages, {});
    const baseRun = { ...base.run, run_id: 'base' };
    const run = { ...after.run, run_id: 'after' };
    const ids = base.findings.filter((finding) => FIXABLE_CHECKS[finding.check_id]?.type === 'image').map((finding) => finding.id);
    return verifyFixes({ base: baseRun, run, crawl: after.crawl, findingIds: ids, comparison: compareRuns(baseRun, run) }).verification.results;
  }
  const lazyMain = () => makeImage({ src: '/img/photo.png', line: 12, fetchpriority: 'high', loading: 'lazy' });

  it('closed: the main image is no longer lazy-loaded', () => {
    const [result] = reaudit(audit([page('/', [lazyMain()])], {}), [page('/', [makeImage({ src: '/img/photo.png', line: 12, fetchpriority: 'high' })])]);
    assert.deepEqual([result.check_id, result.outcome], ['media.image.lazy_priority', 'closed']);
  });

  it('unverified: the priority hint was removed instead, so the check had no image to look at', () => {
    const [result] = reaudit(audit([page('/', [lazyMain()])], {}), [page('/', [makeImage({ src: '/img/photo.png', line: 12, loading: 'lazy' })])]);
    assert.equal(result.outcome, 'unverified');
    assert.match(result.detail, /no longer has an image this check looks at/);
  });

  it('alt text: closed when the image has alt text, unverified when the image is gone from the page', () => {
    const base = audit([page('/', [alted('/img/photo.png', null, 12)])], {});
    const [closed] = reaudit(base, [page('/', [alted('/img/photo.png', 'A walking tour on a hill in Lisbon', 12)])]);
    assert.deepEqual([closed.check_id, closed.outcome], ['media.image.alt_missing', 'closed']);
    const [gone] = reaudit(base, [page('/', [])]);
    assert.equal(gone.outcome, 'unverified');
  });

  it('the image checks have no unit on a page without an image they look at, which the re-audit relies on', () => {
    const crawl = makeCrawl({ pages: [page('/', [unsized('/a.png', 1), lazyMain(), makeImage({ src: '/b.png', alt: 'photo' })]), page('/none', [])] });
    const { checks } = runChecks(allChecks(), buildContext(crawl, {}), { detectedAt: AT });
    for (const id of Object.keys(FIXABLE_CHECKS).filter((key) => FIXABLE_CHECKS[key].unit === 'image')) {
      assert.equal(checks.find((check) => check.id === id)?.applicable, 1, id);
    }
  });
});
