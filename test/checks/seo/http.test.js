import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makePage, makeRedirect } from '../../helpers/factories.js';
import { audit } from './helpers.js';

/**
 * A record for a URL the crawler was refused on.
 * @param {string} url
 * @param {number} status
 * @param {string} fetchError
 */
function unreadable(url, status, fetchError) {
  return makePage({
    url,
    status,
    is_html: false,
    fetch_error: fetchError,
    titles: [],
    headings: [],
    canonicals: [],
    indexability: { indexable: false, reasons: ['fetch_error'] },
  });
}

const failedRecord = makePage({
  url: `${SITE}/down`,
  status: 0,
  final_status: 0,
  is_html: false,
  fetch_error: 'timeout',
  indexability: { indexable: false, reasons: ['fetch_error'] },
});

test('seo.http.server_error fails 5xx, passes 2xx and 4xx, and ignores redirects, failed requests and refused requests', () => {
  const pages = [
    makePage({ url: `${SITE}/ok` }),
    makePage({ url: `${SITE}/gone`, status: 404, indexability: { indexable: false, reasons: ['status_404'] } }),
    makePage({ url: `${SITE}/broken`, status: 503, indexability: { indexable: false, reasons: ['status_503'] } }),
    makeRedirect(`${SITE}/old`, `${SITE}/ok`),
    failedRecord,
    unreadable(`${SITE}/challenged`, 503, 'bot_challenge'),
    unreadable(`${SITE}/limited`, 429, 'rate_limited'),
  ];
  const { units, failed, findings } = audit('seo.http.server_error', { pages });
  assert.deepEqual(units, [`${SITE}/broken`, `${SITE}/gone`, `${SITE}/ok`]);
  assert.deepEqual(failed, [`${SITE}/broken`]);
  assert.equal(findings[0].evidence.observed, 503);
});

test('seo.http.fetch_failed fails status 0 and does not count URLs the crawler was refused on', () => {
  const pages = [
    makePage({ url: `${SITE}/ok` }),
    makeRedirect(`${SITE}/old`, `${SITE}/ok`),
    makeRedirect(`${SITE}/to-private`, `${SITE}/private`, { final_status: 0, fetch_error: 'robots_disallowed' }),
    failedRecord,
    unreadable(`${SITE}/challenged`, 403, 'bot_challenge'),
    unreadable(`${SITE}/limited`, 429, 'rate_limited'),
  ];
  const { stat, units, failed, findings } = audit('seo.http.fetch_failed', { pages });
  assert.equal(stat.applicable, 4);
  assert.deepEqual(units, [`${SITE}/down`, `${SITE}/ok`, `${SITE}/old`, `${SITE}/to-private`]);
  assert.deepEqual(failed, [`${SITE}/down`]);
  assert.deepEqual(findings[0].evidence.observed, { status: 0, fetch_error: 'timeout' });
});

test('seo.redirect.chain fails two or more hops and only counts redirect records', () => {
  const twoHops = makeRedirect(`${SITE}/a`, `${SITE}/c`, {
    redirect_chain: [
      { url: `${SITE}/a`, status: 301, location: `${SITE}/b` },
      { url: `${SITE}/b`, status: 302, location: `${SITE}/c` },
    ],
  });
  const oneHop = makeRedirect(`${SITE}/x`, `${SITE}/c`);
  const target = makePage({ url: `${SITE}/c` });
  const { units, failed, findings } = audit('seo.redirect.chain', { pages: [twoHops, oneHop, target] });
  assert.deepEqual(units, [`${SITE}/a`, `${SITE}/x`]);
  assert.deepEqual(failed, [`${SITE}/a`]);
  assert.deepEqual(findings[0].evidence.observed, { hops: 2, chain: [`301 ${SITE}/a`, `302 ${SITE}/b`] });
});

test('seo.redirect.broken fails loops, hop limits, failed requests and error endings, and passes working redirects', () => {
  const pages = [
    makeRedirect(`${SITE}/fine`, `${SITE}/`),
    makeRedirect(`${SITE}/to-404`, `${SITE}/missing`, { final_status: 404 }),
    makeRedirect(`${SITE}/to-nothing`, `${SITE}/down`, { final_status: 0, fetch_error: 'connection_error' }),
    makeRedirect(`${SITE}/loop`, `${SITE}/loop2`, { final_status: 301, fetch_error: 'redirect_loop' }),
    makeRedirect(`${SITE}/long`, `${SITE}/long6`, { final_status: 301, fetch_error: 'too_many_redirects' }),
    makeRedirect(`${SITE}/bad-location`, `${SITE}/bad-location`, { final_status: 0, fetch_error: 'invalid_url' }),
    makeRedirect(`${SITE}/to-redirect`, `${SITE}/elsewhere`, { final_status: 302 }),
    makePage({ url: `${SITE}/` }),
  ];
  const { units, failed, findings } = audit('seo.redirect.broken', { pages });
  assert.equal(units.length, 7);
  assert.deepEqual(failed.sort(), [`${SITE}/bad-location`, `${SITE}/long`, `${SITE}/loop`, `${SITE}/to-404`, `${SITE}/to-nothing`]);
  assert.match(findings.find((f) => f.url === `${SITE}/loop`)?.evidence.detail ?? '', /loop/);
  assert.match(findings.find((f) => f.url === `${SITE}/to-404`)?.evidence.detail ?? '', /404/);
  assert.match(findings.find((f) => f.url === `${SITE}/long`)?.evidence.detail ?? '', /more than 10 redirects/);
});

test('seo.redirect.broken does not count redirects that leave the site or end where the crawler was refused', () => {
  const pages = [
    makeRedirect(`${SITE}/out`, 'https://other.test/', { final_status: 0, final_external: true }),
    makeRedirect(`${SITE}/challenged`, `${SITE}/wall`, { final_status: 0, fetch_error: 'bot_challenge' }),
    makeRedirect(`${SITE}/limited`, `${SITE}/busy`, { final_status: 0, fetch_error: 'rate_limited' }),
    makeRedirect(`${SITE}/private`, `${SITE}/admin`, { final_status: 0, fetch_error: 'robots_disallowed' }),
    makeRedirect(`${SITE}/fine`, `${SITE}/`),
    makePage({ url: `${SITE}/` }),
  ];
  const { units, failed } = audit('seo.redirect.broken', { pages });
  assert.deepEqual(units, [`${SITE}/fine`]);
  assert.deepEqual(failed, []);
});
