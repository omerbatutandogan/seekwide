// One table of hosts, run through every part of the plugin that asks whether
// a host is the audited site (code review of 2026-11-12: eight rules that
// disagreed). Each column is a real consumer, called the way the plugin calls
// it; the identity module is the one place their answers come from.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildContext, runChecks } from '../../server/src/checks/engine.js';
import { checks as mediaChecks } from '../../server/src/checks/media/index.js';
import { selectImageFiles } from '../../server/src/checks/media/select.js';
import { allChecks } from '../../server/src/checks/registry.js';
import { extractPage } from '../../server/src/extract/page.js';
import { externalLinkUrls } from '../../server/src/tools/audit.js';
import { crawlKey, isPublicHost, siteIdentity } from '../../server/src/util/site-identity.js';
import { makeFetch, makeInput } from '../extract/fetch-result.js';
import { makeCrawl } from '../helpers/factories.js';
import { imageFile, mediaImage } from '../checks/media/support.js';

/** @import { PageRecord } from '../../server/src/types.js' */

/**
 * @typedef {Object} Row
 * @property {string} what
 * @property {string} site       Origin of the audited site.
 * @property {string} host       The other host, as a URL would carry it.
 * @property {string} [deployed]  Deployed origin of a local crawl.
 * @property {boolean} internal   A page of the site for the crawler (link.internal).
 * @property {boolean} sameCrawl  The one-crawl-per-site rule counts it as the same site.
 * @property {boolean} sameHost   A canonical there is on the site (seo.canonical.cross_host passes).
 * @property {boolean} own        The organisation's: the security scan does not record a hidden link there, the media
 *   module counts a robots.txt block of an image there, and a site that refused the crawler gets no image request there.
 * @property {boolean} deployed_  Left out of the external link check (the deployed site of a local crawl).
 */

/** @type {Row[]} */
const TABLE = [
  { what: 'the same host', site: 'https://www.acme.test', host: 'www.acme.test', internal: true, sameCrawl: true, sameHost: true, own: true, deployed_: false },
  { what: 'apex of a www site', site: 'https://www.acme.test', host: 'acme.test', internal: true, sameCrawl: true, sameHost: true, own: true, deployed_: false },
  { what: 'www of an apex site', site: 'https://acme.test', host: 'www.acme.test', internal: true, sameCrawl: true, sameHost: true, own: true, deployed_: false },
  // A trailing dot names the same host; the crawler still keeps it apart, or it would read every page twice.
  { what: 'trailing dot', site: 'https://www.acme.test', host: 'acme.test.', internal: false, sameCrawl: true, sameHost: true, own: true, deployed_: false },
  { what: 'another port', site: 'https://www.acme.test', host: 'www.acme.test:8443', internal: false, sameCrawl: true, sameHost: true, own: true, deployed_: false },
  { what: 'a subdomain', site: 'https://www.acme.test', host: 'blog.acme.test', internal: false, sameCrawl: false, sameHost: false, own: true, deployed_: false },
  { what: 'the organisation\'s CDN host', site: 'https://www.acme.co.uk', host: 'static.acme.co.uk', internal: false, sameCrawl: false, sameHost: false, own: true, deployed_: false },
  { what: 'a CDN of another company', site: 'https://www.acme.test', host: 'd111.cloudfront.net', internal: false, sameCrawl: false, sameHost: false, own: false, deployed_: false },
  { what: 'the same name under another ending, linked nowhere', site: 'https://www.acme.test', host: 'acme.xyz', internal: false, sameCrawl: false, sameHost: false, own: false, deployed_: false },
  { what: 'another customer of a shared host', site: 'https://acme.vercel.app', host: 'spam.vercel.app', internal: false, sameCrawl: false, sameHost: false, own: false, deployed_: false },
  { what: 'a subdomain of the customer on a shared host', site: 'https://acme.vercel.app', host: 'preview.acme.vercel.app', internal: false, sameCrawl: false, sameHost: false, own: true, deployed_: false },
  { what: 'another customer on a host missing from the list', site: 'https://acme.wordpress.com', host: 'spam.wordpress.com', internal: false, sameCrawl: false, sameHost: false, own: false, deployed_: false },
  { what: 'another name on a second-level ending', site: 'https://acme.gen.tr', host: 'spam.gen.tr', internal: false, sameCrawl: false, sameHost: false, own: false, deployed_: false },
  { what: 'local: another loopback name', site: 'http://localhost:3000', host: '127.0.0.1:3000', internal: false, sameCrawl: true, sameHost: false, own: false, deployed_: false },
  { what: 'local: another port', site: 'http://localhost:3000', host: 'localhost:4000', internal: false, sameCrawl: false, sameHost: true, own: true, deployed_: false },
  { what: 'local: the deployed site', site: 'http://localhost:3000', deployed: 'https://www.acme.test', host: 'acme.test', internal: false, sameCrawl: false, sameHost: false, own: true, deployed_: true },
  { what: 'local: a subdomain of the deployed site', site: 'http://localhost:3000', deployed: 'https://www.acme.test', host: 'cdn.acme.test', internal: false, sameCrawl: false, sameHost: false, own: true, deployed_: false },
];

