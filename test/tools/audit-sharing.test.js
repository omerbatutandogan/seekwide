// audit_run with the smo and aso modules: what is requested, what the run
// stores and what the notes say (rule set 0.1.9).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { allChecks } from '../../plugin/server/src/checks/registry.js';
import { LIMITS } from '../../plugin/server/src/config.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { storedRunProblem } from '../../plugin/server/src/store/run-validate.js';
import {
  APPS_NO_SITE_URL, APPS_OTHER_SITE, APP_FILES_LOCAL, APP_FILES_NOT_ASKED, PROFILE_UNREADABLE, SOCIAL_IMAGES_FAILED, SOCIAL_IMAGES_NOT_ASKED, appsFor,
  notRequestedNotes, notRequestedSummary,
} from '../../plugin/server/src/tools/audit-sharing.js';
import { crawlIdentity } from '../../plugin/server/src/util/site-identity.js';
import { SOCIAL_PLATFORM_DOMAINS } from '../../plugin/server/src/util/off-limits.js';
import { makeCrawl, makeLink, makePage } from '../helpers/factories.js';
import { jobFor, makeDeps, toolNamed } from './fakes.js';

const SITE = 'https://example.test';
const OG = { title: 'T', type: 'website', description: 'D', 'image:width': '1200', 'image:height': '630', 'image:alt': 'A' };

/** @param {Partial<import('../../plugin/server/src/types.js').CrawlResult>} [overrides] @param {Parameters<typeof makeDeps>[0]} [seed] */
function setup(overrides = {}, seed = {}) {
  const crawl = makeCrawl({
    id: 'c-1',
    pages: [
      makePage({
        url: `${SITE}/`, og: { ...OG, url: `${SITE}/`, image: `${SITE}/share.png` },
        links: [
          makeLink({ url: 'https://other.test/a', internal: false }),
          makeLink({ url: 'https://play.google.com/store/apps/details?id=com.example', internal: false }),
          makeLink({ url: 'https://www.facebook.com/acme', internal: false }),
        ],
      }),
      makePage({ url: `${SITE}/b`, og: { ...OG, url: `${SITE}/b`, image: 'https://scontent.xx.fbcdn.net/b.jpg' }, depth: 1 }),
    ],
    ...overrides,
  });
  const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl], ...seed });
  fake.deps.checks = allChecks();
  return { crawl, fake, run: (/** @type {object} */ args = {}) => toolNamed(createTools(fake.deps), 'audit_run').handler({ job_id: 'c-1', ...args }) };
}

