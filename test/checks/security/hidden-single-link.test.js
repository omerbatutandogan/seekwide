// The wording of a single hidden link (validation of 2026-11-12, fix 13).
// Modeled on a shop page that hides a paragraph with a supplier's logo link
// (`<p style="display: none;">`): accurate, but "the site may have been
// hacked" is strong for one hidden link to a business partner.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractHtml } from '../../../plugin/server/src/extract/html.js';
import { SITE, makePage } from '../../helpers/factories.js';
import { audit, findingsFor } from './support.js';

/** @param {string} body */
function run(body) {
  const fields = extractHtml(`<html><head><title>Drinks</title></head><body>${body}</body></html>`, { responseUrl: `${SITE}/drinks`, siteHost: new URL(SITE).host, includeSubdomains: false });
  return audit([makePage({ url: `${SITE}/drinks`, links: fields.links, security: fields.security })]);
}

test('one hidden link is still reported, with a first sentence that names the harmless explanation as well', () => {
  const result = run('<p>Our milk.</p><p style="margin-top: 30px; display: none;"><a href="http://juice.partner.test/"><img src="/logo.png" alt="Partner lemonade"></a>Lemonade.</p>');
  const [finding] = findingsFor(result, 'security.hidden.external_link');
  assert.equal(finding.severity, 'high', 'the finding and its weight do not change');
  assert.match(finding.evidence.detail ?? '', /^One link to another site cannot be seen by visitors/);
  assert.match(finding.evidence.detail ?? '', /A single hidden link can be the site's own, such as a partner's logo/);
  assert.match(finding.recommendation, /^Open the page source and find the element shown in the evidence\. If the links are yours/);
  assert.match(finding.recommendation, /If nobody on your side put them there, the site may have been hacked/);
});

test('several hidden links keep the plain statement', () => {
  const result = run('<div style="position:absolute;left:-9999px"><a href="https://spam.test/a">pills</a><a href="https://spam.test/b">casino</a></div>');
  assert.match(findingsFor(result, 'security.hidden.external_link')[0].evidence.detail ?? '', /^2 links to another site cannot be seen by visitors/);
});
