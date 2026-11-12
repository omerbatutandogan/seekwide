import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GENERIC_ANCHORS, normalizeAnchorText } from '../../../server/src/checks/links/generic-anchors.js';
import { SITE, makeLink, makePage } from '../../helpers/factories.js';
import { audit, findingsFor, makeRawLink, statFor } from './support.js';

/** @import { PageRecord } from '../../../server/src/types.js' */

const errorPage = (/** @type {string} */ path, /** @type {Partial<PageRecord>} */ extra = {}) =>
  makePage({ url: `${SITE}${path}`, status: 404, indexability: { indexable: false, reasons: ['status_404'] }, ...extra });

// ───────────── links.anchor.uncrawlable ─────────────

test('links.anchor.uncrawlable fails on javascript: hrefs that may open a page and on onclick-only links', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeRawLink({ href: 'javascript:openPage(7)', has_onclick: false, line: 21 }),
      makeRawLink({ href: 'JavaScript:goTo("shop")', has_onclick: true }),
      makeRawLink({ href: '  javascript:void(0)  ', has_onclick: true }),
      makeRawLink({ href: '', has_onclick: true, line: 30 }),
      makeRawLink({ href: '', has_onclick: false }),
      makeRawLink({ href: '   ', has_onclick: true }),
      makeRawLink({ href: 'mailto:hi@example.test' }),
      makeLink({ url: `${SITE}/`, href: '#', has_onclick: true }),
      makeLink({ url: `${SITE}/real`, href: '/real', has_onclick: true }),
    ],
  });
  const other = errorPage('/e', { links: [makeRawLink({ href: 'javascript:void(0)' })] });

  const { result } = audit([home, other]);
  const stat = statFor(result, 'links.anchor.uncrawlable');
  assert.equal(stat.applicable, 9);
  assert.equal(stat.failed, 4);
  assert.equal(stat.passed, 5);

  const findings = findingsFor(result, 'links.anchor.uncrawlable');
  assert.deepEqual(
    findings.map((f) => f.selector),
    ['a[href="  javascript:void(0)  "]', 'a[href=""]', 'a[href="JavaScript:goTo(\\"shop\\")"]', 'a[href="javascript:openPage(7)"]'],
  );
  const scriptLink = findings.find((f) => f.selector === 'a[href="javascript:openPage(7)"]');
  assert.equal(scriptLink?.line, 21);
  assert.deepEqual(scriptLink?.evidence.observed, { href: 'javascript:openPage(7)', has_onclick: false });
  assert.equal(scriptLink?.evidence.detail, 'The href is a javascript: URL.');
  const onclick = findings.find((f) => f.selector === 'a[href=""]');
  assert.equal(onclick?.line, 30);
  assert.match(onclick?.evidence.detail ?? '', /no href.*onclick/);
});

test('links.anchor.uncrawlable fails on vbscript: and data: hrefs, read as browsers read them', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeRawLink({ href: 'vbscript:msgbox("hi")', line: 4 }),
      makeRawLink({ href: 'data:text/html;base64,PGgxPmhpPC9oMT4=', line: 5 }),
      makeRawLink({ href: ' DATA:text/plain,x' }),
      makeRawLink({ href: 'java\nscript:location.assign("/a")' }),
      makeRawLink({ href: '\tjavascript:openPage(2)' }),
    ],
  });
  const { result } = audit([home]);
  const stat = statFor(result, 'links.anchor.uncrawlable');
  assert.equal(stat.applicable, 5);
  assert.equal(stat.failed, 5);
  const findings = findingsFor(result, 'links.anchor.uncrawlable');
  assert.deepEqual(findings.map((f) => f.evidence.detail).sort(), [
    'The href is a data: URL.', 'The href is a data: URL.', 'The href is a javascript: URL.', 'The href is a javascript: URL.', 'The href is a vbscript: URL.',
  ]);
  assert.equal(findings.find((f) => f.line === 4)?.evidence.detail, 'The href is a vbscript: URL.');
});