describe('audit_run with the smo and aso modules', () => {
  it('reads the first 64 KiB of each sharing image and the two app files, and stores what it found, never a file body', async () => {
    const { fake, run } = setup({}, { profile: { site_url: SITE, brand: { name: 'Acme' }, apps: { ios: { app_ids: ['ABCDE12345.com.example.app'], universal_links: true } } } });
    const result = await run({ modules: ['smo', 'aso'] });
    const [[urls, options]] = /** @type {any[]} */ (fake.calls.checkImageFiles);
    assert.deepEqual(urls, [`${SITE}/share.png`], 'an image on a social platform is not asked for');
    assert.equal(options.readBytes, LIMITS.socialImageReadBytes);
    assert.equal(options.maxImages, LIMITS.maxSocialImageChecks);
    assert.deepEqual(/** @type {any[]} */ (fake.calls.fetchAppFiles).map(([origin]) => origin), [SITE]);
    assert.equal(fake.calls.checkExternalLinks, undefined, 'the links module was not asked for');
    const saved = fake.runs[0];
    assert.deepEqual(saved.social_images, { images: 2, selected: 1, outcomes: { ok: 1 }, sized: 0, local: false });
    assert.deepEqual(saved.app_files, {
      aasa: { url: `${SITE}/.well-known/apple-app-site-association`, outcome: 'not_found', status: 404 },
      assetlinks: { url: `${SITE}/.well-known/assetlinks.json`, outcome: 'not_found', status: 404 },
    });
    assert.ok(!JSON.stringify(saved).includes('"body"'));
    assert.deepEqual(saved.not_requested, { links: 0, images: 0, social_images: 1, hosts: ['fbcdn.net'] }, 'the platform\'s domain, not the host the page wrote');
    assert.deepEqual(saved.findings.filter((finding) => finding.check_id === 'aso.aasa.missing').map((finding) => finding.url), [`${SITE}/.well-known/apple-app-site-association`]);
    assert.ok(result.notes.includes('The pages give 2 distinct sharing images; 1 was chosen for the check, 1 answered and the pixel size of 0 was read from the file.'));
    assert.ok(result.notes.some((/** @type {string} */ note) => note.startsWith('Not checked, by rule: 1 sharing image on Google Play or social platforms (fbcdn.net)')));
    assert.ok(!result.notes.some((/** @type {string} */ note) => note.startsWith('App association files:')), 'two missing files need no note');
  });

  it('leaves links to Google Play and social platforms out of the external link check and lists them as not checked, by rule', async () => {
    const { fake, run } = setup();
    const result = await run({ modules: ['links', 'media', 'smo'] });
    const [[urls]] = /** @type {any[]} */ (fake.calls.checkExternalLinks);
    assert.deepEqual(urls, ['https://other.test/a']);
    assert.deepEqual(fake.runs[0].not_requested, { links: 2, images: 0, social_images: 1, hosts: ['facebook.com', 'fbcdn.net', 'play.google.com'] });
    assert.ok(result.notes.includes('Not checked, by rule: 2 external links, 1 sharing image on Google Play or social platforms (facebook.com, fbcdn.net, play.google.com). Seekwide never sends a request there.'));
  });

  it('says why when the requests were switched off, the site is local, or the profile cannot be read', async () => {
    const off = setup();
    const result = await off.run({ modules: ['smo', 'aso'], check_social_images: false, check_app_files: false });
    assert.equal(off.fake.calls.checkImageFiles, undefined);
    assert.equal(off.fake.calls.fetchAppFiles, undefined);
    assert.ok(result.notes.includes(SOCIAL_IMAGES_NOT_ASKED) && result.notes.includes(APP_FILES_NOT_ASKED));
    assert.equal(result.skipped_checks.find((/** @type {any} */ check) => check.id === 'aso.aasa.invalid')?.reason, APP_FILES_NOT_ASKED);

    const local = setup({ site_origin: 'http://localhost:3000', start_url: 'http://localhost:3000/', options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true } });
    const localResult = await local.run({ modules: ['aso'] });
    assert.equal(local.fake.calls.fetchAppFiles, undefined);
    assert.ok(localResult.notes.includes(APP_FILES_LOCAL));

    const broken = setup();
    broken.fake.deps.readProfile = async () => { throw new Error('damaged'); };
    const brokenResult = await broken.run({ modules: ['aso'] });
    assert.ok(brokenResult.notes.includes(PROFILE_UNREADABLE));
    assert.equal(/** @type {any[]} */ (broken.fake.calls.fetchAppFiles).length, 1, 'the files are still read');
  });

  it('a site that refused the crawler gets no further request, and an internal error is contained', async () => {
    const refused = setup({ blocked: { reason: 'bot_challenge', url: `${SITE}/`, status: 403 } });
    const result = await refused.run({ modules: ['smo', 'aso'] });
    assert.equal(refused.fake.calls.checkImageFiles, undefined);
    assert.equal(refused.fake.calls.fetchAppFiles, undefined);
    assert.ok(result.notes.some((/** @type {string} */ note) => note.startsWith('Sharing images were not checked: the site refused the crawler')));

    const failing = setup();
    failing.fake.deps.checkImageFiles = async () => { throw new Error('boom'); };
    const failed = await failing.run({ modules: ['smo'] });
    assert.ok(failed.notes.includes(SOCIAL_IMAGES_FAILED));
    assert.equal(failing.fake.runs.length, 1, 'the audit is saved');
  });

  it('the not-requested summary is null when nothing was left out, and names at most twenty hosts', () => {
    assert.equal(notRequestedSummary({ links: [], images: [], socialImages: [] }), null);
    assert.deepEqual(notRequestedNotes(null), []);
    const many = SOCIAL_PLATFORM_DOMAINS.slice(0, 30).map((domain) => `https://www.${domain}/x`);
    const summary = notRequestedSummary({ links: many, images: ['https://i.ytimg.com/a.jpg'], socialImages: [] });
    assert.equal(summary?.links, 30);
    assert.equal(summary?.hosts.length, 20);
    assert.match(notRequestedNotes(summary)[0], /^Not checked, by rule: 30 external links, 1 image file on Google Play or social platforms \(cdninstagram\.com, /);
  });
});

