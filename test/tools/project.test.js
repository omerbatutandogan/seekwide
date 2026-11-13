import assert from 'node:assert/strict';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { ToolError } from '../../plugin/server/src/mcp/stdio.js';
import { createTools } from '../../plugin/server/src/tools/index.js';
import { PROJECT_NOTE } from '../../plugin/server/src/tools/project.js';
import { topGroups } from '../../plugin/server/src/tools/audit-summary.js';
import { makePage } from '../helpers/factories.js';
import { makeFinding } from '../helpers/run-factory.js';
import { HTML_FIXTURE, NEXT_FIXTURE, makeTree } from '../helpers/repo.js';
import { jobFor, makeDeps, sampleCrawl, toolNamed } from './fakes.js';

/** The static-server command uses `python` on Windows and `python3` elsewhere (see repo/detect.js). */
const PYTHON = process.platform === 'win32' ? 'python' : 'python3';

const ORIGIN = 'http://localhost:3000';

/** @type {Awaited<ReturnType<typeof makeTree>>} */
let tree;
before(async () => {
  tree = await makeTree({
    'index.html': '<!doctype html>\n<html lang="en">\n<head>\n</head>\n<body><p>Home</p></body>\n</html>\n',
    'apps/web/package.json': JSON.stringify({ dependencies: { next: '15' }, scripts: { dev: 'next dev' } }),
    'apps/web/app/layout.tsx': '',
    'apps/web/app/page.tsx': '',
    'apps/web/app/about/page.tsx': '',
    'apps/astro/package.json': JSON.stringify({ dependencies: { astro: '5' } }),
  });
});
after(() => tree.remove());

/**
 * A local crawl of two pages without titles, and the tools over it.
 * @param {{local?: boolean, defaultDir?: string}} [options]
 */
function setup({ local = true, defaultDir } = {}) {
  const crawl = sampleCrawl({
    start_url: `${ORIGIN}/`, site_origin: ORIGIN, site_host: 'localhost:3000',
    options: { max_pages: 25, rate_per_sec: 1, include_subdomains: false, local },
    pages: [makePage({ url: `${ORIGIN}/`, titles: [] }), makePage({ url: `${ORIGIN}/about`, depth: 1, titles: [] })],
  });
  const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
  fake.deps.defaultProjectDir = () => defaultDir ?? tree.dir;
  const tools = createTools(fake.deps);
  return { fake, detect: toolNamed(tools, 'project_detect'), audit: toolNamed(tools, 'audit_run'), query: toolNamed(tools, 'findings_query') };
}

