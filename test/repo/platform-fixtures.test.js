// Repo mode on the platform fixtures: Next.js 16 in TypeScript with src/app,
// generateMetadata and dynamic routes (fixtures/next-ts), and an npm workspaces
// monorepo whose site is in apps/web (fixtures/monorepo). The served pages are
// written out by hand after what `next dev` of Next.js 16.4.6 sent for these
// fixtures, so no test installs or starts Next.js.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { buildContext, runChecks } from '../../plugin/server/src/checks/engine.js';
import { allChecks } from '../../plugin/server/src/checks/registry.js';
import { createToolDeps } from '../../plugin/server/src/deps.js';
import { planFixes } from '../../plugin/server/src/repo/fixes.js';
import { attachSources, loadProjectSources } from '../../plugin/server/src/repo/sources.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { MONOREPO_FIXTURE, NEXT_TS_FIXTURE, crawlLocal, startServer } from '../helpers/repo.js';
import { makeRun } from '../helpers/run-factory.js';

const SITE = 'https://www.example.com';
const WORDS = 'word '.repeat(150);

/** @type {string} */
let dataDir;
before(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'seekwide-platform-'));
});
after(() => rm(dataDir, { recursive: true, force: true }));

/**
 * A page as Next.js sends it to the crawler: metadata in <head>, the layout's
 * navigation, then the page.
 * @param {{title: string, description: string, canonical?: string, nav: string, body: string}} page
 */
const nextPage = ({ title, description, canonical, nav, body }) => ({
  body: `<!DOCTYPE html><html lang="en"><head><meta charSet="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${title}</title><meta name="description" content="${description}"/>${
    canonical === undefined ? '' : `<link rel="canonical" href="{origin}${canonical}"/>`
  }<meta property="og:title" content="${title}"/><meta property="og:image" content="{origin}/og.png"/></head><body>${nav}${body}</body></html>`,
});

/**
 * Crawl what `routes` serve, run every check, map the findings to the project and plan the fixes.
 * @param {Parameters<typeof startServer>[0]} routes
 * @param {string} projectDir
 * @param {string} [sourceDir]
 */
async function auditAndPlan(routes, projectDir, sourceDir) {
  const server = await startServer(routes);
  try {
    const crawl = await crawlLocal(server.origin, dataDir);
    const sources = await loadProjectSources(projectDir, sourceDir);
    const audited = runChecks(allChecks(), buildContext(crawl, {}), { detectedAt: '2026-11-12T00:00:00.000Z' });
    const mapped = await attachSources(audited.findings, crawl, sources);
    const plan = planFixes({ run: makeRun({ findings: mapped.findings, site_origin: crawl.site_origin, repo: mapped.summary }), sources, crawl, siteUrl: SITE });
    /** Every finding of `checkId` as `pathname → file [route]`. @param {string} checkId */
    const sourcesOf = (checkId) => mapped.findings
      .filter((finding) => finding.check_id === checkId)
      .map((finding) => `${finding.url === null ? '(site)' : new URL(finding.url).pathname} → ${finding.source ? `${finding.source.file} [${finding.source.route}]${finding.source.line === null ? '' : `:${finding.source.line}`}` : 'none'}`)
      .sort();
    return { crawl, findings: mapped.findings, summary: mapped.summary, notes: mapped.notes, plan, sourcesOf };
  } finally {
    await server.close();
  }
}