describe('what the review of batch 1 found in audit_run', () => {
  it('a page that links to a platform host no stored run accepts is still audited and saved, naming the platform (D3)', async () => {
    const crawl = makeCrawl({ id: 'c-1', pages: [makePage({ url: `${SITE}/`, links: [makeLink({ url: 'https://a_b.facebook.com/x', internal: false }), makeLink({ url: `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(50)}.youtube.com/x`, internal: false })] })] });
    const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
    fake.deps.checks = allChecks();
    await toolNamed(createTools(fake.deps), 'audit_run').handler({ job_id: 'c-1', modules: ['links'] });
    assert.deepEqual(fake.runs[0].not_requested, { links: 2, images: 0, social_images: 0, hosts: ['facebook.com', 'youtube.com'] });
    assert.equal(storedRunProblem(/** @type {any} */ (fake.runs[0])), null);
  });

  it('the profile\'s apps judge only the site its site_url names (D5)', async () => {
    const apps = { ios: { app_ids: ['ABCDE12345.com.mine.app'], universal_links: true }, android: { packages: ['com.mine.app'], app_links: true } };
    const other = setup({}, { profile: { site_url: 'https://my-own-site.example', brand: { name: 'Mine' }, apps } });
    const otherResult = await other.run({ modules: ['aso'] });
    assert.ok(otherResult.notes.includes(APPS_OTHER_SITE));
    assert.deepEqual(other.fake.runs[0].findings.filter((finding) => finding.check_id.endsWith('.missing')), []);
    const own = setup({}, { profile: { site_url: 'https://www.example.test', brand: { name: 'Mine' }, apps } });
    const ownResult = await own.run({ modules: ['aso'] });
    assert.ok(!ownResult.notes.includes(APPS_OTHER_SITE));
    assert.deepEqual(own.fake.runs[0].findings.filter((finding) => finding.check_id.endsWith('.missing')).map((finding) => finding.check_id).sort(), ['aso.aasa.missing', 'aso.assetlinks.missing']);
    assert.deepEqual(appsFor(/** @type {any} */ ({ apps }), crawlIdentity(makeCrawl())), { apps: {}, note: APPS_NO_SITE_URL });
    assert.deepEqual(appsFor(null, crawlIdentity(makeCrawl())), { apps: {}, note: null });
  });

  it('app-file redirects are followed only where the crawl would go: the site\'s host, on its port', async () => {
    const { fake, run } = setup();
    await run({ modules: ['aso'] });
    const [[, options]] = /** @type {any[]} */ (fake.calls.fetchAppFiles);
    assert.ok(options.sameSite(`${SITE}/.well-known/x`) && options.sameSite('https://www.example.test/x') && options.sameSite('http://example.test/x'));
    for (const url of ['https://example.test:8443/x', 'https://cdn.example.test/x', 'https://example.de/x', 'https://other.test/x']) assert.ok(!options.sameSite(url), url);
  });

  it('says nothing about links not checked by rule when the external link check did not run', async () => {
    const { fake, run } = setup();
    const result = await run({ modules: ['links'], check_outbound_links: false });
    assert.equal(fake.runs[0].not_requested, null);
    assert.ok(!result.notes.some((/** @type {string} */ note) => note.startsWith('Not checked, by rule')));
  });

  it('a local audit chooses only sharing images on its own address, so every one it counts was requested', async () => {
    const local = { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true };
    const crawl = makeCrawl({
      id: 'c-1', site_origin: 'http://localhost:3000', site_host: 'localhost:3000', start_url: 'http://localhost:3000/', options: local,
      pages: [
        makePage({ url: 'http://localhost:3000/', og: { ...OG, image: 'http://localhost:3000/own.png' } }),
        makePage({ url: 'http://localhost:3000/b', og: { ...OG, image: 'https://cdn.example.test/deployed.png' } }),
      ],
    });
    const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
    fake.deps.checks = allChecks();
    const result = await toolNamed(createTools(fake.deps), 'audit_run').handler({ job_id: 'c-1', modules: ['smo'] });
    const [[urls]] = /** @type {any[]} */ (fake.calls.checkImageFiles);
    assert.deepEqual(urls, ['http://localhost:3000/own.png']);
    assert.deepEqual(fake.runs[0].social_images, { images: 2, selected: 1, outcomes: { ok: 1 }, sized: 0, local: true });
    assert.ok(result.notes.includes('The pages give 2 distinct sharing images; 1 was chosen for the check, 1 answered and the pixel size of 0 was read from the file.'));
  });
});
