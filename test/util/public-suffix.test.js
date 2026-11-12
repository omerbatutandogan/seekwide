// The Public Suffix List as data (security review F2): the endings under
// which anyone can register a name, so that `<name>.<ending>` registered by
// someone else is never taken for the site's own domain.

import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';

import { compact } from '../../scripts/gen-public-suffixes.js';
import { TENANT_DOMAINS, parseSuffixRules, publicSuffix, registrableDomain, suffixRules } from '../../server/src/util/public-suffix.js';
import { siteIdentity } from '../../server/src/util/site-identity.js';

const DATA = new URL('../../server/data/public-suffixes.txt', import.meta.url);

test('the data file holds both sections of the list, fits the directory\'s size rule, and names the list\'s version', () => {
  const text = readFileSync(DATA, 'utf8');
  assert.ok(statSync(DATA).size < 256 * 1024, 'non-image files over 256 KiB are held for review');
  assert.match(text, /^# VERSION: \d{4}-\d{2}-\d{2}_/m);
  assert.match(text, /Mozilla Public License, v\. 2\.0/);
  const { rules, wildcards, exceptions, version } = suffixRules();
  assert.equal(version, /^# VERSION: (\S+)$/m.exec(text)?.[1]);
  assert.ok(rules.size > 9000, `${rules.size} rules`);
  // ICANN section.
  for (const rule of ['com', 'co.uk', 'me.uk', 'gen.tr', 'web.tr', 'com.tr', 'id.au', 'my.id', 'xn--55qx5d.cn']) assert.ok(rules.has(rule), rule);
  // Private section: hosting services that give each customer a host.
  for (const rule of ['vercel.app', 'github.io', 'blogspot.com', 'myshopify.com', 'wixsite.com', 'r2.dev', 'pages.dev']) assert.ok(rules.has(rule), rule);
  assert.ok(wildcards.has('ck') && wildcards.has('run.app') && exceptions.has('www.ck'));
});

test('registrableDomain follows the list\'s algorithm: the longest rule, wildcards, and exceptions first', () => {
  const cases = {
    'example.com': 'example.com', 'www.shop.example.com': 'example.com', 'shop.example.co.uk': 'example.co.uk',
    'acme.me.uk': 'acme.me.uk', 'spam.me.uk': 'spam.me.uk', 'acme.gen.tr': 'acme.gen.tr', 'x.acme.web.tr': 'acme.web.tr',
    'acme.id.au': 'acme.id.au', 'acme.my.id': 'acme.my.id', 'preview.acme.vercel.app': 'acme.vercel.app', 'acme.github.io': 'acme.github.io',
    'svc-hash-uc.a.run.app': 'svc-hash-uc.a.run.app', 'x.svc-hash-uc.a.run.app': 'svc-hash-uc.a.run.app', 'b.test.ck': 'b.test.ck', 'www.ck': 'www.ck', 'x.www.ck': 'www.ck',
    'a.b.kawasaki.jp': 'a.b.kawasaki.jp', 'www.city.kawasaki.jp': 'city.kawasaki.jp',
    'xn--85x722f.xn--55qx5d.cn': 'xn--85x722f.xn--55qx5d.cn', 'example.unknowntld': 'example.unknowntld',
  };
  for (const [name, expected] of Object.entries(cases)) assert.equal(registrableDomain(name), expected, name);
  for (const name of ['com', 'co.uk', 'vercel.app', 'test.ck', 'localhost', '192.0.2.1', '[::1]', '']) assert.equal(registrableDomain(name), null, name);
  assert.equal(publicSuffix('a.b.c.example.co.uk'), 'co.uk');
});

test('hosting services in the hand list are treated as public suffixes: two customers are two sites', () => {
  // The copy of the list as it is, without the hand list: a domain the list takes in leaves the hand list (CONTRIBUTING.md).
  const listed = new Set(readFileSync(DATA, 'utf8').split('\n').filter((line) => line !== '' && !line.startsWith('#'))
    .flatMap((line) => line.slice(line.indexOf(':') + 1).split(',').map((rest) => (rest === '' ? line.slice(0, line.indexOf(':')) : `${rest}.${line.slice(0, line.indexOf(':'))}`))));
  for (const domain of TENANT_DOMAINS) {
    assert.equal(listed.has(domain), false, `${domain} is not on the Public Suffix List, which is why it is in the hand list`);
    assert.equal(suffixRules().rules.has(domain), true, domain);
    assert.equal(registrableDomain(`acme.${domain}`), `acme.${domain}`, domain);
    assert.notEqual(registrableDomain(`acme.${domain}`), registrableDomain(`spam.${domain}`), domain);
    const site = siteIdentity({ siteHost: `acme.${domain}` });
    assert.equal(site.isSameOrganisation(`spam.${domain}`), false, `another customer of ${domain} is another site`);
    assert.equal(site.isSameOrganisation(`blog.acme.${domain}`), true, `a host under the customer's own on ${domain} is its own`);
  }
  assert.equal(registrableDomain('wordpress.com'), null, 'the service\'s own site has no name of its own under the rule');
});

test('the generator keeps both sections, writes ASCII labels and keeps wildcards and exceptions', () => {
  const list = [
    '// VERSION: 2026-01-01_00-00-00_UTC', '// COMMIT: abc', '// ===BEGIN ICANN DOMAINS===', 'uk', 'co.uk', '*.sch.uk', 'ck', '*.ck', '!www.ck',
    '0.bg', '公司.cn', '// ===END ICANN DOMAINS===', '// ===BEGIN PRIVATE DOMAINS===', 'vercel.app', '// ===END PRIVATE DOMAINS===', '',
  ].join('\n');
  const parsed = parseSuffixRules(compact(list));
  assert.equal(parsed.version, '2026-01-01_00-00-00_UTC');
  for (const rule of ['uk', 'co.uk', 'ck', '0.bg', 'xn--55qx5d.cn', 'vercel.app']) assert.ok(parsed.rules.has(rule), rule);
  assert.ok(parsed.wildcards.has('sch.uk') && parsed.wildcards.has('ck') && parsed.exceptions.has('www.ck'));
  assert.throws(() => compact('uk\n'), /VERSION/);
  assert.throws(() => compact('// VERSION: x\n// COMMIT: y\nuk\n'), /section/);
});
