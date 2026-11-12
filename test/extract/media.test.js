import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_IMAGES } from '../../server/src/extract/html-elements.js';
import { MAX_VIDEOS, MAX_VIDEO_EMBEDS, srcsetUrls, styleDeclarations, videoPlatform } from '../../server/src/extract/media.js';
import { extractPage } from '../../server/src/extract/page.js';
import { makeFetch, makeInput } from './fetch-result.js';

/** @import { ImageRecord, PageRecord } from '../../server/src/types.js' */

/** CPU time this process has used, in milliseconds. */
const cpuMs = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};

/** @param {string} body @param {string} [head] @returns {PageRecord} */
const page = (body, head = '') => extractPage(makeInput(makeFetch({ html: `<!doctype html><html><head>${head}</head><body>${body}</body></html>` })));
/** @param {string} body @param {string} [head] @returns {ImageRecord} */
const image = (body, head) => page(body, head).images[0];

test('an image records whether something besides alt names it, and its role', () => {
  assert.equal(image('<img src="/a.jpg">').named, false);
  assert.equal(image('<img src="/a.jpg" aria-label="Chart">').named, true);
  assert.equal(image('<img src="/a.jpg" aria-labelledby="c">').named, true);
  assert.equal(image('<img src="/a.jpg" title="Chart">').named, true);
  assert.equal(image('<img src="/a.jpg" title="  ">').named, false, 'an empty title names nothing');
  assert.equal(image('<img src="/a.jpg" role="Presentation">').role, 'presentation');
  assert.equal(image('<img src="/a.jpg">').role, null);
});

test('an image records aria-hidden on itself or around it, and hiding by its own markup', () => {
  assert.equal(image('<div aria-hidden="true"><img src="/a.jpg"></div>').aria_hidden, true);
  assert.equal(image('<img src="/a.jpg" aria-hidden="TRUE">').aria_hidden, true);
  assert.equal(image('<img src="/a.jpg">').aria_hidden, false);
  assert.equal(image('<img src="/a.jpg" hidden>').hidden, true);
  assert.equal(image('<img src="/a.jpg" hidden="until-found">').hidden, false, 'until-found content can be revealed by search');
  assert.equal(image('<img src="/a.jpg" style="display: none !important">').hidden, true);
  assert.equal(image('<img src="/a.jpg" style="display:block">').hidden, false);
});

test('an inline style reserves the box with aspect-ratio, both sizes, or an absolute position', () => {
  assert.equal(image('<img src="/a.jpg" style="aspect-ratio: 16 / 9">').style_sized, true);
  assert.equal(image('<img src="/a.jpg" style="width:300px;height:200px">').style_sized, true);
  assert.equal(image('<img src="/a.jpg" style="position:absolute;inset:0">').style_sized, true);
  assert.equal(image('<img src="/a.jpg" style="width:100%;height:auto">').style_sized, false, 'height auto reserves nothing');
  assert.equal(image('<img src="/a.jpg" style="width:300px">').style_sized, false);
  assert.equal(image('<img src="/a.jpg" style="/* aspect-ratio: 1 */ color: red">').style_sized, false, 'a comment is not a declaration');
  assert.equal(image('<img src="/a.jpg">').style_sized, false);
});

test('an image records its priority hint and whether a preload before it names it', () => {
  const head = '<link rel="preload" as="image" href="/hero.jpg" imagesrcset="/hero-640.jpg 640w, /hero-1280.jpg 1280w">';
  assert.equal(image('<img src="/hero.jpg">', head).preloaded, true);
  assert.equal(image('<img src="/fallback.jpg" srcset="/hero-640.jpg 640w, /hero-1280.jpg 1280w">', head).preloaded, true);
  assert.equal(image('<img src="/other.jpg">', head).preloaded, false);
  assert.equal(image('<img src="/hero.jpg">', '<link rel="preload" as="font" href="/hero.jpg">').preloaded, false, 'only an image preload counts');
  assert.equal(image('<img src="/a.jpg" fetchpriority=" HIGH ">').fetchpriority, 'high');
  assert.equal(image('<img src="/a.jpg">').fetchpriority, null);
});