test('links.anchor.uncrawlable passes links to other programs and paths that only look like a scheme', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeRawLink({ href: 'mailto:hi@example.test' }),
      makeRawLink({ href: 'tel:+15551234567' }),
      makeRawLink({ href: 'sms:+15551234567' }),
      makeRawLink({ href: 'ftp://files.example.test/a.zip' }),
      makeLink({ url: `${SITE}/data/report.html`, href: 'data/report.html' }),
      makeLink({ url: `${SITE}/javascript-guide`, href: 'javascript-guide' }),
      makeLink({ url: `${SITE}/vbscript:x`, href: './vbscript:x' }),
      makeLink({ url: `${SITE}/data:x`, href: '/data:x' }),
    ],
  });
  const { result } = audit([home]);
  const stat = statFor(result, 'links.anchor.uncrawlable');
  assert.equal(stat.applicable, 8);
  assert.equal(stat.failed, 0);
});

test('links.anchor.uncrawlable passes ordinary links', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [makeLink({ url: `${SITE}/a`, href: '/a' }), makeLink({ url: 'https://other.test/', href: 'https://other.test/' })],
  });
  const { result } = audit([home]);
  const stat = statFor(result, 'links.anchor.uncrawlable');
  assert.equal(stat.applicable, 2);
  assert.equal(stat.failed, 0);
});

// ───────────── links.anchor.empty ─────────────

test('links.anchor.empty fails when a link has no text, no aria-label and no title attribute', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/icon`, href: '/icon', text: '', aria_label: null, line: 18 }),
      makeLink({ url: `${SITE}/named`, href: '/named', text: 'Pricing' }),
      makeLink({ url: `${SITE}/labelled`, href: '/labelled', text: '', aria_label: 'Open the menu' }),
      makeLink({ url: `${SITE}/image`, href: '/image', text: 'Company logo', aria_label: null }),
      makeLink({ url: `${SITE}/titled`, href: '/titled', text: '', aria_label: null, title_attr: 'Open the cart' }),
      makeLink({ url: 'https://other.test/', href: 'https://other.test/', text: '' }),
      makeRawLink({ href: 'javascript:void(0)', text: '', aria_label: null }),
      makeRawLink({ href: '', text: '', has_onclick: true }),
    ],
  });
  const other = makePage({
    url: `${SITE}/error`,
    status: 404,
    indexability: { indexable: false, reasons: ['status_404'] },
    links: [makeLink({ url: `${SITE}/x`, href: '/x', text: '' })],
  });

  const { result } = audit([home, other]);
  const stat = statFor(result, 'links.anchor.empty');
  // Six links have a URL. Links without a URL and links on non-html pages are not units.
  assert.equal(stat.applicable, 6);
  assert.equal(stat.failed, 2);
  assert.equal(stat.passed, 4);

  const findings = findingsFor(result, 'links.anchor.empty');
  assert.deepEqual(findings.map((f) => f.selector), ['a[href="/icon"]', 'a[href="https://other.test/"]']);
  assert.equal(findings[1].url, `${SITE}/`);
  const icon = findings.find((f) => f.selector === 'a[href="/icon"]');
  assert.equal(icon?.line, 18);
  assert.equal(icon?.severity, 'medium');
  assert.deepEqual(icon?.evidence.observed, { text: '', aria_label: null, title_attr: null, target_url: `${SITE}/icon` });
  assert.equal(icon?.evidence.expected, 'Visible text, image alt text, an aria-label or a title attribute');
});

test('links.anchor.empty passes a link that has text, an aria-label or a title attribute', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/text`, href: '/text', text: 'About', aria_label: null, title_attr: null }),
      makeLink({ url: `${SITE}/aria`, href: '/aria', text: '', aria_label: 'Basket', title_attr: null }),
      makeLink({ url: `${SITE}/title`, href: '/title', text: '', aria_label: null, title_attr: 'Contact us' }),
    ],
  });
  const { result } = audit([home]);
  const stat = statFor(result, 'links.anchor.empty');
  assert.equal(stat.applicable, 3);
  assert.equal(stat.passed, 3);
  assert.equal(stat.failed, 0);
});

test('links.anchor.empty names a link with a quote in its href with an escaped selector', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [makeLink({ url: `${SITE}/q`, href: '/q"x"\\y', text: '' })],
  });
  const { result } = audit([home]);
  assert.deepEqual(findingsFor(result, 'links.anchor.empty').map((f) => f.selector), ['a[href="/q\\"x\\"\\\\y"]']);
});

