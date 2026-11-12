import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SHARED_HOSTS, siteLabel } from '../../server/src/util/site-name.js';

test('a site is known by the name it registers, under any ending and on any subdomain', () => {
  for (const host of ['acme.com', 'acme.de', 'cdn.acme.com', 'shop.acme.co.uk', 'acme.com.tr', 'acme.com:8443', 'acme.com.']) {
    assert.equal(siteLabel(host), 'acme', host);
  }
  assert.equal(siteLabel('192.0.2.1'), null);
  assert.equal(siteLabel('[2001:db8::1]:8080'), null);
  assert.equal(siteLabel('localhost:3000'), null);
});

test('a customer of a shared hosting domain is a site of its own, apart from other customers and from the service', () => {
  assert.equal(siteLabel('acme.vercel.app'), 'acme.vercel.app');
  assert.equal(siteLabel('preview.acme.vercel.app'), 'acme.vercel.app', 'a subdomain of the customer\'s host is the customer\'s');
  assert.notEqual(siteLabel('spam.vercel.app'), siteLabel('acme.vercel.app'));
  assert.notEqual(siteLabel('acme.netlify.app'), siteLabel('acme.vercel.app'));
  assert.notEqual(siteLabel('acme.com'), siteLabel('acme.vercel.app'));
  assert.notEqual(siteLabel('vercel.com'), siteLabel('spam.vercel.app'), 'the service\'s own site is not its customers\'');
  assert.equal(siteLabel('vercel.app'), 'vercel', 'the shared domain itself is the service\'s');
  for (const [site, other] of [['acme.github.io', 'casino.github.io'], ['shop.myshopify.com', 'replica.myshopify.com'], ['me.blogspot.com', 'pills.blogspot.com'], ['a.pages.dev', 'b.pages.dev'], ['a.wixsite.com', 'b.wixsite.com'], ['a.herokuapp.com', 'b.herokuapp.com'], ['a.netlify.app', 'b.netlify.app']]) {
    assert.notEqual(siteLabel(site), siteLabel(other), `${site} and ${other}`);
  }
});

test('every shared hosting domain is written as two lower-case labels, which is how it is looked up', () => {
  assert.ok(SHARED_HOSTS.size >= 20);
  for (const suffix of SHARED_HOSTS) assert.match(suffix, /^[a-z0-9-]+\.[a-z]+$/, suffix);
});