test('an image is the only content of a captioned figure, alone or in wrappers that hold nothing else', () => {
  assert.equal(image('<figure><img src="/a.jpg"><figcaption>Sales in October</figcaption></figure>').figure_caption, true);
  assert.equal(image('<figure><img src="/a.jpg"><figcaption> </figcaption></figure>').figure_caption, false, 'the caption needs text');
  assert.equal(image('<figure><img src="/a.jpg"><p>More</p><figcaption>Sales</figcaption></figure>').figure_caption, false);
  assert.equal(image('<figure>Text <img src="/a.jpg"><figcaption>Sales</figcaption></figure>').figure_caption, false);
  // A linked thumbnail with a caption, as wikis and galleries write it.
  assert.equal(image('<figure><a href="/x"><img src="/a.jpg"></a><figcaption>Sales</figcaption></figure>').figure_caption, true);
  assert.equal(image('<figure><a href="/x"><picture><source srcset="/a.webp"><img src="/a.jpg"></picture></a><figcaption>Sales</figcaption></figure>').figure_caption, true);
  assert.equal(image('<figure><a href="/x"><img src="/a.jpg"> Read more</a><figcaption>Sales</figcaption></figure>').figure_caption, false, 'a wrapper with text holds more than the image');
  assert.equal(image('<figure><a href="/x"><img src="/a.jpg"><img src="/b.jpg"></a><figcaption>Sales</figcaption></figure>').figure_caption, false, 'two images share the caption');
  assert.equal(image('<figure><div><div><div><span><img src="/a.jpg"></span></div></div></div><figcaption>Sales</figcaption></figure>').figure_caption, false, 'at most three wrappers');
  assert.equal(image('<a href="/x"><img src="/a.jpg"></a>').figure_caption, false);
});

test('a script framework\'s alt binding counts as a text alternative', () => {
  for (const binding of [':alt', 'v-bind:alt', 'x-bind:alt', '[alt]', '[attr.alt]']) {
    assert.equal(image(`<img ${binding}="item.title" :src="item.image">`).named, true, binding);
  }
  assert.equal(image('<img :src="item.image">').named, false, 'a bound src alone names nothing');
});

test('an image records whether it is in the page\'s frame and whether a utility class sizes it', () => {
  assert.equal(image('<header><img src="/logo.svg"></header>').chrome, true);
  assert.equal(image('<nav><img src="/i.svg"></nav>').chrome, true);
  assert.equal(image('<footer><img src="/badge.png"></footer>').chrome, true);
  assert.equal(image('<aside><img src="/promo.jpg"></aside>').chrome, true);
  assert.equal(image('<div role="banner"><img src="/logo.svg"></div>').chrome, true);
  assert.equal(image('<article><header><img src="/hero.jpg"></header></article>').chrome, false, 'an article\'s own header is content');
  assert.equal(image('<main><footer><img src="/x.jpg"></footer></main>').chrome, false);
  assert.equal(image('<main><img src="/x.jpg"></main>').chrome, false);
  assert.equal(image('<img src="/a.jpg" class="aspect-video w-full">').class_sized, true);
  assert.equal(image('<img src="/a.jpg" class="md:aspect-[4/3]">').class_sized, true);
  assert.equal(image('<img src="/a.jpg" class="size-full object-cover">').class_sized, true);
  assert.equal(image('<img src="/a.jpg" class="w-40 h-12">').class_sized, true);
  assert.equal(image('<img src="/a.jpg" class="w-full h-auto">').class_sized, false, 'h-auto reserves nothing');
  assert.equal(image('<img src="/a.jpg" class="aspect-auto w-10 h-auto">').class_sized, false);
  assert.equal(image('<img src="/a.jpg" class="hero">').class_sized, false);
});

