// What a visitor meets on arrival: zooming on a phone, and redirects to a page
// that asks for consent or input before the content (sxo module). Pure.

/** @import { CheckDef, CheckResult, PageRecord } from '../../types.js' */

import { clip } from '../../util/strings.js';
import { normalizeUrl } from '../../util/url.js';
import { DOCS, SXO } from './helpers.js';

/** axe's `meta-viewport` rule: `maximum-scale` below 2 disables zooming (its option `scaleMinimum`). */
export const SCALE_MINIMUM = 2;
const SCALABLE_WORDS = new Set(['yes', 'device-width', 'device-height']);
const MAXIMUM_WORDS = new Set(['device-width', 'device-height']);
/** Internal URLs that must redirect to one page before it is called a gate. */
export const GATE_SOURCES = 3;
/**
 * Words of a target's path that make it something other than a consent or input wall in front of content: a sign-on
 * page (content behind it is not public), a checkout or cart (the sources are shop actions, not pages), or an error
 * page (the sources are gone). Read as whole words of the path, split at every character that is not a letter or
 * digit and at a change from lower to upper case, so `/saml2/idp/SSOService.php` reads "saml2 idp sso service php".
 */
const NOT_A_GATE = new Set([
  'login', 'signin', 'signon', 'sso', 'saml', 'saml2', 'oauth', 'oauth2', 'openid', 'idp', 'auth', 'authorize', 'authentication', 'account',
  'accounts', 'myaccount', 'password', 'giris', 'anmelden', 'connexion', 'accedi', 'checkout', 'cart', 'basket', 'sepet', 'warenkorb', 'kasse',
  'panier', 'carrito', 'error', 'notfound', '404', '410', '500', 'hata', 'fehler', 'erreur',
]);
const NOT_A_GATE_PAIRS = ['sign in', 'log in', 'wp login', 'my account', 'iniciar sesion', 'uye girisi', 'not found'];

/**
 * True when a target's path names a sign-on page, a checkout or cart, or an error page.
 * @param {string} pathname
 */
export function isNotAGate(pathname) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Read as written.
  }
  const words = decoded.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const text = ` ${words.join(' ')} `;
  return words.some((word) => NOT_A_GATE.has(word)) || NOT_A_GATE_PAIRS.some((pair) => text.includes(` ${pair} `));
}
const MAX_EXAMPLES = 5;

/**
 * What in a viewport `content` disables zooming, as axe reads it, or null: the
 * value is split at commas and semicolons into `key=value` pairs; `user-scalable`
 * fails when its number is between -1 and 1 or it is a word other than yes,
 * device-width or device-height; `maximum-scale` fails when it is below 2 or a
 * word other than device-width or device-height; a negative value is ignored.
 * @param {string} content
 * @returns {string|null}
 */
export function zoomBlocker(content) {
  for (const item of content.toLowerCase().split(/[;,]/)) {
    const [key, value] = item.split('=').map((part) => part.trim());
    if (!key || !value) continue;
    const number = Number.parseFloat(value);
    if (key === 'user-scalable' && ((Number.isNaN(number) && !SCALABLE_WORDS.has(value)) || (number > -1 && number < 1))) return `user-scalable=${clip(value, 40)}`;
    if (key === 'maximum-scale' && !(number < 0) && ((Number.isNaN(number) && !MAXIMUM_WORDS.has(value)) || number < SCALE_MINIMUM)) return `maximum-scale=${clip(value, 40)}`;
  }
  return null;
}

/** @type {CheckDef} */
const zoomDisabled = {
  ...SXO,
  id: 'sxo.mobile.zoom_disabled',
  title: 'Viewport stops visitors from zooming',
  description:
    'Checks the viewport meta tag of html pages for user-scalable=no (or 0) or a maximum-scale below 2, which keep visitors on a phone from enlarging the text. WCAG 1.4.4 (level AA) asks that text can be resized up to 200 percent; axe\'s meta-viewport rule fails these values.',
  severity: 'low',
  weight: 2,
  impact: 2,
  effort: 1,
  confidence: 'confirmed',
  scope: 'page',
  requires: [],
  doc_ref: DOCS.AXE_META_VIEWPORT,
  recommendation: 'Remove user-scalable=no and maximum-scale from the viewport meta tag; width=device-width, initial-scale=1 is enough.',
  run(ctx) {
    /** @type {CheckResult[]} */
    const results = [];
    for (const page of ctx.htmlPages) {
      if (page.viewport === null) continue;
      const blocker = zoomBlocker(page.viewport);
      results.push(blocker === null ? { status: 'pass', url: page.url } : {
        status: 'fail', url: page.url, selector: 'meta[name="viewport"]',
        evidence: { observed: { viewport: clip(page.viewport, 200), blocks_zoom: blocker }, expected: `No user-scalable=no and a maximum-scale of ${SCALE_MINIMUM} or more` },
      });
    }
    return results;
  },
};