// ───────────── links.anchor.generic ─────────────

test('links.anchor.generic fails on generic text in each supported language', () => {
  const generic = [
    'Click here',
    '  READ   MORE »',
    'Learn more...',
    'Buraya tıklayın.',
    'TIKLAYIN',
    'İncele',
    'Devamını oku',
    'Hier klicken',
    'Weiterlesen',
    'Haz clic aquí',
    'Más',
    'En savoir plus !',
    'Lire la suite →',
  ];
  const links = generic.map((text, index) => makeLink({ url: `${SITE}/p${index}`, href: `/p${index}`, text, line: index + 1 }));
  const home = makePage({ url: `${SITE}/`, links });

  const { result } = audit([home]);
  const stat = statFor(result, 'links.anchor.generic');
  assert.equal(stat.applicable, generic.length);
  assert.equal(stat.failed, generic.length);

  const findings = findingsFor(result, 'links.anchor.generic');
  assert.equal(findings.length, generic.length);
  assert.ok(findings.every((f) => f.severity === 'info' && f.weight === 0 && f.confidence === 'likely'));
  const first = findings.find((f) => f.selector === 'a[href="/p0"]');
  assert.deepEqual(first?.evidence.observed, { text: 'Click here', target_url: `${SITE}/p0` });
  assert.equal(first?.line, 1);
});

test('links.anchor.generic passes descriptive text and skips links without text or URL', () => {
  const home = makePage({
    url: `${SITE}/`,
    links: [
      makeLink({ url: `${SITE}/a`, href: '/a', text: 'Read our pricing guide' }),
      makeLink({ url: `${SITE}/b`, href: '/b', text: 'Contact' }),
      makeLink({ url: `${SITE}/c`, href: '/c', text: 'Click here for the pricing guide' }),
      makeLink({ url: `${SITE}/d`, href: '/d', text: '→' }),
      makeLink({ url: `${SITE}/empty`, href: '/empty', text: '' }),
      makeRawLink({ href: 'mailto:hi@example.test', text: 'click here' }),
    ],
  });
  const other = makePage({
    url: `${SITE}/error`,
    status: 404,
    indexability: { indexable: false, reasons: ['status_404'] },
    links: [makeLink({ url: `${SITE}/x`, href: '/x', text: 'here' })],
  });

  const { result } = audit([home, other]);
  const stat = statFor(result, 'links.anchor.generic');
  assert.equal(stat.applicable, 4);
  assert.equal(stat.failed, 0);
  assert.equal(findingsFor(result, 'links.anchor.generic').length, 0);
});

test('normalizeAnchorText lower-cases, drops punctuation and folds Turkish i', () => {
  assert.equal(normalizeAnchorText('  Click   HERE!! '), 'click here');
  assert.equal(normalizeAnchorText('Read more »'), 'read more');
  assert.equal(normalizeAnchorText('Learn more…'), 'learn more');
  assert.equal(normalizeAnchorText('TIKLAYIN'), normalizeAnchorText('tıklayın'));
  assert.equal(normalizeAnchorText('İNCELE'), normalizeAnchorText('incele'));
  assert.equal(normalizeAnchorText('Aquí'), normalizeAnchorText('aquí'));
});

test('the generic anchor list holds every phrase from the spec', () => {
  const spec = [
    'click here', 'here', 'read more', 'more', 'learn more', 'this', 'link', 'this link', 'this page',
    'continue', 'continue reading', 'details', 'more info', 'more information',
    'tıklayın', 'buraya tıklayın', 'burada', 'buraya', 'devamı', 'devamını oku', 'daha fazla', 'detaylar', 'incele',
    'hier', 'hier klicken', 'mehr', 'weiterlesen', 'mehr erfahren',
    'aquí', 'haz clic aquí', 'leer más', 'más', 'ver más',
    'ici', 'cliquez ici', 'lire la suite', 'en savoir plus', 'plus',
  ];
  assert.equal(spec.length, 38);
  for (const phrase of spec) assert.ok(GENERIC_ANCHORS.has(normalizeAnchorText(phrase)), phrase);
  assert.equal(GENERIC_ANCHORS.size, 38);
});