test('an image in a picture records its sources and whether one offers AVIF or WebP', () => {
  const offered = image('<picture><source type="image/avif" srcset="/a.avif"><img src="/a.jpg"></picture>');
  assert.deepEqual([offered.picture_sources, offered.modern_source, offered.has_srcset], [true, true, true]);
  const art = image('<picture><source media="(min-width: 800px)" srcset="/wide.jpg"><img src="/a.jpg"></picture>');
  assert.deepEqual([art.picture_sources, art.modern_source], [true, false]);
  const bare = image('<img src="/a.jpg">');
  assert.deepEqual([bare.picture_sources, bare.modern_source, bare.has_srcset], [false, false, false]);
});

test('a width or height of 1 pixel or less, as an attribute or an inline style, marks a tracking pixel or a spacer', () => {
  assert.equal(image('<img src="/p.gif" width="1" height="1">').pixel, true);
  assert.equal(image('<img src="/p.gif" width="1">').pixel, true);
  assert.equal(image('<img src="/p.gif" style="width:1px;height:1px">').pixel, true);
  assert.equal(image('<img src="/p.gif" style="width:0;height:0;position:absolute">').pixel, true);
  assert.equal(image('<img src="/a.jpg" width="10" height="10">').pixel, false);
  assert.equal(image('<img src="/a.jpg" style="width:1em">').pixel, false);
  assert.equal(image('<img src="/a.jpg" style="width:100%">').pixel, false);
});

test('a picture with thousands of sources and images is read once, not once per image (review finding 1)', () => {
  const sources = '<source type="image/webp" srcset="/a.webp 1x, /b.webp 2x">'.repeat(5000);
  const start = cpuMs();
  const record = page(`<picture>${sources}${'<img src="/x.jpg" alt="x">'.repeat(2000)}</picture>`, '<link rel="preload" as="image" href="/p.jpg">');
  const spent = cpuMs() - start;
  assert.equal(record.images.length, 2000);
  assert.ok(record.images.every((i) => i.modern_source && i.picture_sources && !i.preloaded));
  assert.ok(spent < 5000, `took ${spent} ms of CPU time`);
});

test('images inside noscript are text for the parser and are not recorded', () => {
  assert.deepEqual(page('<noscript><img src="/pixel.gif" width="1" height="1"></noscript><img src="/a.jpg">').images.map((i) => i.src), ['/a.jpg']);
});

test('a video records how it plays and the kind of each track as browsers read it', () => {
  const [video] = page('<video controls src="/v.mp4"><track kind="captions" src="c.vtt"><track src="s.vtt"><track kind="Chapters"><track kind="karaoke"></video>').videos;
  assert.deepEqual(video, {
    url: 'https://example.test/v.mp4', muted: false, autoplay: false, controls: true, aria_hidden: false, hidden: false,
    tracks: ['captions', 'subtitles', 'chapters', 'metadata'], line: 1,
  });
  const [background] = page('<video autoplay muted loop playsinline><source src="/bg.webm" type="video/webm"></video>').videos;
  assert.deepEqual([background.url, background.muted, background.autoplay, background.controls], ['https://example.test/bg.webm', true, true, false]);
  assert.equal(page('<video></video>').videos[0].url, null);
});

