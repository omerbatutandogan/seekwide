// links.internal.redirect and temporary redirects (validation of 2026-11-12,
// fix 8). The records model redirects real sites use on purpose: an app entry
// that sends a visitor who is not logged in to a login page that returns them
// (307, 307, `/login?next=%2Fdashboard`), a home page routed to a regional
// edition (302), and an add-to-cart action (302). Permanent redirects stay
// confirmed findings.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SITE, makeLink, makePage, makeRedirect } from '../../helpers/factories.js';
import { audit, findingsFor, statFor } from './support.js';

/** @param {string} path @param {...[number, string]} hops  Status and location of each hop. */
function redirect(path, ...hops) {
  const url = `${SITE}${path}`;
  let from = url;
  const chain = hops.map(([status, location]) => {
    const hop = { url: from, status, location: `${SITE}${location}` };
    from = hop.location;
    return hop;
  });
  return makeRedirect(url, from, { status: chain[0].status, redirect_chain: chain });
}

const targets = [
  redirect('/dashboard', [307, '/auth-redirect/dashboard'], [307, '/login?next=%2Fdashboard']),
  redirect('/account', [302, '/login?redirect_to=https%3A%2F%2Fexample.test%2Faccount%2F']),
  redirect('/', [302, '/europe']),
  redirect('/cart/?add-to-cart=7', [302, '/checkout/']),
  redirect('/members', [302, '/login']),
  redirect('/about', [301, '/about/']),
  redirect('/team', [301, '/people'], [302, '/people/']),
  redirect('/old-login', [301, '/login?next=%2Fold-login']),
];
const home = makePage({ url: `${SITE}/home`, links: targets.map((record) => makeLink({ url: record.url, href: new URL(record.url).pathname + new URL(record.url).search })) });

test('a temporary redirect to a page that sends the visitor back is not a unit', () => {
  const { result } = audit([home, ...targets]);
  const stat = statFor(result, 'links.internal.redirect');
  assert.equal(stat.applicable, targets.length - 2, '/dashboard and /account are login gates');
  assert.equal(stat.failed, targets.length - 2);
});

test('other temporary redirects fail as likely, with a sentence that the site can mean them; permanent ones stay confirmed', () => {
  const { result } = audit([home, ...targets]);
  const byTarget = new Map(findingsFor(result, 'links.internal.redirect').map((finding) => [/** @type {any} */ (finding.evidence.observed).target_url, finding]));
  for (const path of ['/', '/cart/?add-to-cart=7', '/members']) {
    const finding = byTarget.get(`${SITE}${path}`);
    assert.equal(finding?.confidence, 'likely', path);
    assert.match(finding?.evidence.detail ?? '', /The redirect is temporary \(302\), which a site can mean \(a login, a region, a cart\)/, path);
  }
  for (const path of ['/about', '/team', '/old-login']) {
    const finding = byTarget.get(`${SITE}${path}`);
    assert.equal(finding?.confidence, 'confirmed', path);
    assert.doesNotMatch(finding?.evidence.detail ?? '', /temporary/, path);
  }
});

test('only a return parameter on the site that names a path or URL makes a gate (review of 2026-11-12)', () => {
  const external = makeRedirect(`${SITE}/exit`, 'https://partner.test/landing?ref=https%3A%2F%2Fexample.test%2Fexit', {
    status: 302, final_external: true, final_status: 0,
    redirect_chain: [{ url: `${SITE}/exit`, status: 302, location: 'https://partner.test/landing?ref=https%3A%2F%2Fexample.test%2Fexit' }],
  });
  const others = [
    external,
    redirect('/old-page', [302, '/new-page?from=%2Fold-page']),
    redirect('/en/products', [302, '/en/?next=products']),
    redirect('/en/account', [302, '/en/login?return_to=%2Fen%2Faccount']),
  ];
  const page = makePage({ url: `${SITE}/home`, links: others.map((record) => makeLink({ url: record.url, href: new URL(record.url).pathname })) });
  const { result } = audit([page, ...others]);
  const stat = statFor(result, 'links.internal.redirect');
  assert.equal(stat.applicable, 3, 'the login with return_to is a gate; the others are units');
  assert.equal(stat.failed, 3);
});
