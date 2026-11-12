import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makePage, makeSecurity } from '../../helpers/factories.js';
import { audit, findingsFor, statFor } from './support.js';

const FRAME = 'security.embeds.hidden_frame';
const RARE = 'security.embeds.rare_host';

/**
 * @param {'script'|'iframe'} tag
 * @param {string} url
 * @param {string|null} [hidden]
 * @returns {import('../../../server/src/types.js').EmbedRecord}
 */
const embed = (tag, url, hidden = null) => ({ tag, url, host: new URL(url).host.replace(/^www\./, ''), hidden, line: 12 });

/**
 * @param {string} path
 * @param {import('../../../server/src/types.js').EmbedRecord[]} embeds
 */
const page = (path, embeds) => makePage({ url: `${SITE}${path}`, security: makeSecurity({ embeds }) });

test(`${FRAME} fails a page with a hidden frame from another site and passes one whose frames are visible`, () => {
  const result = audit([
    page('/', [embed('iframe', 'https://www.youtube-nocookie.com/embed/a'), embed('script', 'https://cdn.test/a.js')]),
    page('/about', [embed('iframe', 'https://bad.test/x', 'zero size'), embed('iframe', 'https://bad.test/y', 'display:none')]),
    page('/blog', [embed('script', 'https://cdn.test/a.js')]),
  ]);
  const stat = statFor(result, FRAME);
  assert.deepEqual([stat.applicable, stat.failed], [2, 1], 'a page without frames is not a unit');
  const [finding] = findingsFor(result, FRAME);
  assert.equal(finding.url, `${SITE}/about`);
  assert.equal(finding.selector, 'iframe[src="https://bad.test/x"]');
  assert.equal(finding.line, 12);
  assert.deepEqual(finding.evidence.observed, { hidden_frames: 2, hosts: ['bad.test'], first: { src: 'https://bad.test/x', how: 'zero size' } });
});

test(`${RARE} lists a script or frame host that only one page uses, on a crawl of five or more pages`, () => {
  const shared = embed('script', 'https://www.googletagmanager.com/gtag/js');
  const pages = [
    page('/', [shared]),
    page('/a', [shared, embed('script', 'https://odd.test/x.js'), embed('script', 'https://odd.test/y.js')]),
    page('/b', [shared, embed('iframe', 'https://maps.test/embed')]),
    page('/c', [shared, embed('iframe', 'https://maps.test/embed')]),
    page('/d', [shared]),
  ];
  const result = audit(pages);
  const stat = statFor(result, RARE);
  assert.deepEqual([stat.applicable, stat.failed], [8, 1]);
  const [finding] = findingsFor(result, RARE);
  assert.equal(finding.severity, 'info');
  assert.equal(finding.weight, 0);
  assert.equal(finding.url, `${SITE}/a`);
  assert.equal(finding.selector, 'script[src="https://odd.test/x.js"]');
  assert.deepEqual(finding.evidence.observed, { host: 'odd.test', tag: 'script', src: 'https://odd.test/x.js', pages_crawled: 5 });
});

test(`${RARE} has no unit on a crawl of fewer than five pages, and never changes the score`, () => {
  const small = audit([page('/', []), page('/a', [embed('script', 'https://odd.test/x.js')])]);
  assert.equal(statFor(small, RARE).applicable, 0);
  const pages = ['/', '/a', '/b', '/c', '/d'].map((path, i) => page(path, i === 1 ? [embed('script', 'https://odd.test/x.js')] : []));
  assert.equal(audit(pages).modules.security.score, 100);
});

test(`${FRAME} and ${RARE} leave out frames and scripts from the deployed site of a local crawl`, () => {
  const local = (/** @type {string} */ path, /** @type {import('../../../server/src/types.js').EmbedRecord[]} */ embeds) =>
    makePage({ url: `http://localhost:3000${path}`, security: makeSecurity({ embeds }) });
  const pages = ['/', '/a', '/b', '/c', '/d'].map((path, i) => local(path, i === 1 ? [embed('iframe', 'https://www.acme.com/widget', 'zero size')] : []));
  const crawl = {
    start_url: 'http://localhost:3000/', site_origin: 'http://localhost:3000', site_host: 'localhost:3000',
    options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local: true, deployed_origin: 'https://acme.com' },
  };
  const result = audit(pages, crawl);
  assert.equal(statFor(result, FRAME).applicable, 0);
  assert.equal(statFor(result, RARE).applicable, 0);
  assert.equal(findingsFor(audit(pages, { ...crawl, options: { ...crawl.options, deployed_origin: undefined } }), FRAME).length, 1);
});
