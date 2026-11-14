import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makeCrawl, makeLink } from '../../helpers/factories.js';
import { audit, counts, findingsFor, sharedPage } from './support.js';

/** @param {string} url @param {object} [overrides] */
const external = (url, overrides = {}) => makeLink({ href: url, url, internal: false, text: 'Profile', ...overrides });
/** @param {object[]} profiles */
const orgBlock = (profiles) => ({ valid: true, types: profiles.map((/** @type {any} */ p) => p.type), error: null, line: 3, videos: [], profiles });

test('smo.robots.preview_bot_blocked fails when robots.txt keeps facebookexternalhit off the start page', () => {
  const blocked = audit([sharedPage('/')], { crawl: { preview_agents: { facebookexternalhit: false } } });
  assert.deepEqual(counts(blocked, 'smo.robots.preview_bot_blocked'), [1, 1]);
  const [finding] = findingsFor(blocked, 'smo.robots.preview_bot_blocked');
  assert.deepEqual([finding.url, finding.selector, finding.severity, finding.weight], [`${SITE}/`, 'facebookexternalhit', 'high', 4]);
  assert.deepEqual(finding.evidence.observed, { crawler: 'facebookexternalhit', allowed: false, robots_txt: `${SITE}/robots.txt` });
  assert.deepEqual(counts(audit([sharedPage('/')], { crawl: { preview_agents: { facebookexternalhit: true } } }), 'smo.robots.preview_bot_blocked'), [1, 0]);
});

test('smo.robots.preview_bot_blocked has no unit for a crawl that did not record it, and needs a readable robots.txt', () => {
  assert.deepEqual(counts(audit([sharedPage('/')]), 'smo.robots.preview_bot_blocked'), [0, 0], 'a crawl made before 0.1.9');
  const missing = audit([sharedPage('/')], { crawl: { preview_agents: { facebookexternalhit: true }, robots: { ...makeCrawl().robots, status: 'missing' } } });
  assert.equal(missing.checks.find((stat) => stat.id === 'smo.robots.preview_bot_blocked')?.status, 'skipped');
});

test('smo.profiles.sameas_missing (info) fails Organization markup without sameAs when the pages link to social profiles', () => {
  const links = [external('https://www.linkedin.com/company/acme'), external('https://www.facebook.com/sharer/sharer.php?u=x'), external('https://x.com/')];
  const without = audit([sharedPage('/', { jsonld: [orgBlock([{ type: 'Organization', same_as: 0 }])], links })]);
  assert.deepEqual(counts(without, 'smo.profiles.sameas_missing'), [1, 1]);
  const [finding] = findingsFor(without, 'smo.profiles.sameas_missing');
  assert.deepEqual(finding.evidence.observed, { types: ['Organization'], profile_links: ['https://www.linkedin.com/company/acme'] }, 'a share endpoint and a home page are not profiles');
  assert.equal(finding.weight, 0);
  const withSameAs = audit([sharedPage('/', { jsonld: [orgBlock([{ type: 'Organization', same_as: 2 }])], links })]);
  assert.deepEqual(counts(withSameAs, 'smo.profiles.sameas_missing'), [1, 0]);
});

test('smo.profiles.sameas_missing has no unit without organisation markup, without profile links, or for a hidden link', () => {
  const org = [orgBlock([{ type: 'Organization', same_as: 0 }])];
  assert.deepEqual(counts(audit([sharedPage('/', { jsonld: org })]), 'smo.profiles.sameas_missing'), [0, 0]);
  assert.deepEqual(counts(audit([sharedPage('/', { links: [external('https://www.linkedin.com/company/acme')] })]), 'smo.profiles.sameas_missing'), [0, 0]);
  assert.deepEqual(counts(audit([sharedPage('/', { jsonld: org, links: [external('https://www.linkedin.com/company/acme', { aria_hidden: true })] })]), 'smo.profiles.sameas_missing'), [0, 0]);
  const oldBlock = { valid: true, types: ['Organization'], error: null, line: 1, videos: [] };
  assert.deepEqual(counts(audit([sharedPage('/', { jsonld: [oldBlock], links: [external('https://www.linkedin.com/company/acme')] })]), 'smo.profiles.sameas_missing'), [0, 0], 'a record made before 0.1.9');
});

test('smo.profiles.rel_me_missing (info) fails a fediverse profile that no page links to with rel="me"', () => {
  const social = (/** @type {string[]} */ relMe) => ({ outside_head: [], streamed: false, head_end: { bytes: 1, by: 'head' }, app_banners: [], rel_me: relMe });
  const result = audit([
    sharedPage('/b', { links: [external('https://mastodon.social/@acme')], social: social([]) }),
    sharedPage('/a', { links: [external('https://mastodon.social/@acme'), external('https://fosstodon.org/@acme'), external('https://medium.com/@acme'), external('https://www.youtube.com/@acme'), external('https://mastodon.social/@acme/123')], social: social([]) }),
    sharedPage('/c', { social: social(['https://fosstodon.org/@acme']) }),
  ]);
  assert.deepEqual(counts(result, 'smo.profiles.rel_me_missing'), [2, 1], 'medium, youtube and a post are not fediverse profiles');
  const [finding] = findingsFor(result, 'smo.profiles.rel_me_missing');
  assert.deepEqual([finding.url, finding.selector, finding.related_urls], [`${SITE}/a`, 'a[href="https://mastodon.social/@acme"]', [`${SITE}/b`]]);
  assert.deepEqual(finding.evidence.observed, { profile: 'https://mastodon.social/@acme', rel_me: false });
});