describe('Next.js 16, TypeScript, src/app (fixtures/next-ts)', () => {
  const nav = '<nav><a href="/">Home</a> <a href="/about">About</a> <a href="/products">Products</a> <a href="/blog">Blog</a></nav>';
  const DEFAULT = { title: 'Acme Fixture', description: 'Acme Fixture makes widgets. This site is a test fixture with deliberate SEO problems.' };
  /** @type {Awaited<ReturnType<typeof auditAndPlan>>} */
  let run;
  before(async () => {
    run = await auditAndPlan({
      '/': nextPage({ title: 'Acme Fixture: widgets for testing audits', description: 'The home page.', canonical: '/', nav, body: `<main><h1>Widgets</h1><p>${WORDS}</p></main>` }),
      '/about': nextPage({ ...DEFAULT, nav, body: `<main><h1>About Acme Fixture</h1><p>${WORDS} about</p></main>` }),
      '/products': nextPage({ ...DEFAULT, nav, body: `<main><h1>Products</h1><p>${WORDS} products</p><a href="/products/alpha">Alpha Widget</a> <a href="/products/beta">Beta Widget</a></main>` }),
      '/products/alpha': nextPage({ ...DEFAULT, title: 'Alpha Widget | Acme Fixture', nav, body: `<main><h1>Alpha Widget</h1><p>${WORDS} alpha</p></main>` }),
      '/products/beta': nextPage({ ...DEFAULT, title: 'Beta Widget | Acme Fixture', nav, body: `<main><h1>Beta Widget</h1><p>${WORDS} beta</p></main>` }),
      '/blog': nextPage({ title: 'Blog | Acme Fixture', description: 'Posts.', canonical: '/blog', nav, body: `<main><h1>Blog</h1><p>${WORDS} blog</p><a href="/blog/hello-widgets">Hello</a> <a href="/blog/deleted-post">Deleted</a></main>` }),
      '/blog/hello-widgets': nextPage({ title: 'Hello, widgets | Acme Fixture', description: 'Hello, widgets: a post.', canonical: '/blog/hello-widgets', nav, body: `<article><h1>Hello, widgets</h1><p>${WORDS} hello</p></article>` }),
      '/blog/deleted-post': { status: 404, ...nextPage({ title: '404: This page could not be found.', description: DEFAULT.description, nav, body: '<h1>404</h1>' }) },
      '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-Agent: *\nAllow: /\n' },
    }, NEXT_TS_FIXTURE);
  });

  it('detects the App Router in src/app and lists its routes, dynamic ones included', async () => {
    const sources = await loadProjectSources(NEXT_TS_FIXTURE);
    assert.deepEqual([sources.detection.framework, sources.detection.app_dir, sources.detection.dev_server.command], ['next-app', 'src/app', 'npm run dev']);
    assert.deepEqual(sources.routes.map(({ route, file, kind }) => `${route} ${file} ${kind}`), [
      '/ src/app/page.tsx page',
      '/about src/app/about/page.tsx page',
      '/api/health src/app/api/health/route.ts handler',
      '/blog src/app/blog/page.tsx page',
      '/blog/[slug] src/app/blog/[slug]/page.tsx page',
      '/products src/app/products/page.tsx page',
      '/products/[id] src/app/products/[id]/page.tsx page',
      '/robots.txt src/app/robots.ts metadata',
    ]);
    assert.equal(sources.resolve('/og.png')?.file, 'public/og.png');
    assert.deepEqual(sources.unreadSettings, [], 'next.config.ts sets htmlLimitedBots only');
  });

  it('names the TypeScript page file of each finding, through dynamic routes', () => {
    assert.deepEqual(run.sourcesOf('seo.title.duplicate'), ['/about → src/app/about/page.tsx [/about]', '/products → src/app/products/page.tsx [/products]']);
    assert.deepEqual(run.sourcesOf('seo.canonical.missing'), [
      '/about → src/app/about/page.tsx [/about]',
      '/products → src/app/products/page.tsx [/products]',
      '/products/alpha → src/app/products/[id]/page.tsx [/products/[id]]',
      '/products/beta → src/app/products/[id]/page.tsx [/products/[id]]',
    ]);
    assert.deepEqual(run.sourcesOf('seo.meta_description.duplicate'), [
      '/about → src/app/about/page.tsx [/about]',
      '/products → src/app/products/page.tsx [/products]',
      '/products/alpha → src/app/products/[id]/page.tsx [/products/[id]]',
      '/products/beta → src/app/products/[id]/page.tsx [/products/[id]]',
    ]);
    assert.deepEqual(run.sourcesOf('links.internal.broken'), ['/blog → src/app/blog/page.tsx [/blog]']);
    assert.deepEqual(run.sourcesOf('seo.sitemap.missing'), ['(site) → none'], 'a site-level finding has no file of its own');
    assert.deepEqual([run.summary.pages_matched, run.summary.pages_total], [7, 7]);
  });

  it('plans the fixes in the page files and in generateMetadata of the dynamic route, and a TypeScript sitemap', () => {
    const rows = run.plan.fixes.map((fix) => `${fix.check_id} ${fix.file} dynamic=${fix.dynamic}`).sort();
    assert.deepEqual(rows, [
      'seo.canonical.missing src/app/about/page.tsx dynamic=false',
      'seo.canonical.missing src/app/products/[id]/page.tsx dynamic=true',
      'seo.canonical.missing src/app/products/[id]/page.tsx dynamic=true',
      'seo.canonical.missing src/app/products/page.tsx dynamic=false',
      'seo.meta_description.duplicate src/app/about/page.tsx dynamic=false',
      'seo.meta_description.duplicate src/app/products/[id]/page.tsx dynamic=true',
      'seo.meta_description.duplicate src/app/products/[id]/page.tsx dynamic=true',
      'seo.meta_description.duplicate src/app/products/page.tsx dynamic=false',
      'seo.sitemap.missing null dynamic=undefined',
      'seo.title.duplicate src/app/about/page.tsx dynamic=false',
      'seo.title.duplicate src/app/products/page.tsx dynamic=false',
    ]);
    assert.ok(run.plan.fixes.filter((fix) => fix.file !== null).every((fix) => JSON.stringify(fix.layouts) === '["src/app/layout.tsx"]'));
    const sitemap = run.plan.fixes.find((fix) => fix.type === 'sitemap');
    assert.deepEqual(sitemap?.create?.map((entry) => entry.file), ['src/app/sitemap.ts']);
    assert.deepEqual(sitemap?.edit?.map((entry) => entry.file), ['src/app/robots.ts']);
    assert.deepEqual(run.plan.notFixable, []);
  });
});

