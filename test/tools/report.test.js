import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ToolError } from '../../server/src/mcp/stdio.js';
import { createTools } from '../../server/src/tools/index.js';
import { LOGO_MAX_BYTES, detectImageType, hasSvgRoot } from '../../server/src/tools/logo.js';
import { makeDeps, toolNamed } from './fakes.js';

/** @import { Run } from '../../server/src/types.js' */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);
const SVG = Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>');

/** @param {string} runId @returns {Run} */
const makeRun = (runId) => /** @type {Run} */ ({ run_id: runId, findings: [] });

const SECRET_SVG = Buffer.from('AWS_SECRET=abc123\n<svg xmlns="http://www.w3.org/2000/svg"></svg>');

/** @type {string} */
let root;
/** @type {string} */
let dir;
/** @type {string} */
let outside;
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'seekwide-report-'));
  dir = path.join(root, 'project');
  outside = path.join(root, 'elsewhere');
  await mkdir(dir);
  await mkdir(outside);
  await writeFile(path.join(outside, 'logo.png'), PNG);
  await symlink(path.join(outside, 'logo.png'), path.join(dir, 'link.png'));
  await writeFile(path.join(dir, 'secret.svg'), SECRET_SVG);
  await writeFile(path.join(dir, 'svg.txt'), SVG);
  await writeFile(path.join(dir, 'logo.png'), PNG);
  await writeFile(path.join(dir, 'logo.svg'), SVG);
  await writeFile(path.join(dir, 'notes.txt'), 'not an image');
  await writeFile(path.join(dir, 'big.png'), Buffer.concat([PNG, Buffer.alloc(LOGO_MAX_BYTES)]));
});
after(async () => {
  await rm(root, { recursive: true, force: true });
});

/** @param {Parameters<typeof makeDeps>[0]} [seed] */
function setup(seed = {}) {
  const fake = makeDeps({ runs: [makeRun('r1'), makeRun('r2'), makeRun('r3')], projectDir: dir, ...seed });
  return { fake, render: toolNamed(createTools(fake.deps), 'report_render').handler };
}