/**
 * The names of the query parameters of `target` that carry `source`: its whole
 * URL, its path with the query, or its path (decoded once or twice).
 * @param {string} source @param {URL} target
 * @returns {string[]}
 */
function carriers(source, target) {
  const from = new URL(source);
  const forms = new Set([source, `${from.pathname}${from.search}`, from.pathname].filter((form) => form !== '/'));
  /** @type {string[]} */
  const names = [];
  for (const [name, value] of target.searchParams) {
    let decoded = value;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      // Compared as decoded once.
    }
    const candidates = [value, decoded].flatMap((text) => [text, normalizeUrl(text, source) ?? text]);
    if (candidates.some((text) => forms.has(text))) names.push(name);
  }
  return names;
}

/**
 * @param {PageRecord} page
 * @returns {URL|null} Where a redirect record ends, when it is a redirect that ended somewhere.
 */
function redirectEnd(page) {
  if (page.redirect_chain.length === 0 || page.final_url === page.url) return null;
  try {
    return new URL(page.final_url);
  } catch {
    return null;
  }
}

/** @type {CheckDef} */
const redirectGate = {
  ...SXO,
  id: 'sxo.interstitial.redirect_gate',
  title: 'Several pages redirect to one page that carries their address',
  description:
    `Checks for a page that ${GATE_SOURCES} or more internal URLs (the start page included) redirect to, each with the URL it came from in the query (returnUrl, redirect, next…), on the site or off it: the pattern of a wall that asks for consent, an age, a language or a subscription before the content. Google: "Don't redirect the user to a separate page for their consent or input", and "Redirecting all URLs to a single page will remove all but that one page from search results, as Googlebot can only fetch that page." A sign-on page, a checkout or cart, and an error page are left out, and so is a target that answered with an error. What the page asks cannot be seen without visiting it as a person, which is why the finding is likely.`,
  severity: 'high',
  weight: 4,
  impact: 3,
  effort: 2,
  confidence: 'likely',
  scope: 'site',
  requires: [],
  doc_ref: DOCS.GOOGLE_INTERSTITIALS,
  recommendation: 'Let each of these pages answer at its own address. If visitors must answer something first, ask it on the page itself (a banner or dialog that leaves the content readable) instead of redirecting them, so that search engines can reach every page.',
  run(ctx) {
    /** @type {Map<string, {source: string, carriers: string[]}[]>} */
    const byTarget = new Map();
    for (const page of ctx.pages) {
      const end = redirectEnd(page);
      if (end === null || !/^https?:$/.test(end.protocol) || isNotAGate(end.pathname) || page.final_status >= 400) continue;
      const key = `${end.origin}${end.pathname}`;
      const list = byTarget.get(key) ?? [];
      if (!list.some((entry) => entry.source === page.url)) list.push({ source: page.url, carriers: carriers(page.url, end) });
      byTarget.set(key, list);
    }
    /** @type {CheckResult[]} */
    const results = [];
    for (const [target, sources] of [...byTarget].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (sources.length < GATE_SOURCES || normalizeUrl(target) === null) continue;
      const gated = sources.filter((entry) => entry.carriers.length > 0).sort((a, b) => (a.source < b.source ? -1 : 1));
      results.push(gated.length < GATE_SOURCES ? { status: 'pass', url: target, selector: target } : {
        status: 'fail', url: target, selector: target, related_urls: gated.map((entry) => entry.source).slice(0, 20),
        evidence: {
          observed: { sources: gated.length, parameters: [...new Set(gated.flatMap((entry) => entry.carriers))].slice(0, 5).map((name) => clip(name, 40)), examples: gated.slice(0, MAX_EXAMPLES).map((entry) => clip(entry.source, 300)) },
          detail: `${gated.length} internal URLs redirect to this page, each carrying its own address in the query.`,
          expected: 'Each page readable at its own address',
        },
      });
    }
    return results;
  },
};

export const experienceChecks = [zoomDisabled, redirectGate];
