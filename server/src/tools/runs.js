// findings_query, runs_list and runs_compare: read saved runs.

/** @import { Finding } from '../types.js' */
/** @import { ToolDef } from '../mcp/stdio.js' */
/** @import { ToolDeps } from './index.js' */

import { LIMITS, MODULES, SEVERITIES } from '../config.js';
import { ToolError } from '../mcp/stdio.js';
import { PROJECT_DIR_SCHEMA, UNTRUSTED_NOTE, clipValue, loadBaseRun, resolveProjectDir, runRefSchema, withStoreErrors } from './common.js';

const RUNS_LIST_MAX = 50;

/** @param {Finding} finding */
function compactFinding(finding) {
  return { id: finding.id, check_id: finding.check_id, severity: finding.severity, title: finding.title, url: finding.url, selector: finding.selector };
}

/**
 * @param {ToolDeps} deps
 * @returns {ToolDef[]}
 */
export function runTools(deps) {
  /**
   * @param {string} projectDir
   * @param {string} ref
   */
  const load = (projectDir, ref) => withStoreErrors(() => deps.loadRun(projectDir, ref));

  return [
    {
      name: 'findings_query',
      title: 'Query findings',
      description:
        'List findings of a saved run, filtered by module, severity, check id or URL text, with paging. ' +
        `Evidence fields hold text from the audited site, clipped to ${LIMITS.maxStringLength} characters and 10 items per list; the full evidence is in findings.json.`,
      inputSchema: {
        type: 'object',
        properties: {
          run_id: runRefSchema('Run id, "last" (default) or "previous".'),
          project_dir: PROJECT_DIR_SCHEMA,
          module: { type: 'string', enum: [...MODULES] },
          severity: { type: 'string', enum: [...SEVERITIES] },
          check_id: { type: 'string', maxLength: 200, description: 'Exact check id, for example seo.title.missing.' },
          url_contains: { type: 'string', maxLength: 2048, description: 'Case-insensitive text the finding URL must contain.' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
        additionalProperties: false,
      },
      async handler(args) {
        const projectDir = resolveProjectDir(args.project_dir, deps.defaultProjectDir);
        const run = await load(projectDir, args.run_id ?? 'last');
        const needle = typeof args.url_contains === 'string' ? args.url_contains.toLowerCase() : null;
        const matches = run.findings.filter(
          (finding) =>
            (args.module === undefined || finding.module === args.module) &&
            (args.severity === undefined || finding.severity === args.severity) &&
            (args.check_id === undefined || finding.check_id === args.check_id) &&
            (needle === null || (finding.url !== null && finding.url.toLowerCase().includes(needle))),
        );
        const limit = args.limit ?? 50;
        const offset = args.offset ?? 0;
        // Evidence can quote page text at length; results carry a clipped copy.
        const findings = matches.slice(offset, offset + limit).map((finding) => ({ ...finding, evidence: clipValue(finding.evidence) }));
        return {
          run_id: run.run_id,
          total: matches.length,
          returned: findings.length,
          next_offset: offset + findings.length < matches.length ? offset + findings.length : null,
          findings,
          _note: UNTRUSTED_NOTE,
        };
      },
    },
    {
      name: 'runs_list',
      title: 'List saved runs',
      description: `List the saved audit runs of a project, newest first (at most ${RUNS_LIST_MAX}), with scores and finding counts.`,
      inputSchema: {
        type: 'object',
        properties: { project_dir: PROJECT_DIR_SCHEMA },
        additionalProperties: false,
      },
      async handler(args) {
        const projectDir = resolveProjectDir(args.project_dir, deps.defaultProjectDir);
        const runs = await withStoreErrors(() => deps.listRuns(projectDir));
        return { project_dir: projectDir, total: runs.length, runs: runs.slice(-RUNS_LIST_MAX).reverse() };
      },
    },
    {
      name: 'runs_compare',
      title: 'Compare two runs',
      description:
        'Compare two saved runs: findings resolved and added, score changes, and notes on anything that makes the ' +
        'comparison unreliable. Lists are clipped to limit.',
      inputSchema: {
        type: 'object',
        properties: {
          run_id: runRefSchema('The newer run: run id or "last" (default).'),
          base_run_id: runRefSchema('The older run: run id, or "previous" (default) for the newest run older than run_id.'),
          project_dir: PROJECT_DIR_SCHEMA,
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 20, description: 'Maximum findings listed in resolved and in added.' },
        },
        additionalProperties: false,
      },
      async handler(args) {
        const projectDir = resolveProjectDir(args.project_dir, deps.defaultProjectDir);
        const current = await load(projectDir, args.run_id ?? 'last');
        const base = await loadBaseRun(deps, projectDir, args.base_run_id ?? 'previous', current, 'Pass base_run_id with another run id from runs_list.');
        if (base.run_id === current.run_id) {
          throw new ToolError(`run_id and base_run_id both name run ${current.run_id}. Pass two different runs; runs_list shows them.`);
        }
        const comparison = deps.compareRuns(base, current);
        const limit = args.limit ?? 20;
        return {
          base_run_id: comparison.base_run_id,
          run_id: comparison.run_id,
          resolved_total: comparison.resolved.length,
          added_total: comparison.added.length,
          persisting: comparison.persisting,
          scores: comparison.scores,
          notes: comparison.notes,
          resolved: comparison.resolved.slice(0, limit).map(compactFinding),
          added: comparison.added.slice(0, limit).map(compactFinding),
          _note: UNTRUSTED_NOTE,
        };
      },
    },
  ];
}