test('players of known video platforms are recorded; other frames are not', () => {
  const record = page([
    '<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe>',
    '<iframe src="https://player.vimeo.com/video/1"></iframe>',
    '<embed src="https://fast.wistia.net/embed/iframe/x">',
    '<object data="https://www.dailymotion.com/embed/video/x"></object>',
    '<iframe src="https://www.youtube.com/watch?v=abc"></iframe>',
    '<iframe src="https://maps.example.test/embed"></iframe>',
  ].join(''));
  assert.deepEqual(record.video_embeds.map((embed) => [embed.tag, embed.platform]), [['iframe', 'youtube'], ['iframe', 'vimeo'], ['embed', 'wistia'], ['object', 'dailymotion']]);
  assert.equal(videoPlatform('https://players.brightcove.net/1/default_default/index.html'), 'brightcove');
  assert.equal(videoPlatform('https://cdn.jwplayer.com/players/abc.html'), 'jwplayer');
  assert.equal(videoPlatform('https://www.loom.com/embed/abc'), 'loom');
  assert.equal(videoPlatform('https://play.vidyard.com/abc'), 'vidyard');
  assert.equal(videoPlatform('https://www.tiktok.com/embed/v2/1'), 'tiktok');
  assert.equal(videoPlatform('https://geo.dailymotion.com/player/x.html'), 'dailymotion');
  assert.equal(videoPlatform('https://notyoutube.com/embed/abc'), null);
});

test('microdata or RDFa that names VideoObject is recorded', () => {
  assert.equal(page('<div itemscope itemtype="http://schema.org/VideoObject"></div>').video_markup, true);
  assert.equal(page('<div itemscope itemtype="https://schema.org/VideoObject"></div>').video_markup, true);
  assert.equal(page('<div vocab="https://schema.org/" typeof="VideoObject"></div>').video_markup, true);
  assert.equal(page('<div typeof="schema:VideoObject"></div>').video_markup, true);
  assert.equal(page('<div itemscope itemtype="https://schema.org/Article"></div>').video_markup, false);
});

test('srcset URLs are split as the HTML standard splits candidates, commas inside URLs included', () => {
  assert.deepEqual(srcsetUrls('/a.jpg 1x, /b.jpg 2x'), ['/a.jpg', '/b.jpg']);
  assert.deepEqual(srcsetUrls('/w_400,h_300/a.jpg 400w, /w_800,h_600/a.jpg 800w'), ['/w_400,h_300/a.jpg', '/w_800,h_600/a.jpg']);
  assert.deepEqual(srcsetUrls('/a.jpg,/b.jpg'), ['/a.jpg,/b.jpg'], 'without whitespace the comma belongs to the URL');
  assert.deepEqual(srcsetUrls('/a.jpg, /b.jpg'), ['/a.jpg', '/b.jpg']);
  assert.deepEqual(srcsetUrls(null), []);
  assert.equal(srcsetUrls(Array.from({ length: 100 }, (_, i) => `/${i}.jpg ${i}w`).join(', ')).length, 20);
});

test('inline styles are read without comments and !important, the last declaration winning', () => {
  const style = styleDeclarations('Display: NONE; /* display: block */ width: 10px !important; width: 20px');
  assert.equal(style.get('display'), 'none');
  assert.equal(style.get('width'), '20px');
  assert.equal(styleDeclarations('color: red /* unterminated').get('color'), 'red');
  assert.equal(styleDeclarations(null).size, 0);
});

test('video lists are capped, and a page of many images and long styles stays fast', () => {
  const videos = page('<video></video>'.repeat(MAX_VIDEOS + 10)).videos;
  assert.equal(videos.length, MAX_VIDEOS);
  const embeds = page('<iframe src="https://player.vimeo.com/video/1"></iframe>'.repeat(MAX_VIDEO_EMBEDS + 10)).video_embeds;
  assert.equal(embeds.length, MAX_VIDEO_EMBEDS);
  const style = `style="${'/* x '.repeat(5000)}"`;
  const srcset = `srcset="${'/a.jpg 1x, '.repeat(5000)}"`;
  const body = `<img src="/a.jpg" ${style} ${srcset} alt="x">`.repeat(MAX_IMAGES + 500);
  const start = cpuMs();
  const record = page(body, `<link rel="preload" as="image" imagesrcset="${'/p.jpg 1x, '.repeat(5000)}">`);
  const spent = cpuMs() - start;
  assert.ok(record.images.length <= MAX_IMAGES);
  assert.ok(spent < 8000, `took ${spent} ms of CPU time`);
});