/** @param {Promise<unknown>} call @param {RegExp} pattern */
async function refused(call, pattern) {
  await assert.rejects(call, (error) => {
    assert.ok(error instanceof ToolError, `expected a ToolError, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  });
}

describe('project_detect', () => {
  it('describes a Next.js App Router project: command, address and routes', async () => {
    const result = /** @type {any} */ (await setup({ defaultDir: NEXT_FIXTURE }).detect.handler({}));
    assert.equal(result.project_dir, NEXT_FIXTURE);
    assert.equal(result.source_dir, NEXT_FIXTURE);
    assert.deepEqual([result.framework, result.label, result.supported, result.app_dir], ['next-app', 'Next.js (App Router)', true, 'app']);
    assert.deepEqual(result.dev_server, {
      command: 'npm run dev', script: 'next dev', script_clipped: false, also_runs: [], default_url: 'http://localhost:3000', package_manager: 'npm', dependencies_installed: false, cwd: NEXT_FIXTURE,
    });
    assert.equal(result.routes_total, 10);
    assert.deepEqual(result.routes, [
      { route: '/', file: 'app/page.jsx', kind: 'page' },
      { route: '/about', file: 'app/(marketing)/about/page.jsx', kind: 'page' },
      { route: '/api/health', file: 'app/api/health/route.js', kind: 'handler' },
      { route: '/blog', file: 'app/blog/page.jsx', kind: 'page' },
      { route: '/blog/[slug]', file: 'app/blog/[slug]/page.jsx', kind: 'page' },
      { route: '/docs/[[...path]]', file: 'app/docs/[[...path]]/page.jsx', kind: 'page' },
      { route: '/legacy.html', file: 'public/legacy.html', kind: 'public' },
      { route: '/pricing', file: 'app/(marketing)/pricing/page.jsx', kind: 'page' },
      { route: '/robots.txt', file: 'app/robots.js', kind: 'metadata' },
      { route: '/sitemap.xml', file: 'app/sitemap.js', kind: 'metadata' },
    ]);
    assert.equal(result.routes_truncated, false);
    assert.equal(result._note, PROJECT_NOTE);
  });

  it('describes a plain HTML project', async () => {
    const result = /** @type {any} */ (await setup({ defaultDir: HTML_FIXTURE }).detect.handler({}));
    assert.deepEqual([result.framework, result.supported], ['html', true]);
    assert.equal(result.dev_server.command, `${PYTHON} -m http.server 4173 --bind 127.0.0.1`);
    assert.equal(result.dev_server.cwd, HTML_FIXTURE);
    assert.deepEqual(result.routes.map((/** @type {{file: string}} */ r) => r.file), ['about.html', 'blog/index.html', 'contact.html', 'index.html', 'services.html']);
  });

  it('looks at a folder inside the project when source_dir names one', async () => {
    const result = /** @type {any} */ (await setup().detect.handler({ source_dir: path.join(tree.dir, 'apps', 'web') }));
    assert.equal(result.framework, 'next-app');
    assert.equal(result.source_dir, path.join(tree.dir, 'apps', 'web'));
    assert.equal(result.dev_server.cwd, path.join(tree.dir, 'apps', 'web'));
    assert.deepEqual(result.routes.map((/** @type {{route: string}} */ r) => r.route), ['/', '/about']);
  });

  it('reports a project it cannot map in plain words, without failing', async () => {
    const result = /** @type {any} */ (await setup().detect.handler({ source_dir: path.join(tree.dir, 'apps', 'astro') }));
    assert.deepEqual([result.framework, result.supported, result.label], ['unsupported', false, 'Astro']);
    assert.match(result.message, /^This project uses Astro, which is not supported yet\./);
    assert.equal(result.dev_server.command, null);
    assert.deepEqual(result.routes, []);
  });

  it('refuses a folder outside the project, a missing folder and a relative path, and says what to pass', async () => {
    const { detect } = setup();
    await refused(detect.handler({ source_dir: path.dirname(tree.dir) }), /source_dir must be the project folder .* or a folder inside it\. Pass the folder that holds the web project/);
    await refused(detect.handler({ source_dir: path.join(tree.dir, 'nope') }), /does not exist or is not a directory/);
    await refused(detect.handler({ source_dir: 'apps/web' }), /source_dir must be an absolute path \(got "apps\/web"\)/);
    await refused(detect.handler({ project_dir: 'relative' }), /project_dir must be an absolute path/);
    await refused(detect.handler({ project_dir: path.join(tree.dir, 'nope') }), /does not exist or is not a directory/);
  });
});

describe('audit_run with source_dir', () => {
  it('adds the source file to each finding, stores it, and returns it from findings_query', async () => {
    const { fake, audit, query } = setup();
    const dir = path.join(tree.dir, 'apps', 'web');
    const result = /** @type {any} */ (await audit.handler({ job_id: 'c-1', modules: ['seo'], check_core_web_vitals: false, source_dir: dir }));

    assert.deepEqual(result.repo, { framework: 'next-app', label: 'Next.js (App Router)', source_dir: 'apps/web', findings_with_source: 2, pages_matched: 2, pages_total: 2 });
    assert.deepEqual(result.top[0].example_files, ['apps/web/app/page.tsx', 'apps/web/app/about/page.tsx']);
    assert.match(result.notes.join('\n'), /For a Next\.js project the source file is the page file of the route/);

    const [run] = fake.runs;
    assert.deepEqual(run.repo, result.repo);
    assert.deepEqual(run.findings.map((f) => [f.url, f.source]), [
      [`${ORIGIN}/`, { file: 'apps/web/app/page.tsx', line: null, route: '/' }],
      [`${ORIGIN}/about`, { file: 'apps/web/app/about/page.tsx', line: null, route: '/about' }],
    ]);

    const listed = /** @type {any} */ (await query.handler({}));
    assert.deepEqual(listed.findings.map((/** @type {any} */ f) => f.source.file), ['apps/web/app/page.tsx', 'apps/web/app/about/page.tsx']);
  });

  it('gives a finding the same id with and without a source', async () => {
    const plain = setup();
    await plain.audit.handler({ job_id: 'c-1', modules: ['seo'], check_core_web_vitals: false });
    const mapped = setup();
    await mapped.audit.handler({ job_id: 'c-1', modules: ['seo'], check_core_web_vitals: false, source_dir: path.join(tree.dir, 'apps', 'web') });
    assert.deepEqual(mapped.fake.runs[0].findings.map((f) => f.id), plain.fake.runs[0].findings.map((f) => f.id));
    assert.deepEqual(mapped.fake.runs[0].findings.map(({ source, ...rest }) => rest), plain.fake.runs[0].findings);
  });

  it('is an ordinary audit without source_dir: no source on any finding, repo is null', async () => {
    const { fake, audit } = setup();
    const result = /** @type {any} */ (await audit.handler({ job_id: 'c-1', modules: ['seo'], check_core_web_vitals: false }));
    assert.equal(result.repo, null);
    assert.equal(fake.runs[0].repo, null);
    assert.equal(fake.runs[0].findings.some((f) => 'source' in f), false);
    assert.equal('example_files' in result.top[0], false);
  });

  it('treats an empty source_dir as none', async () => {
    const { fake, audit } = setup();
    const result = /** @type {any} */ (await audit.handler({ job_id: 'c-1', modules: ['seo'], check_core_web_vitals: false, source_dir: '' }));
    assert.equal(result.repo, null);
    assert.equal(fake.runs[0].findings.some((f) => 'source' in f), false);
  });

  it('still audits a project it cannot map, and says why no file is named', async () => {
    const { fake, audit } = setup();
    const result = /** @type {any} */ (await audit.handler({ job_id: 'c-1', modules: ['seo'], check_core_web_vitals: false, source_dir: path.join(tree.dir, 'apps', 'astro') }));
    assert.equal(result.totals.findings, 2);
    assert.deepEqual(result.repo, { framework: 'unsupported', label: 'Astro', source_dir: 'apps/astro', findings_with_source: 0, pages_matched: 0, pages_total: 2 });
    assert.equal(fake.runs[0].findings.some((f) => 'source' in f), false);
    assert.match(result.notes.join('\n'), /Findings were not mapped to source files\. This project uses Astro, which is not supported yet\./);
  });

  it('refuses source_dir for a crawl that was not of a site on this machine', async () => {
    const { fake, audit } = setup({ local: false });
    await refused(audit.handler({ job_id: 'c-1', source_dir: tree.dir }), /source_dir is for an audit of the project's own local server, and this crawl was of http:\/\/localhost:3000\. Call audit_run again without source_dir/);
    assert.equal(fake.runs.length, 0);
    assert.equal(fake.calls.checkExternalLinks, undefined);
  });

  it('refuses a crawl file that does not say whether the site was local', async () => {
    const { fake, audit } = setup();
    const crawl = /** @type {any} */ (await fake.deps.crawlManager.result('c-1'));
    delete crawl.options.local;
    await refused(audit.handler({ job_id: 'c-1', source_dir: tree.dir }), /source_dir is for an audit of the project's own local server/);
  });

  it('refuses a source folder outside the project before anything is requested or saved', async () => {
    const { fake, audit } = setup();
    await refused(audit.handler({ job_id: 'c-1', source_dir: path.dirname(tree.dir) }), /or a folder inside it/);
    await refused(audit.handler({ job_id: 'c-1', source_dir: 'apps/web' }), /must be an absolute path/);
    assert.equal(fake.runs.length, 0);
    assert.equal(fake.calls.checkExternalLinks, undefined);
  });
});

describe('topGroups', () => {
  it('lists up to three distinct source files of a group, and leaves the field out when there are none', () => {
    const withFiles = ['a', 'b', 'a', 'c', 'd'].map((name) => makeFinding({ url: `https://example.test/${name}`, source: { file: `${name}.html`, line: 1, route: `/${name}` } }));
    assert.deepEqual(topGroups(withFiles, 5)[0].example_files, ['a.html', 'b.html', 'c.html']);
    assert.equal('example_files' in topGroups([makeFinding()], 5)[0], false);
  });
});
