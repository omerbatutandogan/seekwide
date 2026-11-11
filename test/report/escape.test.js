import assert from 'node:assert/strict';
import { test } from 'node:test';

import { escapeHtml, html, mdCode, mdText, mdUrl, raw, safeHttpUrl } from '../../server/src/report/escape.js';

test('escapeHtml escapes the five characters that matter in element text and attributes', () => {
  assert.equal(escapeHtml(`<a href="x" title='y'>&</a>`), '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(escapeHtml('plain text'), 'plain text');
  assert.equal(escapeHtml(42), '42');
  assert.equal(escapeHtml('&amp;'), '&amp;amp;', 'already-escaped text is escaped again, never trusted');
});

test('safeHttpUrl returns the normalized URL for http and https only', () => {
  assert.equal(safeHttpUrl('https://Example.com/a b'), 'https://example.com/a%20b');
  assert.equal(safeHttpUrl('http://example.com'), 'http://example.com/');
  assert.equal(safeHttpUrl('  https://example.com/x  '), 'https://example.com/x');
  for (const bad of [
    'javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'vbscript:x', 'file:///etc/passwd', 'ftp://example.com', '//example.com', '/relative', 'example.com', '', 'https://', 'https://exa mple.com',
    null, undefined, 5, {}, `https://example.com/${'a'.repeat(2100)}`,
  ]) {
    assert.equal(safeHttpUrl(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test('the html tag escapes every interpolated value, including values inside attributes', () => {
  const evil = '"><script>alert(1)</script>';
  assert.equal(html`<p class="${evil}">${evil}</p>`.toString(), '<p class="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('the html tag does not escape nested html calls or raw(), and flattens arrays', () => {
  const inner = html`<b>${'<i>'}</b>`;
  assert.equal(html`<p>${inner}</p>`.toString(), '<p><b>&lt;i&gt;</b></p>');
  assert.equal(html`${[html`<li>${'a&b'}</li>`, html`<li>2</li>`]}`.toString(), '<li>a&amp;b</li><li>2</li>');
  assert.equal(html`${raw('<hr>')}`.toString(), '<hr>');
  assert.equal(html`[${null}${undefined}${false}]`.toString(), '[]');
  assert.equal(html`${0}`.toString(), '0');
});

test('the html tag cannot be fooled by a string that looks like markup it produced', () => {
  const fake = { value: '<script>', toString: () => '<script>' };
  assert.equal(html`${fake}`.toString(), '&lt;script&gt;');
});

test('mdText collapses whitespace and escapes characters Markdown would interpret', () => {
  assert.equal(mdText('a\n\nb   c'), 'a b c');
  assert.equal(mdText('*bold* _it_ `code` [l](u) | pipe ~strike~ \\'), '\\*bold\\* \\_it\\_ \\`code\\` \\[l\\](u) \\| pipe \\~strike\\~ \\\\');
  assert.equal(mdText('<script>alert(1)</script>'), '&lt;script>alert(1)&lt;/script>');
  assert.equal(mdText('a > b'), 'a > b');
  assert.equal(mdText('# heading'), '\\# heading');
  assert.equal(mdText('- item'), '\\- item');
  assert.equal(mdText('+ item'), '\\+ item');
  assert.equal(mdText('1. item'), '1\\. item');
  assert.equal(mdText('2) item'), '2\\) item');
  assert.equal(mdText('> quote'), '\\> quote');
  assert.equal(mdText('a - b'), 'a - b');
  assert.equal(mdText(12), '12');
});

test('mdText never leaves a pipe unescaped, so a table row cannot gain a cell', () => {
  assert.ok(!/(?<!\\)\|/.test(mdText('a|b||c\\|d')));
});

test('mdCode wraps the value in a code span that its content cannot end', () => {
  assert.equal(mdCode('plain'), '`plain`');
  assert.equal(mdCode('a `b` c'), '``a `b` c``');
  assert.equal(mdCode('``'), '``` `` ```');
  assert.equal(mdCode('`edge'), '`` `edge ``');
  assert.equal(mdCode('line one\nline two'), '`line one line two`');
  assert.equal(mdCode('   '), '');
  assert.equal(mdCode('<script>'), '`<script>`');
});

test('mdCode escapes pipes only for table cells', () => {
  assert.equal(mdCode('a|b'), '`a|b`');
  assert.equal(mdCode('a|b', true), '`a\\|b`');
});

test('mdUrl gives an autolink for http(s) and a code span for everything else', () => {
  assert.equal(mdUrl('https://example.com/a'), '<https://example.com/a>');
  assert.equal(mdUrl('https://example.com/?a|b', true), '<https://example.com/?a%7Cb>');
  assert.equal(mdUrl('javascript:alert(1)'), '`javascript:alert(1)`');
  assert.equal(mdUrl('data:text/html,x|y', true), '`data:text/html,x\\|y`');
  assert.equal(mdUrl('not a url'), '`not a url`');
  assert.equal(mdUrl('"><img src=x onerror=alert(1)>'), '`"><img src=x onerror=alert(1)>`');
});
