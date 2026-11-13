import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyAddress, isPermittedClass } from '../../plugin/server/src/net/ip.js';

/**
 * @param {string} name
 * @param {[string, string][]} cases
 */
function table(name, cases) {
  test(name, () => {
    for (const [ip, expected] of cases) assert.equal(classifyAddress(ip), expected, ip);
  });
}

table('public IPv4 addresses, including the neighbours of every non-public range', [
  ['8.8.8.8', 'public'],
  ['1.1.1.1', 'public'],
  ['1.0.0.0', 'public'],
  ['9.255.255.255', 'public'],
  ['11.0.0.0', 'public'],
  ['100.63.255.255', 'public'],
  ['100.128.0.0', 'public'],
  ['126.255.255.255', 'public'],
  ['128.0.0.0', 'public'],
  ['169.253.255.255', 'public'],
  ['169.255.0.0', 'public'],
  ['172.15.255.255', 'public'],
  ['172.32.0.0', 'public'],
  ['192.0.1.0', 'public'],
  ['192.0.3.0', 'public'],
  ['192.167.255.255', 'public'],
  ['192.169.0.0', 'public'],
  ['198.17.255.255', 'public'],
  ['198.20.0.0', 'public'],
  ['198.51.99.255', 'public'],
  ['203.0.112.255', 'public'],
  ['203.0.114.0', 'public'],
  ['223.255.255.255', 'public'],
]);

table('IPv4 loopback, private, link-local and CGNAT edges', [
  ['127.0.0.0', 'loopback'],
  ['127.0.0.1', 'loopback'],
  ['127.255.255.255', 'loopback'],
  ['10.0.0.0', 'private'],
  ['10.255.255.255', 'private'],
  ['172.16.0.0', 'private'],
  ['172.31.255.255', 'private'],
  ['192.168.0.0', 'private'],
  ['192.168.255.255', 'private'],
  ['169.254.0.0', 'link_local'],
  ['169.254.169.254', 'link_local'],
  ['169.254.255.255', 'link_local'],
  ['100.64.0.0', 'cgnat'],
  ['100.127.255.255', 'cgnat'],
]);

table('IPv4 unspecified, multicast, broadcast, documentation and benchmark ranges', [
  ['0.0.0.0', 'unspecified'],
  ['0.0.0.1', 'reserved'],
  ['0.255.255.255', 'reserved'],
  ['224.0.0.0', 'multicast'],
  ['239.255.255.255', 'multicast'],
  ['240.0.0.0', 'reserved'],
  ['255.255.255.255', 'reserved'],
  ['192.0.0.0', 'reserved'],
  ['192.0.0.255', 'reserved'],
  ['192.0.2.0', 'reserved'],
  ['192.0.2.255', 'reserved'],
  ['198.51.100.0', 'reserved'],
  ['198.51.100.255', 'reserved'],
  ['203.0.113.0', 'reserved'],
  ['203.0.113.255', 'reserved'],
  ['198.18.0.0', 'reserved'],
  ['198.19.255.255', 'reserved'],
  ['192.88.99.1', 'reserved'],
]);

table('IPv6 addresses', [
  ['2606:4700:4700::1111', 'public'],
  ['2001:4860:4860::8888', 'public'],
  ['2a00:1450:4001:80b::200e', 'public'],
  ['::', 'unspecified'],
  ['::1', 'loopback'],
  ['[::1]', 'loopback'],
  ['::2', 'reserved'],
  ['fe80::', 'link_local'],
  ['fe80::1%en0', 'link_local'],
  ['febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'link_local'],
  ['fec0::1', 'private'],
  ['fc00::', 'private'],
  ['fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'private'],
  ['fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
  ['ff00::', 'multicast'],
  ['ff02::1', 'multicast'],
  ['2001:db8::', 'reserved'],
  ['2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
  ['2001::1', 'reserved'],
  ['2001:2::1', 'reserved'],
  ['3fff::1', 'reserved'],
  ['100::1', 'reserved'],
  ['1fff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
  ['4000::1', 'reserved'],
  ['::1.2.3.4', 'reserved'],
]);

table('IPv4-mapped, NAT64 and 6to4 IPv6 addresses are judged by their IPv4 address (127/8 inside NAT64 or 6to4 is reserved)', [
  ['::ffff:127.0.0.1', 'loopback'],
  ['::ffff:7f00:1', 'loopback'],
  ['::FFFF:7F00:0001', 'loopback'],
  ['0:0:0:0:0:ffff:7f00:1', 'loopback'],
  ['::ffff:10.0.0.1', 'private'],
  ['::ffff:a00:1', 'private'],
  ['::ffff:192.168.1.1', 'private'],
  ['::ffff:169.254.169.254', 'link_local'],
  ['::ffff:100.64.0.1', 'cgnat'],
  ['::ffff:0.0.0.0', 'unspecified'],
  ['::ffff:224.0.0.1', 'multicast'],
  ['::ffff:192.0.2.1', 'reserved'],
  ['::ffff:8.8.8.8', 'public'],
  ['[::ffff:8.8.8.8]', 'public'],
  ['::ffff:0:a00:1', 'reserved'],
  ['64:ff9b::7f00:1', 'reserved'],
  ['64:ff9b::127.0.0.1', 'reserved'],
  ['64:ff9b::7fff:ffff', 'reserved'],
  ['2002:7fff:ffff::1', 'reserved'],
  ['64:ff9b::10.1.2.3', 'private'],
  ['64:ff9b::8.8.8.8', 'public'],
  ['64:ff9b:1::1', 'reserved'],
  ['2002:7f00:1::', 'reserved'],
  ['2002:c0a8:101::1', 'private'],
  ['2002:808:808::1', 'public'],
]);

table('anything that is not an IP address is reserved', [
  ['', 'reserved'],
  ['localhost', 'reserved'],
  ['256.0.0.1', 'reserved'],
  ['1.2.3', 'reserved'],
  ['::g', 'reserved'],
  ['example.com', 'reserved'],
]);

test('classifyAddress treats a non-string as reserved', () => {
  assert.equal(classifyAddress(/** @type {any} */ (undefined)), 'reserved');
  assert.equal(classifyAddress(/** @type {any} */ (2130706433)), 'reserved');
});

test('isPermittedClass allows public always and loopback only when asked', () => {
  assert.equal(isPermittedClass('public', false), true);
  assert.equal(isPermittedClass('loopback', false), false);
  assert.equal(isPermittedClass('loopback', true), true);
  for (const cls of /** @type {const} */ (['private', 'link_local', 'cgnat', 'unspecified', 'multicast', 'reserved'])) {
    assert.equal(isPermittedClass(cls, true), false, cls);
    assert.equal(isPermittedClass(cls, false), false, cls);
  }
});