describe('report_render', () => {
  it('writes both formats into the run folder by default and reports their sizes', async () => {
    const { fake, render } = setup();
    const result = await render({});
    const runDir = path.join(dir, '.seekwide', 'runs', 'r3');
    assert.deepEqual(result.files, { markdown: path.join(runDir, 'report.md'), html: path.join(runDir, 'report.html') });
    assert.equal(await readFile(result.files.markdown, 'utf8'), '# Report r3\n');
    const html = await readFile(result.files.html, 'utf8');
    assert.equal(result.bytes.html, Buffer.byteLength(html));
    assert.equal(result.bytes.html, html.length + 1, 'bytes count UTF-8 bytes');
    assert.equal(result.run_id, 'r3');
    assert.deepEqual(fake.calls.renderMarkdown[0][1], {});
  });

  it('renders only the requested formats', async () => {
    const { fake, render } = setup();
    const result = await render({ formats: ['markdown'], run_id: 'r1' });
    assert.deepEqual(Object.keys(result.files), ['markdown']);
    assert.equal(fake.calls.renderHtml, undefined);
  });

  it('passes summary, recommendations, brand and comparison to the renderers', async () => {
    const { fake, render } = setup();
    await render({
      executive_summary: 'All good.',
      recommendations: [{ title: 'Write more', detail: 'Add guides.' }],
      brand_name: 'Acme Agency',
      compare_to: 'r1',
    });
    const options = /** @type {any} */ (fake.calls.renderHtml[0][1]);
    assert.equal(options.executiveSummary, 'All good.');
    assert.deepEqual(options.recommendations, [{ title: 'Write more', detail: 'Add guides.' }]);
    assert.equal(options.brandName, 'Acme Agency');
    assert.equal(options.comparison.base_run_id, 'r1');
    assert.equal(options.comparison.run_id, 'r3');
  });

  it('compare_to "previous" means the newest run older than the rendered one', async () => {
    const { fake, render } = setup();
    await render({ formats: ['html'], run_id: 'r2', compare_to: 'previous' });
    assert.equal(/** @type {any} */ (fake.calls.renderHtml[0][1]).comparison.base_run_id, 'r1');
    await render({ formats: ['html'], compare_to: 'previous' });
    assert.equal(/** @type {any} */ (fake.calls.renderHtml[1][1]).comparison.base_run_id, 'r2');
    await assert.rejects(render({ run_id: 'r1', compare_to: 'previous' }), (error) =>
      error instanceof ToolError && /No saved run is older than r1.*Leave compare_to out/.test(error.message));
  });

  it('accepts a profile logo only inside the project folder; arguments and settings may point anywhere', async () => {
    const outsideLogo = path.join(outside, 'logo.png');
    const fromProfile = setup({ profile: { report: { logo_path: outsideLogo } } });
    await assert.rejects(fromProfile.render({ formats: ['html'] }), /named by the project profile is outside the project folder/);
    const viaSymlink = setup({ profile: { report: { logo_path: 'link.png' } } });
    await assert.rejects(viaSymlink.render({ formats: ['html'] }), /outside the project folder/);
    const viaDots = setup({ profile: { report: { logo_path: '../elsewhere/logo.png' } } });
    await assert.rejects(viaDots.render({ formats: ['html'] }), /outside the project folder/);

    const fromArgs = setup();
    await fromArgs.render({ formats: ['html'], logo_path: outsideLogo });
    assert.match(/** @type {any} */ (fromArgs.fake.calls.renderHtml[0][1]).logoDataUri, /^data:image\/png;base64,/);
    const fromSettings = setup({ env: { SEEKWIDE_REPORT_LOGO: outsideLogo } });
    await fromSettings.render({ formats: ['html'] });
    assert.match(/** @type {any} */ (fromSettings.fake.calls.renderHtml[0][1]).logoDataUri, /^data:image\/png;base64,/);
  });

  it('refuses a text file that merely contains <svg>, and SVG content without a .svg name', async () => {
    const { render } = setup();
    await assert.rejects(render({ logo_path: 'secret.svg' }), /not a PNG, JPEG, WebP or SVG image/);
    await assert.rejects(render({ logo_path: 'svg.txt' }), /not a PNG, JPEG, WebP or SVG image/);
  });

  it('takes brand and logo from the arguments, then the profile, then the environment', async () => {
    const env = { SEEKWIDE_REPORT_BRAND: 'Env Brand', SEEKWIDE_REPORT_LOGO: path.join(dir, 'logo.svg') };
    const fromEnv = setup({ env });
    await fromEnv.render({ formats: ['html'] });
    let options = /** @type {any} */ (fromEnv.fake.calls.renderHtml[0][1]);
    assert.equal(options.brandName, 'Env Brand');
    assert.match(options.logoDataUri, /^data:image\/svg\+xml;base64,/);

    const fromProfile = setup({ env, profile: { report: { brand_name: 'Profile Brand', logo_path: 'logo.png' } } });
    await fromProfile.render({ formats: ['html'] });
    options = /** @type {any} */ (fromProfile.fake.calls.renderHtml[0][1]);
    assert.equal(options.brandName, 'Profile Brand');
    assert.equal(options.logoDataUri, `data:image/png;base64,${PNG.toString('base64')}`);

    const fromArgs = setup({ env, profile: { report: { brand_name: 'Profile Brand' } } });
    await fromArgs.render({ formats: ['html'], brand_name: 'Arg Brand', logo_path: path.join(dir, 'logo.png') });
    options = /** @type {any} */ (fromArgs.fake.calls.renderHtml[0][1]);
    assert.equal(options.brandName, 'Arg Brand');
  });

  it('ignores unsubstituted environment placeholders', async () => {
    const { fake, render } = setup({ env: { SEEKWIDE_REPORT_BRAND: '${SEEKWIDE_REPORT_BRAND}', SEEKWIDE_REPORT_LOGO: '${user_config.logo}' } });
    await render({ formats: ['html'] });
    assert.deepEqual(fake.calls.renderHtml[0][1], {});
  });

  it('rejects a logo that is missing, too large or not a supported image', async () => {
    const { render } = setup();
    await assert.rejects(render({ logo_path: 'nope.png' }), (error) => error instanceof ToolError && /could not be read/.test(error.message));
    await assert.rejects(render({ logo_path: 'big.png' }), /the limit is 200 KB/);
    await assert.rejects(render({ logo_path: 'notes.txt' }), /not a PNG, JPEG, WebP or SVG image/);
    await assert.rejects(render({ logo_path: '.' }), /is not a file/);
  });

  it('explains a missing run and refuses to compare a run with itself', async () => {
    const { render } = setup();
    await assert.rejects(render({ run_id: 'r7' }), /Run r7 was not found\. Call runs_list/);
    await assert.rejects(render({ compare_to: 'r3' }), /compare_to names the run being rendered/);
    await assert.rejects(render({ compare_to: 'r0' }), /Run r0 was not found/);
    await assert.rejects(render({ compare_to: '../r1' }), /Invalid run id/);
    await assert.rejects(render({ project_dir: 'rel' }), /absolute path/);
  });
});

