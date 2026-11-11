// Shared helpers for the report tests: hostile strings, a run that carries them
// in every dynamic field, and structural checks on the rendered output.

import assert from 'node:assert/strict';

import { compareRuns } from '../../server/src/store/compare.js';
import { makeFinding, makeRun } from '../helpers/run-factory.js';

/** Strings copied from a hostile web page. */
export const PAYLOADS = [
  '<script>alert(1)</script>',
  '"><img src=x onerror=alert(1)>',
  'javascript:alert(1)',
  "'><svg/onload=alert(1)>",
  '</style><script>alert(1)</script>',
  'x|y`z`\n# injected\n- item | a | b',
];

/**
 * A run (and options) with `payload` in every dynamic string.
 * @param {string} payload
 */
export function hostileInput(payload) {
  const url = `https://example.test/?q=${encodeURIComponent(payload)}`;
  const finding = makeFinding({
    check_id: 'seo.title.missing',
    title: `Title ${payload}`,
    url: payload,
    selector: payload,
    evidence: { observed: payload, expected: payload, detail: payload },
    related_urls: [payload, url],
    recommendation: payload,
    doc_ref: payload,
  });
  const second = makeFinding({ check_id: 'links.internal.broken', module: 'links', url, selector: payload, evidence: { observed: { payload }, detail: payload }, doc_ref: url });
  const run = makeRun({
    run_id: `run-${payload}`,
    plugin_version: payload,
    rules_version: payload,
    start_url: url,
    site_origin: payload,
    crawl: { robots_status: payload, user_agent: payload, blocked: { reason: payload, url: payload, status: 403 }, truncated: true, unreadable_pages: 3 },
    modules_requested: [payload, 'seo'],
    modules: { [payload]: { score: null, coverage: 0.5, checks_total: 2, checks_run: 1, checks_skipped: 1, note: payload }, seo: { score: 70, coverage: 1, checks_total: 1, checks_run: 1, checks_skipped: 0, note: null } },
    checks: [
      { id: payload, module: payload, status: 'skipped', skip_reason: payload, applicable: 0, passed: 0, failed: 0 },
      { id: `err-${payload}`, module: 'seo', status: 'error', skip_reason: payload, applicable: 0, passed: 0, failed: 0 },
    ],
    findings: [finding, second],
    core_web_vitals: /** @type {any} */ ({
      lab: { available: true, reason: payload, device: payload },
      field: { available: false, reason: payload, form_factor: payload },
      origin: {
        origin: payload,
        field: { lcp_ms: { p75: 3100, good: 0.5 }, inp_ms: { p75: payload }, cls: { p75: 0.3, good: payload }, period: { first: payload, last: payload } },
        field_note: payload,
      },
      pages: [
        { url: payload, why: payload, lab: { lcp_ms: 4000, cls: payload, tbt_ms: 90, lighthouse_version: payload, final_url: payload }, lab_note: payload, field: null, field_note: payload },
        { url, why: payload, lab: null, lab_note: payload, field: { lcp_ms: { p75: 1200, good: 0.9 }, inp_ms: null, cls: null, period: null }, field_note: null },
      ],
      notes: [payload, payload],
    }),
  });
  const base = makeRun({ run_id: `base-${payload}`, rules_version: payload, start_url: payload, findings: [makeFinding({ url: payload, title: payload, check_id: 'seo.h1.missing' })] });
  const comparison = compareRuns(base, run);
  return {
    run,
    options: {
      executiveSummary: `${payload}\n\n${payload}`,
      recommendations: [{ title: payload, detail: payload }],
      brandName: payload,
      comparison,
    },
  };
}

const ALLOWED_TAGS = new Set([
  'html', 'head', 'meta', 'title', 'style', 'body', 'main', 'header', 'div', 'span', 'h1', 'h2', 'h3', 'p', 'section', 'article', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'dl', 'dt', 'dd', 'a', 'code', 'strong', 'img', 'i', 'b', 'br', 'footer',
]);
const ALLOWED_ATTRS = new Set(['class', 'id', 'href', 'rel', 'src', 'alt', 'lang', 'charset', 'name', 'content', 'http-equiv']);
const TAG = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*"[^"]*")?)*)\s*\/?>/g;
const ATTR = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g;

/**
 * Split HTML into tags and the text between them. The output is built with
 * double-quoted attributes only, so a tag that does not match `TAG` stays in
 * the text and is caught by the "no angle brackets in text" check.
 * @param {string} out
 */