describe('a monorepo with the site in apps/web (fixtures/monorepo)', () => {
  const nav = '<nav><a href="/">Home</a> <a href="/pricing">Pricing</a> <a href="/docs/install">Install</a> <a href="/docs/configure">Configure</a></nav>';
  const footer = '<footer><a href="/">Home</a> <a href="/changelog">Changelog</a></footer>';
  const layoutDescription = 'A site that lives in apps/web of a monorepo, used to test Seekwide.';
  /** @type {Awaited<ReturnType<typeof auditAndPlan>>} */
  let run;
  before(async () => {
    run = await auditAndPlan({
      '/': nextPage({ title: 'Monorepo Fixture: a site in apps/web', description: 'The home page.', canonical: '/', nav, body: `<main><h1>A site in a subfolder</h1><p>${WORDS}</p></main>${footer}` }),
      '/pricing': nextPage({ title: 'Pricing | Monorepo Fixture', description: layoutDescription, nav, body: `<main><h1>Pricing</h1><p>${WORDS} pricing</p></main>${footer}` }),
      '/docs/install': nextPage({ title: 'Docs | Monorepo Fixture', description: layoutDescription, nav, body: `<main><h1>install</h1><p>${WORDS} install</p></main>${footer}` }),
      '/docs/configure': nextPage({ title: 'Docs | Monorepo Fixture', description: layoutDescription, nav, body: `<main><h1>configure</h1><p>${WORDS} configure</p></main>${footer}` }),
      '/robots.txt': { headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nAllow: /\n' },
    }, MONOREPO_FIXTURE, path.join(MONOREPO_FIXTURE, 'apps', 'web'));
  });

  it('names files as paths from the repository root, and the catch-all route', () => {
    assert.deepEqual(run.sourcesOf('seo.title.duplicate'), [
      '/docs/configure → apps/web/app/docs/[...slug]/page.jsx [/docs/[...slug]]',
      '/docs/install → apps/web/app/docs/[...slug]/page.jsx [/docs/[...slug]]',
    ]);
    assert.deepEqual(run.sourcesOf('seo.canonical.missing').filter((row) => row.startsWith('/pricing')), ['/pricing → apps/web/app/pricing/page.jsx [/pricing]']);
    // The footer comes from packages/ui; the finding names the page that sent it, as for any shared component.
    assert.ok(run.sourcesOf('links.internal.broken').includes('/pricing → apps/web/app/pricing/page.jsx [/pricing]'));
    assert.equal(run.summary.source_dir, 'apps/web');
    assert.deepEqual([run.summary.pages_matched, run.summary.pages_total], [4, 4]);
  });

  it('plans the sitemap in the web app: a new app/sitemap.js and the robots.txt of its public folder', () => {
    const sitemap = run.plan.fixes.find((fix) => fix.type === 'sitemap');
    assert.deepEqual(sitemap?.create?.map((entry) => entry.file), ['apps/web/app/sitemap.js']);
    assert.deepEqual(sitemap?.edit?.map((entry) => entry.file), ['apps/web/public/robots.txt']);
    const docs = run.plan.fixes.filter((fix) => fix.check_id === 'seo.title.duplicate');
    assert.deepEqual(docs.map((fix) => [fix.file, fix.dynamic, fix.layouts]), [
      ['apps/web/app/docs/[...slug]/page.jsx', true, ['apps/web/app/layout.jsx']],
      ['apps/web/app/docs/[...slug]/page.jsx', true, ['apps/web/app/layout.jsx']],
    ]);
  });

  it('project_detect at the root names the web project to pass as source_dir, and from there the command and folder to run it in', async () => {
    const tools = createTools(createToolDeps({ SEEKWIDE_DATA_DIR: dataDir, CLAUDE_PROJECT_DIR: MONOREPO_FIXTURE }));
    const detect = /** @type {(args: Record<string, unknown>) => Promise<any>} */ (/** @type {any} */ (tools.find((tool) => tool.name === 'project_detect')).handler);
    const root = await detect({});
    assert.deepEqual([root.framework, root.supported], ['none', false]);
    assert.deepEqual(root.workspace_projects, [{ source_dir: path.join(MONOREPO_FIXTURE, 'apps', 'web'), label: 'Next.js (App Router)' }]);
    assert.match(root._note, /workspace_projects/);
    const web = await detect({ source_dir: root.workspace_projects[0].source_dir });
    assert.deepEqual([web.framework, web.app_dir, web.dev_server.command, web.dev_server.cwd], ['next-app', 'app', 'npm run dev', path.join(MONOREPO_FIXTURE, 'apps', 'web')]);
    assert.deepEqual(web.workspace_projects, []);
  });
});