describe('detectImageType', () => {
  it('recognizes PNG, JPEG and WebP by magic bytes, whatever the name', () => {
    assert.equal(detectImageType(PNG, 'logo.bin'), 'image/png');
    assert.equal(detectImageType(JPEG, 'logo'), 'image/jpeg');
    assert.equal(detectImageType(WEBP, 'logo.svg'), 'image/webp');
  });

  it('recognizes SVG only with a .svg name and an <svg> root', () => {
    assert.equal(detectImageType(SVG, 'logo.svg'), 'image/svg+xml');
    assert.equal(detectImageType(SVG, 'LOGO.SVG'), 'image/svg+xml');
    assert.equal(detectImageType(SVG, 'logo.xml'), null);
    assert.equal(detectImageType(SECRET_SVG, 'logo.svg'), null);
  });

  it('rejects anything else', () => {
    assert.equal(detectImageType(Buffer.from('GIF89a'), 'a.gif'), null);
    assert.equal(detectImageType(Buffer.from('<html><body><svg></svg></body></html>'), 'a.svg'), null);
    assert.equal(detectImageType(Buffer.from([0x3c, 0x73, 0x76, 0x67, 0x20, 0x00]), 'a.svg'), null);
    assert.equal(detectImageType(Buffer.alloc(0), 'a.svg'), null);
  });
});

describe('hasSvgRoot', () => {
  it('allows an XML declaration, comments, a doctype and whitespace before the root', () => {
    assert.equal(hasSvgRoot('<svg/>'), true);
    assert.equal(hasSvgRoot('\uFEFF<?xml version="1.0"?>\n<!-- logo -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n<svg width="1"></svg>'), true);
    assert.equal(hasSvgRoot('<!DOCTYPE svg [ <!ENTITY a "b>c"> ]><svg></svg>'), true);
  });

  it('rejects anything else before or instead of the root', () => {
    assert.equal(hasSvgRoot('AWS_SECRET=abc123\n<svg></svg>'), false);
    assert.equal(hasSvgRoot('<html><svg></svg></html>'), false);
    assert.equal(hasSvgRoot('<svgx></svgx>'), false);
    assert.equal(hasSvgRoot('<?xml version="1.0"'), false);
    assert.equal(hasSvgRoot('<!-- unterminated <svg>'), false);
    assert.equal(hasSvgRoot('<?xml-stylesheet href="a.css"?><svg/>'), false);
  });
});
