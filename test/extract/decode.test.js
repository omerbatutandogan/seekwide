import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeBody, isHtmlResponse, mediaTypeOf } from '../../plugin/server/src/extract/decode.js';
import { extractPage } from '../../plugin/server/src/extract/page.js';
import { makeFetch, makeInput } from './fetch-result.js';

// "Şişli'de güzel bir gün, İzmir" in windows-1254: ş=FE, Ş=DE, ğ=F0, İ=DD, ü=FC.
const TURKISH_TEXT = "Şişli'de güzel bir gün, İzmir";
const TURKISH_1254 = Buffer.from([
  0xde, 0x69, 0xfe, 0x6c, 0x69, 0x27, 0x64, 0x65, 0x20, 0x67, 0xfc, 0x7a, 0x65, 0x6c, 0x20,
  0x62, 0x69, 0x72, 0x20, 0x67, 0xfc, 0x6e, 0x2c, 0x20, 0xdd, 0x7a, 0x6d, 0x69, 0x72,
]);
const SOFT_G = Buffer.from([0x64, 0x61, 0xf0]); // "dağ"

/**
 * @param {string} before
 * @param {Buffer} middle
 * @param {string} after
 */
function bytes(before, middle, after) {
  return Buffer.concat([Buffer.from(before, 'latin1'), middle, Buffer.from(after, 'latin1')]);
}

test('mediaTypeOf lower-cases and drops parameters', () => {
  assert.equal(mediaTypeOf('Text/HTML; charset=UTF-8'), 'text/html');
  assert.equal(mediaTypeOf(undefined), null);
  assert.equal(mediaTypeOf('  '), null);
});

test('isHtmlResponse trusts a declared type and sniffs only when none is given', () => {
  assert.equal(isHtmlResponse('text/html', null), true);
  assert.equal(isHtmlResponse('application/xhtml+xml', null), true);
  assert.equal(isHtmlResponse('text/plain', Buffer.from('<!doctype html><p>x')), false);
  assert.equal(isHtmlResponse(null, Buffer.from('﻿  <!-- c --> <!DOCTYPE HTML><p>x')), true);
  assert.equal(isHtmlResponse(null, Buffer.from('<?xml version="1.0"?>\n<html><p>x')), true);
  assert.equal(isHtmlResponse(null, Buffer.from('{"html": "<html>"}')), false);
  assert.equal(isHtmlResponse(null, Buffer.from('')), false);
  assert.equal(isHtmlResponse(null, null), false);
});

test('a windows-1254 page decodes from the Content-Type charset', () => {
  const body = bytes('<!doctype html><title>', TURKISH_1254, '</title><body><p>');
  const record = extractPage(makeInput(makeFetch({ body, headers: { 'content-type': 'text/html; charset=windows-1254' } })));
  assert.deepEqual(record.titles, [TURKISH_TEXT]);
  // Without the charset the same bytes are not Turkish text.
  const wrong = extractPage(makeInput(makeFetch({ body, headers: { 'content-type': 'text/html' } })));
  assert.notDeepEqual(wrong.titles, [TURKISH_TEXT]);
});

test('a windows-1254 page decodes from <meta charset> and from http-equiv', () => {
  const metaCharset = bytes('<!doctype html><html><head><meta charset="windows-1254"><title>', TURKISH_1254, '</title>');
  const record = extractPage(makeInput(makeFetch({ body: metaCharset, headers: { 'content-type': 'text/html' } })));
  assert.deepEqual(record.titles, [TURKISH_TEXT]);

  const httpEquiv = bytes('<html><head><meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-9"><title>', TURKISH_1254, '</title>');
  assert.deepEqual(extractPage(makeInput(makeFetch({ body: httpEquiv, headers: { 'content-type': 'text/html' } }))).titles, [TURKISH_TEXT]);
});

test('a meta charset after the first 2048 bytes or inside a comment is ignored', () => {
  const late = bytes(`<!doctype html><!--${'x'.repeat(2100)}--><meta charset="windows-1254"><title>`, SOFT_G, '</title>');
  assert.equal(decodeBody(late, 'text/html').encoding, 'utf-8');
  const commented = bytes('<!-- <meta charset="windows-1254"> --><title>', SOFT_G, '</title>');
  assert.equal(decodeBody(commented, 'text/html').encoding, 'utf-8');
});

test('the Content-Type charset wins over <meta charset>', () => {
  const body = Buffer.concat([Buffer.from('<meta charset="windows-1254"><title>'), Buffer.from('dağ', 'utf8'), Buffer.from('</title>')]);
  const record = extractPage(makeInput(makeFetch({ body, headers: { 'content-type': 'text/html; charset=utf-8' } })));
  assert.deepEqual(record.titles, ['dağ']);
});

test('a UTF-8 byte order mark decides the encoding and is not part of the text', () => {
  const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<!doctype html><title>Şeker</title>', 'utf8')]);
  const record = extractPage(makeInput(makeFetch({ body, headers: { 'content-type': 'text/html; charset=windows-1254' } })));
  assert.deepEqual(record.titles, ['Şeker']);
  assert.equal(decodeBody(body, undefined).text.startsWith('<!doctype'), true);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<title>ğ</title>', 'utf16le')]);
  assert.equal(decodeBody(utf16, 'text/html').text, '<title>ğ</title>');
});

test('an unknown charset label falls back to UTF-8', () => {
  const body = Buffer.from('<!doctype html><title>Güneş</title>', 'utf8');
  const record = extractPage(makeInput(makeFetch({ body, headers: { 'content-type': 'text/html; charset=x-made-up' } })));
  assert.deepEqual(record.titles, ['Güneş']);
  assert.equal(decodeBody(Buffer.from('<meta charset="nope">'), undefined).encoding, 'utf-8');
});
