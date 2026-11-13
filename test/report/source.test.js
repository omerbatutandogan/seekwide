// Repo mode in the reports: the source file of a finding and the scope row.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderHtml } from '../../plugin/server/src/report/html.js';
import { renderMarkdown } from '../../plugin/server/src/report/markdown.js';
import { buildReport } from '../../plugin/server/src/report/model.js';
import { makeFinding, makeRun } from '../helpers/run-factory.js';
import { assertSafeHtml } from './safety.js';

const REPO = { framework: 'next-app', label: 'Next.js (App Router)', source_dir: '.', findings_with_source: 2, pages_matched: 8, pages_total: 8 };

/** @param {unknown[]} sources One finding per entry; undefined leaves the field out. @param {object} [overrides] */
function runWith(sources, overrides = {}) {
  const findings = sources.map((source, index) => {
    const finding = makeFinding({ url: `https://example.test/p${index}` });
    return source === undefined ? finding : { ...finding, source: /** @type {any} */ (source) };
  });
  return makeRun({ findings, repo: /** @type {any} */ (REPO), ...overrides });
}

/** @param {ReturnType<typeof runWith>} run */
const sourcesOf = (run) => buildReport(run).groups.flatMap((group) => group.shown.map((finding) => finding.source));

describe('a finding\'s source file in the reports', () => {
  const run = runWith([
    { file: 'app/(marketing)/about/page.tsx', line: null, route: '/about' },
    { file: 'blog/index.html', line: 12, route: '/blog/' },
    undefined,
  ]);

  it('is shown in Markdown as file, file:line and route', () => {
    const out = renderMarkdown(run);
    assert.match(out, /Source: `app\/\(marketing\)\/about\/page\.tsx` \(route `\/about`\)/);
    assert.match(out, /Source: `blog\/index\.html:12` \(route `\/blog\/`\)/);
    assert.equal(out.match(/Source: `/g)?.length, 2);
  });

  it('is shown in HTML the same way', () => {
    const out = renderHtml(run);
    assert.match(out, /<span class="k">Source<\/span><code>app\/\(marketing\)\/about\/page\.tsx<\/code> <span class="k">Route<\/span><code>\/about<\/code>/);
    assert.match(out, /<span class="k">Source<\/span><code>blog\/index\.html:12<\/code> <span class="k">Route<\/span><code>\/blog\/<\/code>/);
    assert.equal(out.match(/<span class="k">Source<\/span>/g)?.length, 2);
  });

  it('is absent from a report of an audit without source files', () => {
    const plain = makeRun();
    assert.doesNotMatch(renderMarkdown(plain), /Source: `|Source files|source files are found/);
    assert.doesNotMatch(renderHtml(plain), /<span class="k">Source<|Source files|source files are found/);
    assert.equal(buildReport(plain).scope.some((row) => row.label === 'Source files'), false);
    assert.equal(buildReport(plain).method.some((section) => section.label === 'How source files are found'), false);
  });

  it('shows a source without a route, and drops one without a file', () => {
    assert.deepEqual(sourcesOf(runWith([{ file: 'robots.txt', line: null, route: null }, { line: 3, route: '/x' }, { file: '', line: 3 }, 'app/page.tsx', null, 7])), [
      { file: 'robots.txt', line: null, route: null }, null, null, null, null, null,
    ]);
    assert.match(renderMarkdown(runWith([{ file: 'robots.txt', line: null, route: null }])), /Source: `robots\.txt`(?! \(route)/);
  });

  it('shows a line only when it is a positive whole number', () => {
    const lines = [5, 0, -2, 1.5, '7', null, undefined].map((line) => ({ file: 'a.html', line, route: '/a' }));
    assert.deepEqual(sourcesOf(runWith(lines)).map((source) => source?.line), [5, null, null, null, null, null, null]);
  });

  it('cannot inject markup or break a table through a stored file name or route', () => {
    const hostile = runWith([{ file: '<img src=x onerror=alert(1)>`|\n# heading', line: 3, route: '"><script>alert(2)</script>|`' }, { file: 'x'.repeat(5000), line: 1, route: 'y'.repeat(5000) }]);
    const html = renderHtml(hostile);
    assertSafeHtml(html);
    assert.doesNotMatch(html, /<img src=x|<script>alert/);
    const md = renderMarkdown(hostile);
    assert.equal(md.split('\n').filter((l) => l.includes('Source: `')).length, 2);
    for (const line of md.split('\n').filter((l) => l.includes('Source: `'))) {
      // Hostile text sits inside code spans; outside them nothing is left that Markdown would read as markup.
      const outside = line.replace(/``.*?``/g, '').replace(/`[^`]*`/g, '');
      assert.doesNotMatch(outside, /<script>|<img/);
      assert.equal(line.replace(/\\\|/g, '').split('|').length, 4, 'one row of two cells');
    }
    assert.doesNotMatch(md, /^# heading/m);
    assert.ok(!md.includes('x'.repeat(400)) && !html.includes('y'.repeat(400)));
  });
});

describe('the scope row and the method note', () => {
  /** @param {ReturnType<typeof runWith>} run */
  const row = (run) => buildReport(run).scope.find((entry) => entry.label === 'Source files')?.value;

  it('says which project the files belong to and how many findings name one', () => {
    const run = runWith([{ file: 'app/page.tsx', line: null, route: '/' }, { file: 'app/a/page.tsx', line: null, route: '/a' }, undefined]);
    assert.equal(row(run), 'Next.js (App Router) project. 2 of 3 findings name the source file they come from. Paths are relative to the project folder.');
    assert.match(renderMarkdown(run), /- \*\*Source files:\*\* Next\.js \(App Router\) project\. 2 of 3 findings/);
    assert.match(renderHtml(run), /<dt>Source files<\/dt><dd>Next\.js \(App Router\) project\. 2 of 3 findings/);
    assert.equal(buildReport(run).method.some((section) => section.label === 'How source files are found'), true);
    assert.match(renderMarkdown(run), /\*\*How source files are found\.\*\* The audit ran against the project's own local server\./);
  });

  it('names the folder when the web project is below the project folder, and handles one finding', () => {
    const run = runWith([{ file: 'apps/web/index.html', line: 1, route: '/' }], { repo: /** @type {any} */ ({ ...REPO, framework: 'html', label: 'Plain HTML', source_dir: 'apps/web', findings_with_source: 1 }) });
    assert.equal(row(run), 'Plain HTML project in apps/web. 1 of 1 finding names the source file it comes from. Paths are relative to the project folder.');
  });

  it('says so when the project could not be mapped, and does not describe a method that was not used', () => {
    for (const framework of ['unsupported', 'none', 'something-else']) {
      const run = runWith([undefined], { repo: /** @type {any} */ ({ ...REPO, framework, label: 'Astro', findings_with_source: 0 }) });
      assert.equal(row(run), 'Not named. The project in this folder (Astro) is not supported for source mapping yet.');
      assert.equal(buildReport(run).method.some((section) => section.label === 'How source files are found'), false);
    }
  });

  it('never claims more findings with a source than there are findings, whatever the file says', () => {
    const run = runWith([undefined], { repo: /** @type {any} */ ({ ...REPO, findings_with_source: 99, label: 42, source_dir: null }) });
    assert.equal(row(run), 'Unnamed project. 1 of 1 finding names the source file it comes from. Paths are relative to the project folder.');
    assert.equal(row(runWith([undefined], { repo: /** @type {any} */ ('next-app') })), undefined);
    assert.equal(row(runWith([undefined], { repo: null })), undefined);
    assert.equal(row(runWith([undefined], { repo: /** @type {any} */ ([]) })), undefined);
  });
});
