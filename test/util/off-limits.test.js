import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NOT_REQUESTED, offLimitsHost, offLimitsMatch, offLimitsReason } from '../../plugin/server/src/util/off-limits.js';

test('Google Play and the Android Market address are off limits, with their subdomains', () => {
  for (const url of ['https://play.google.com/store/apps/details?id=com.example', 'http://market.android.com/details?id=x', 'https://PLAY.google.com./x']) {
    assert.equal(offLimitsReason(url), 'google_play', url);
  }
  for (const url of ['https://google.com/', 'https://developers.google.com/play', 'https://playground.google.com/']) {
    assert.equal(offLimitsReason(url), null, url);
  }
});

test('social platforms, their short links and image hosts are off limits; their country domains too for Pinterest', () => {
  for (const url of [
    'https://www.facebook.com/acme', 'https://scontent.xx.fbcdn.net/a.jpg', 'https://x.com/acme', 'https://twitter.com/acme', 'https://pbs.twimg.com/a.jpg',
    'https://t.co/abc', 'https://www.linkedin.com/company/acme', 'https://media.licdn.com/a.png', 'https://www.instagram.com/acme/',
    'https://www.tiktok.com/@acme', 'https://www.youtube.com/@acme', 'https://i.ytimg.com/vi/x/hq.jpg', 'https://youtu.be/x', 'https://t.me/acme',
    'https://discord.gg/acme', 'https://www.pinterest.com/acme/', 'https://www.pinterest.co.uk/acme/', 'https://pinterest.de/acme/', 'https://i.pinimg.com/a.jpg',
    'https://www.threads.net/@acme', 'https://wa.me/123', 'https://www.reddit.com/r/acme',
  ]) {
    assert.equal(offLimitsReason(url), 'social_platform', url);
  }
});

test('other sites, look-alike names and other schemes are not off limits', () => {
  for (const url of [
    'https://example.com/', 'https://notfacebook.com/', 'https://facebook.com.example.net/', 'https://mastodon.social/@acme', 'https://pinterestfans.com/',
    'mailto:a@facebook.com', 'not a url', 'https://xfacebook.com/',
  ]) {
    assert.equal(offLimitsReason(url), null, url);
  }
});

test('an off-limits URL is named by its platform\'s domain, without www, trailing dots or the port', () => {
  assert.equal(offLimitsHost('https://www.facebook.com:443/acme'), 'facebook.com');
  assert.equal(offLimitsHost('https://play.google.com./x'), 'play.google.com');
  assert.equal(offLimitsHost('nonsense'), '');
  assert.match(NOT_REQUESTED.google_play, /never contacts Google Play/);
  assert.match(NOT_REQUESTED.social_platform, /never contacts social platforms/);
});

test('Play\'s image host and short links are Google Play; country domains of YouTube and Instagram are social platforms', () => {
  for (const url of ['https://play-lh.googleusercontent.com/abc=w240', 'https://play.app.goo.gl/?link=x']) assert.equal(offLimitsReason(url), 'google_play', url);
  for (const url of ['https://youtube.co.uk/x', 'https://www.youtube.de/', 'https://instagram.de/acme', 'https://www.pinterest.com.mx/a']) assert.equal(offLimitsReason(url), 'social_platform', url);
  for (const url of ['https://app.goo.gl/x', 'https://lh3.googleusercontent.com/a.jpg']) assert.equal(offLimitsReason(url), null, url);
});

test('the any-ending rule needs a country or generic ending: a customer\'s name under a hosting service is not the platform', () => {
  for (const url of ['https://pinterest.github.io/', 'https://pinterest.vercel.app/', 'https://pinterest.wordpress.com/', 'https://youtube.blogspot.com/', 'https://instagram.netlify.app/']) {
    assert.equal(offLimitsReason(url), null, url);
  }
});

test('every trailing dot goes, and the domain named is the platform\'s, never the host a page wrote (review of batch 1, D3)', () => {
  assert.equal(offLimitsReason('https://play.google.com.../x'), 'google_play');
  assert.deepEqual(offLimitsMatch('https://a_b.facebook.com/acme'), { reason: 'social_platform', domain: 'facebook.com' });
  assert.equal(offLimitsHost('https://a$b.facebook.com/acme'), 'facebook.com');
  const long = `https://${['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(50)].join('.')}.facebook.com/x`;
  assert.equal(offLimitsHost(long), 'facebook.com');
  assert.equal(offLimitsHost('https://www.pinterest.co.uk/x'), 'pinterest.co.uk');
  assert.equal(offLimitsHost('https://example.com/'), '');
});
