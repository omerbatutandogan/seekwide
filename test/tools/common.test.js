import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ToolError } from '../../server/src/mcp/stdio.js';
import { InputError } from '../../server/src/util/errors.js';
import { createTools } from '../../server/src/tools/index.js';
import { settingValue, withStoreErrors } from '../../server/src/tools/common.js';
import { makeDeps, sampleCrawl, jobFor, toolNamed } from './fakes.js';

/** @param {string} code @param {string} message */
const fail = (code, message) => () => {
  throw Object.assign(new Error(message), { code });
};

describe('withStoreErrors', () => {
  it('maps every documented store error to a ToolError that says what to do', async () => {
    const cases = [
      ['RUN_NOT_FOUND', 'Run x was not found.', 'Run x was not found. Call runs_list to see the saved runs, or audit_run to create one.'],
      ['INVALID_RUN_ID', 'Invalid run id "..". Use an id from runs_list.', 'Invalid run id "..". Use an id from runs_list.'],
      ['INVALID_PROJECT_DIR', 'project_dir must be an absolute path. Pass the full path.', 'project_dir must be an absolute path. Pass the full path.'],
      ['PROJECT_DIR_NOT_FOUND', 'The project folder /x does not exist.', 'The project folder /x does not exist. Pass project_dir with the full path of an existing folder.'],
      ['RUN_EXISTS', 'Run r1 is already stored.', 'Run r1 is already stored. Call audit_run again; it picks a new run id.'],
      ['RUN_CORRUPT', 'Run r1 is damaged. Run the audit again.', 'Run r1 is damaged. Run the audit again. Call runs_list to pick another run.'],
      ['INVALID_PROFILE', 'Invalid profile: site_url is required.', 'Invalid profile: site_url is required. Fix these fields and call profile_set again.'],
    ];
    for (const [code, message, expected] of cases) {
      await assert.rejects(withStoreErrors(fail(code, message)), (error) => error instanceof ToolError && error.message === expected, code);
    }
  });

  it('re-throws other errors unchanged', async () => {
    const boom = new Error('disk full');
    await assert.rejects(withStoreErrors(() => { throw boom; }), (error) => error === boom);
    await assert.rejects(withStoreErrors(fail('EACCES', 'denied')), (error) => !(error instanceof ToolError));
  });

  it('returns the value of a successful call', async () => {
    assert.equal(await withStoreErrors(async () => 42), 42);
  });
});

describe('settingValue', () => {
  it('treats empty, blank and unsubstituted placeholder values as unset', () => {
    for (const value of [undefined, null, '', '   ', '${user_config.report_brand_name}', '${SEEKWIDE_REPORT_LOGO}', ' ${x} ']) {
      assert.equal(settingValue(value), undefined, String(value));
    }
  });

  it('keeps real values, trimmed', () => {
    assert.equal(settingValue(' Acme Agency '), 'Acme Agency');
    assert.equal(settingValue('/logos/acme.png'), '/logos/acme.png');
  });
});

describe('store contract handling in the tools', () => {
  it('audit_run retries with a new id when another run took the id first', async () => {
    const crawl = sampleCrawl();
    const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
    const realList = fake.deps.listRuns;
    let calls = 0;
    // The first listing misses a run that a concurrent audit saved a moment earlier.
    fake.deps.listRuns = async (dir) => (calls++ === 0 ? [] : realList(dir));
    fake.runs.push(/** @type {any} */ ({ run_id: '2026-11-11T14-03-22Z', findings: [] }));
    const result = await toolNamed(createTools(fake.deps), 'audit_run').handler({ job_id: 'c-1' });
    assert.equal(result.run_id, '2026-11-11T14-03-22Z-2');
    assert.equal(fake.calls.saveRun.length, 2);
  });

  it('audit_run fails early on a missing project folder, before checking links', async () => {
    const crawl = sampleCrawl();
    const fake = makeDeps({ jobs: [jobFor(crawl)], results: [crawl] });
    await assert.rejects(
      toolNamed(createTools(fake.deps), 'audit_run').handler({ job_id: 'c-1', project_dir: '/missing/site' }),
      /does not exist\. .*Pass project_dir with the full path of an existing folder/,
    );
    assert.equal(fake.calls.checkExternalLinks, undefined);
  });

  it('report_render turns a renderer InputError into a ToolError, and leaves a bug\'s TypeError to the generic message', async () => {
    const fake = makeDeps({ runs: [/** @type {any} */ ({ run_id: 'r1', findings: [] })] });
    fake.deps.renderHtml = () => {
      throw new InputError('recommendations[0] needs a non-empty title and detail.');
    };
    await assert.rejects(
      toolNamed(createTools(fake.deps), 'report_render').handler({ formats: ['html'], project_dir: '/tmp' }),
      (error) => error instanceof ToolError && /html report could not be rendered: recommendations\[0\]/.test(error.message),
    );
    fake.deps.renderHtml = () => {
      const run = /** @type {any} */ (undefined);
      return run.findings.length;
    };
    await assert.rejects(
      toolNamed(createTools(fake.deps), 'report_render').handler({ formats: ['html'], project_dir: '/tmp' }),
      (error) => error instanceof TypeError && !(error instanceof ToolError),
    );
  });
});