export function parseHtml(out) {
  const withoutStyle = out.replace(/<style>[\s\S]*?<\/style>/, '').replace(/^<!doctype html>\n/i, '');
  /** @type {{name: string, closing: boolean, attrs: Record<string, string|null>}[]} */
  const tags = [];
  const text = withoutStyle.replace(TAG, (_all, slash, name, attrText) => {
    /** @type {Record<string, string|null>} */
    const attrs = {};
    for (const match of String(attrText).matchAll(ATTR)) attrs[match[1].toLowerCase()] = match[2] ?? null;
    tags.push({ name: String(name).toLowerCase(), closing: slash === '/', attrs });
    return '';
  });
  return { tags, text, css: out.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '' };
}

/**
 * The HTML report must hold only whitelisted tags and attributes, no script,
 * no handler, no external resource, and only http(s) links.
 * @param {string} out
 */
export function assertSafeHtml(out) {
  assert.ok(!/<script/i.test(out), 'contains <script');
  assert.ok(!/<\/?(?:iframe|object|embed|link|base|form|input|button|svg|video|audio|source|frame)\b/i.test(out), 'contains a forbidden element');
  const { tags, text, css } = parseHtml(out);
  assert.ok(!/[<>]/.test(text), `unescaped angle bracket in text: ${/.{0,30}[<>].{0,30}/.exec(text)?.[0]}`);
  for (const tag of tags) {
    assert.ok(ALLOWED_TAGS.has(tag.name), `element <${tag.name}> is not allowed`);
    for (const [name, value] of Object.entries(tag.attrs)) {
      assert.ok(ALLOWED_ATTRS.has(name) || (name === 'style' && /^width:\d{1,3}%$/.test(value ?? '')), `attribute ${name}="${value}" on <${tag.name}> is not allowed`);
      assert.ok(!name.startsWith('on'), `event handler ${name}`);
    }
    if (tag.name === 'a' && !tag.closing) {
      assert.match(tag.attrs.href ?? '', /^https?:\/\/[^\s"'<>]+$/, 'link is not http(s)');
      assert.equal(tag.attrs.rel, 'noopener noreferrer nofollow');
    }
    if (tag.name === 'img') assert.match(tag.attrs.src ?? '', /^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/, 'image is not a data URI');
    if (tag.name === 'meta' && 'http-equiv' in tag.attrs) assert.equal(tag.attrs['http-equiv'], 'Content-Security-Policy');
  }
  assert.ok(!/url\s*\(|@import/i.test(css), 'stylesheet loads something');
}

/**
 * Remove inline code spans (a fence of n backticks closed by the next fence of exactly n).
 * @param {string} md
 */
export function stripCodeSpans(md) {
  let out = '';
  let i = 0;
  while (i < md.length) {
    if (md[i] !== '`') {
      out += md[i];
      i += 1;
      continue;
    }
    let n = 0;
    while (md[i + n] === '`') n += 1;
    let j = i + n;
    let close = -1;
    while (j < md.length) {
      if (md[j] === '`') {
        let m = 0;
        while (md[j + m] === '`') m += 1;
        if (m === n) {
          close = j;
          break;
        }
        j += m;
      } else {
        j += 1;
      }
    }
    if (close === -1) {
      out += md.slice(i, i + n);
      i += n;
    } else {
      i = close + n;
    }
  }
  return out;
}

/**
 * Markdown output may contain markup only that the renderer wrote itself:
 * autolinks to http(s) URLs. Table rows must keep a constant number of cells.
 * @param {string} md
 */
export function assertSafeMarkdown(md) {
  const outside = stripCodeSpans(md).replace(/<https?:\/\/[^\s<>]+>/g, '');
  assert.ok(!/</.test(outside), `raw "<" outside code spans: ${/.{0,30}<.{0,30}/.exec(outside)?.[0]}`);
  assert.ok(!/(?<!\\)\]\(/.test(outside), 'markdown link syntax outside code spans');
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('|')) continue;
    let end = i;
    while (end < lines.length && lines[end].startsWith('|')) end += 1;
    const counts = lines.slice(i, end).map((line) => line.split(/(?<!\\)\|/).length);
    assert.equal(new Set(counts).size, 1, `table rows with different cell counts: ${counts.join(',')} near "${lines[i].slice(0, 60)}"`);
    i = end;
  }
}