/** @param {Row} row */
function crawlOf(row, /** @type {PageRecord[]} */ pages) {
  const site = new URL(row.site);
  return makeCrawl({
    start_url: `${row.site}/`, site_origin: row.site, site_host: site.host, pages,
    options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: site.hostname === 'localhost', ...(row.deployed ? { deployed_origin: row.deployed } : {}) },
  });
}

/**
 * Every consumer's answer for one row.
 * @param {Row} row
 */
function answers(row) {
  const target = `${row.host.startsWith('localhost') || row.host.startsWith('127.') ? 'http' : 'https'}://${row.host}/page`;
  const site = new URL(row.site);
  const html = `<html><head><link rel="canonical" href="${target}"></head><body><p>Text</p><a href="${target}">visible</a>
<div style="display:none"><a href="${target}">hidden</a></div><img src="${target.replace('/page', '/a.jpg')}" alt="A"></body></html>`;
  const input = { ...makeInput(makeFetch({ url: `${row.site}/`, html }), { siteHost: site.host }), deployedOrigin: row.deployed ?? null };
  const page = extractPage(input);
  // The hidden link alone: the same page without its visible twin.
  const hiddenOnly = extractPage({ ...input, result: makeFetch({ url: `${row.site}/`, html: html.replace(/<a href="[^"]*">visible<\/a>/, '') }) });
  // The other consumers see the page without its visible link, which would make the same name under another ending the
  // organisation's (the next test).
  const crawl = crawlOf(row, [hiddenOnly]);
  const seo = runChecks(allChecks(), buildContext(crawl), { modules: ['seo'], detectedAt: '2026-11-12T00:00:00Z' });
  const imageUrl = target.replace('/page', '/a.jpg');
  const image = mediaImage({ src: imageUrl, url: imageUrl });
  const mediaPage = { ...hiddenOnly, images: [image], videos: [], video_embeds: [], video_markup: false };
  const blocked = imageFile(imageUrl, { google: 'disallowed', google_agent: 'Googlebot', google_host: row.host });
  const media = runChecks(mediaChecks, buildContext(crawlOf(row, [mediaPage]), { imageFiles: new Map([[imageUrl, blocked]]) }), { modules: ['media'], detectedAt: '2026-11-12T00:00:00Z' });
  const loopback = site.hostname === 'localhost';
  return {
    internal: page.links.find((link) => link.text === 'visible')?.internal,
    sameCrawl: crawlKey(`${row.site}/`, loopback) === crawlKey(target, loopback),
    sameHost: !seo.findings.some((finding) => finding.check_id === 'seo.canonical.cross_host'),
    scanOwn: !hiddenOnly.security?.hidden_links.some((link) => link.url === target),
    mediaOwn: media.findings.some((finding) => finding.check_id === 'media.image.robots_blocked'),
    skipped: !selectImageFiles(crawlOf(row, [mediaPage]), 50, true).urls.includes(imageUrl),
    deployed: !externalLinkUrls(crawl).includes(target),
  };
}

test('every consumer gives the same answer for each host of the table', () => {
  for (const row of TABLE) {
    const got = answers(row);
    const own = row.own;
    // A crawl of a local server requests only its own origin, so it never chooses an image elsewhere. After a refusal the
    // same name under another ending is left alone too, linked or not: it may be the same organisation's server.
    const sameName = row.host === 'acme.xyz';
    const skipped = row.site.startsWith('http://localhost') ? !row.host.startsWith('localhost:3000') : own || sameName;
    assert.deepEqual(got, {
      internal: row.internal, sameCrawl: row.sameCrawl, sameHost: row.sameHost,
      scanOwn: row.internal || own, mediaOwn: own, skipped: row.internal || skipped, deployed: row.deployed_ || row.internal,
    }, row.what);
  }
});

test('the same name under another ending is the organisation\'s once a page of the site links there visibly', () => {
  const linked = siteIdentity({ siteHost: 'www.acme.test', visibleHosts: ['acme.xyz'] });
  assert.equal(linked.isSameOrganisation('shop.acme.xyz'), true);
  assert.equal(linked.isSameOrganisation('acme-pills.xyz'), false);
  assert.equal(siteIdentity({ siteHost: 'www.acme.test' }).isSameOrganisation('acme.xyz'), false);
  assert.equal(siteIdentity({ siteHost: 'www.acme.test', visibleHosts: ['acme.vercel.app'] }).isSameOrganisation('spam.vercel.app'), false,
    'a visible link to one customer of a shared host says nothing about another');
  assert.equal(siteIdentity({ siteHost: '192.0.2.1', visibleHosts: ['192.0.2.2'] }).isSameOrganisation('192.0.2.2'), false, 'an address has no name');
});

test('a public host is one that can be a public site, so it may be named to an outside service', () => {
  for (const url of ['https://example.com/', 'https://www.example.com./', 'http://8.8.8.8/']) assert.equal(isPublicHost(url), true, url);
  for (const url of ['http://localhost:3000/', 'http://127.0.0.1/', 'http://[::1]/', 'http://intranet/', 'http://box.local/', 'http://10.0.0.1/', 'not a url']) {
    assert.equal(isPublicHost(url), false, url);
  }
  assert.equal(siteIdentity({ siteHost: 'example.com' }).isPublic('https://example.com/'), true);
});
